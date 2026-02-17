import { MCPServer } from '../server/MCPServer.js';
import winston from 'winston';
import { KubernetesClient } from '../kubernetes/KubernetesClient.js';
import { type HelmBaseTool, HelmListTool, HelmGetTool } from '../tools/helm/index.js';
import { BaseToolsPlugin } from './BaseToolsPlugin.js';
import { KubernetesToolsPlugin } from './KubernetesToolsPlugin.js';

/**
 * Plugin that registers Helm tools with the MCP server
 */
export class HelmToolsPlugin extends BaseToolsPlugin<HelmBaseTool> {
  name = 'helm-tools';

  private kubernetesPlugin?: KubernetesToolsPlugin;

  protected createToolInstances(): HelmBaseTool[] {
    return [new HelmListTool(), new HelmGetTool()];
  }

  static getCommandNames(): string[] {
    return new HelmToolsPlugin().createToolInstances().map((tool) => tool.tool.name);
  }

  private static createLogger(): winston.Logger | undefined {
    if (!process.env.MCP_LOG_LEVEL) {
      return undefined;
    }
    return winston.createLogger({
      level: process.env.MCP_LOG_LEVEL,
      format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      transports: [
        new winston.transports.Console({
          stderrLevels: ['error', 'warn', 'info', 'verbose', 'debug', 'silly'],
          format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
        }),
      ],
    });
  }

  protected isDisabled(): boolean {
    return (
      process.env.MCP_DISABLE_HELM_PLUGIN === 'true' || process.env.MCP_DISABLE_HELM_PLUGIN === '1'
    );
  }

  static async executeCommand(commandName: string, params: Record<string, unknown>): Promise<any> {
    if (
      process.env.MCP_DISABLE_HELM_PLUGIN === 'true' ||
      process.env.MCP_DISABLE_HELM_PLUGIN === '1'
    ) {
      throw new Error('Helm plugin is disabled');
    }

    const plugin = new HelmToolsPlugin();
    plugin.commands = plugin.createToolInstances();
    plugin.buildCommandMap();

    let client: KubernetesClient | undefined;
    try {
      const k8sPlugin = new KubernetesToolsPlugin();
      client = await k8sPlugin.createOrReuseClient();
    } catch {
      client = undefined;
    }

    const logger = this.createLogger();
    if (logger) {
      logger.info(`Executing Helm command: ${commandName}`, { params });
    }

    try {
      const timeoutMs = plugin.computeGlobalTimeoutMs(params);
      const cmd = plugin.commandMap.get(commandName);
      if (!cmd) throw new Error(`Unknown tool: ${commandName}`);
      const execPromise = cmd.execute(params as any, client);
      const result = await plugin.withTimeout(execPromise, timeoutMs, commandName);
      if (logger) {
        logger.debug(`Command ${commandName} completed successfully`);
      }
      return result;
    } catch (error) {
      if (logger) {
        logger.error(`Command ${commandName} failed`, { error });
      }
      throw error;
    }
  }

  async initialize(server: MCPServer): Promise<void> {
    const k8sPlugin = server.getPlugin('kubernetes-tools');
    if (k8sPlugin instanceof KubernetesToolsPlugin) {
      this.kubernetesPlugin = k8sPlugin;
      this.logger = server.getLogger();
      this.logger.info('HelmToolsPlugin will reuse Kubernetes client from KubernetesToolsPlugin');
    }
    return super.initialize(server);
  }

  private async getKubernetesClient(): Promise<KubernetesClient | undefined> {
    if (this.kubernetesPlugin) {
      try {
        return await this.kubernetesPlugin.createOrReuseClient();
      } catch (error) {
        this.logger?.debug('Failed to get Kubernetes client from KubernetesToolsPlugin', { error });
        return undefined;
      }
    }
    return undefined;
  }

  protected getHandlerForTool(tool: HelmBaseTool): (params: any) => Promise<any> {
    return async (params: any) => {
      const timeoutMs = this.computeGlobalTimeoutMs(params);
      const client = await this.getKubernetesClient();
      const execPromise = tool.execute(params, client);
      const label = tool.tool?.name || 'tool';
      return this.withTimeout(execPromise, timeoutMs, label);
    };
  }

  async shutdown(): Promise<void> {
    this.logger?.info('HelmToolsPlugin shutting down...');
  }
}

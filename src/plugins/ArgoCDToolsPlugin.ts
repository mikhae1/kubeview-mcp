import { MCPServer } from '../server/MCPServer.js';
import winston from 'winston';
import { type ArgoCDBaseTool, validateArgoCDCLI, ArgoCDAppTool } from '../tools/argocd/index.js';
import { BaseToolsPlugin } from './BaseToolsPlugin.js';

/**
 * Plugin that registers ArgoCD tools with the MCP server
 */
export class ArgoCDToolsPlugin extends BaseToolsPlugin<ArgoCDBaseTool> {
  name = 'argocd-tools';
  version = '0.1.0';

  protected createToolInstances(): ArgoCDBaseTool[] {
    return [new ArgoCDAppTool()];
  }

  static getCommandNames(): string[] {
    return new ArgoCDToolsPlugin().createToolInstances().map((tool) => tool.tool.name);
  }

  private static createLogger(): winston.Logger | undefined {
    if (!process.env.LOG_LEVEL) {
      return undefined;
    }
    return winston.createLogger({
      level: process.env.LOG_LEVEL,
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
      process.env.DISABLE_ARGOCD_PLUGIN === 'true' || process.env.DISABLE_ARGOCD_PLUGIN === '1'
    );
  }

  protected async validate(): Promise<void> {
    await validateArgoCDCLI();
  }

  static async executeCommand(commandName: string, params: Record<string, unknown>): Promise<any> {
    if (process.env.DISABLE_ARGOCD_PLUGIN === 'true' || process.env.DISABLE_ARGOCD_PLUGIN === '1') {
      throw new Error('ArgoCD plugin is disabled');
    }

    await validateArgoCDCLI();

    const plugin = new ArgoCDToolsPlugin();
    plugin.commands = plugin.createToolInstances();
    plugin.buildCommandMap();

    const logger = this.createLogger();
    if (logger) {
      logger.info(`Executing ArgoCD command: ${commandName}`, { params });
    }

    try {
      const timeoutMs = plugin.computeGlobalTimeoutMs(params);
      const result = await plugin.withTimeout(
        plugin.runCommandByName(commandName, params),
        timeoutMs,
        commandName,
      );
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
    return super.initialize(server);
  }

  async shutdown(): Promise<void> {
    this.logger?.info('ArgoCDToolsPlugin shutting down...');
  }
}

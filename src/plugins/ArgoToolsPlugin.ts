import { MCPServer } from '../server/MCPServer.js';
import winston from 'winston';
import { type ArgoBaseTool, ArgoListTool, ArgoLogsTool, ArgoGetTool } from '../tools/argo/index.js';
import { BaseToolsPlugin } from './BaseToolsPlugin.js';

/**
 * Plugin that registers Argo tools with the MCP server
 */
export class ArgoToolsPlugin extends BaseToolsPlugin<ArgoBaseTool> {
  name = 'argo-tools';

  protected createToolInstances(): ArgoBaseTool[] {
    return [new ArgoListTool(), new ArgoLogsTool(), new ArgoGetTool()];
  }

  static getCommandNames(): string[] {
    return new ArgoToolsPlugin().createToolInstances().map((tool) => tool.tool.name);
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
      process.env.MCP_DISABLE_ARGO_PLUGIN === 'true' || process.env.MCP_DISABLE_ARGO_PLUGIN === '1'
    );
  }

  protected async validate(): Promise<void> {
    return;
  }

  static async executeCommand(commandName: string, params: Record<string, unknown>): Promise<any> {
    if (
      process.env.MCP_DISABLE_ARGO_PLUGIN === 'true' ||
      process.env.MCP_DISABLE_ARGO_PLUGIN === '1'
    ) {
      throw new Error('Argo plugin is disabled');
    }

    const plugin = new ArgoToolsPlugin();
    plugin.commands = plugin.createToolInstances();
    plugin.buildCommandMap();

    const logger = this.createLogger();
    if (logger) {
      logger.info(`Executing Argo command: ${commandName}`, { params });
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
    this.logger?.info('ArgoToolsPlugin shutting down...');
  }
}

import { MCPPlugin, MCPServer } from '../server/MCPServer.js';
import winston from 'winston';
import {
  type ArgoCDBaseTool,
  validateArgoCDCLI,
  ArgoCDAppListTool,
  ArgoCDAppGetTool,
  ArgoCDAppHistoryTool,
  ArgoCDAppLogsTool,
  ArgoCDAppResourcesTool,
} from '../tools/argocd/index.js';

/**
 * Plugin that registers ArgoCD tools with the MCP server
 */
export class ArgoCDToolsPlugin implements MCPPlugin {
  name = 'argocd-tools';
  version = '0.1.0';

  private commands: ArgoCDBaseTool[] = [];
  private logger?: MCPServer['logger'];
  private commandMap: Map<string, ArgoCDBaseTool> = new Map();

  constructor() {}

  /**
   * Check if plugin is disabled via environment variable
   */
  private static isDisabled(): boolean {
    return (
      process.env.DISABLE_ARGOCD_PLUGIN === 'true' || process.env.DISABLE_ARGOCD_PLUGIN === '1'
    );
  }

  /**
   * Create the list of all available tool instances
   * This is the single source of truth for all tools in the plugin
   */
  private static createToolInstances(): ArgoCDBaseTool[] {
    return [
      new ArgoCDAppListTool(),
      new ArgoCDAppGetTool(),
      new ArgoCDAppHistoryTool(),
      new ArgoCDAppLogsTool(),
      new ArgoCDAppResourcesTool(),
    ];
  }

  /**
   * Get all command names from the tool instances
   */
  static getCommandNames(): string[] {
    return this.createToolInstances().map((tool) => tool.tool.name);
  }

  /**
   * Create a Winston logger for CLI usage only if LOG_LEVEL is set
   */
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

  /**
   * Static method to directly execute a command from CLI without starting the MCP server
   * @param commandName The name of the command to execute
   * @param params Parameters for the command
   * @returns The result of the command execution
   */
  static async executeCommand(commandName: string, params: Record<string, any>): Promise<any> {
    const plugin = new ArgoCDToolsPlugin();

    // Initialize commands using the centralized method
    plugin.commands = this.createToolInstances();

    // Create map of commands
    for (const command of plugin.commands) {
      plugin.commandMap.set(command.tool.name, command);
    }

    const command = plugin.commandMap.get(commandName);
    if (!command) {
      throw new Error(`Unknown tool: ${commandName}`);
    }

    const logger = this.createLogger();
    if (logger) {
      logger.info(`Executing ArgoCD command: ${commandName}`, { params });
    }

    try {
      // Execute the command
      const result = await command.execute(params);
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
    this.logger = server.getLogger();

    try {
      // Check if plugin is disabled
      if (ArgoCDToolsPlugin.isDisabled()) {
        this.logger.info('ArgoCDToolsPlugin is disabled via environment variable');
        this.commands = [];
        this.commandMap.clear();
        return;
      }

      // Validate ArgoCD CLI - only register tools if validation succeeds
      try {
        await validateArgoCDCLI();
        this.logger.info('ArgoCD CLI validation successful');

        // Initialize commands using the centralized method
        this.commands = ArgoCDToolsPlugin.createToolInstances();

        // Create a map of command names to command instances
        for (const command of this.commands) {
          this.commandMap.set(command.tool.name, command);
        }

        // Register each command with the server
        for (const command of this.commands) {
          server.registerTool(command.tool, async (params: any) => {
            return command.execute(params);
          });
        }

        this.logger.info(
          `ArgoCDToolsPlugin initialized with ${this.commands.length} tools. ArgoCD CLI ready.`,
        );
      } catch (error) {
        this.logger.warn('ArgoCD CLI not found. ArgoCD tools will not be registered.', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't register any tools if argocd CLI is not available
        this.commands = [];
        this.commandMap.clear();

        this.logger.info('ArgoCDToolsPlugin initialized with 0 tools (ArgoCD CLI not available).');
      }
    } catch (error) {
      this.logger.error('Failed to initialize ArgoCDToolsPlugin', error);
      throw error; // Rethrow to allow MCPServer to catch it if needed
    }
  }

  /**
   * Get a function that executes a specific tool by name
   * @param toolName The name of the tool to execute
   * @returns A function that takes parameters and executes the tool, or undefined if the tool doesn't exist
   */
  getToolFunction(toolName: string): ((params: any) => Promise<any>) | undefined {
    const command = this.commandMap.get(toolName);

    if (!command) {
      return undefined;
    }

    return async (params: any) => {
      return command.execute(params);
    };
  }

  async shutdown(): Promise<void> {
    // No specific cleanup needed for ArgoCD CLI operations
    this.logger?.info('ArgoCDToolsPlugin shutting down...');
  }
}

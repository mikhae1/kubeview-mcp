// TODO: All commands should be imported from the tools/kubernetes/index.ts file

import { MCPPlugin, MCPServer } from '../server/MCPServer.js';
import { KubernetesClient, KubernetesClientConfig } from '../kubernetes/KubernetesClient.js';
import winston from 'winston';
import {
  type BaseTool,
  GetPodsTool,
  GetPodMetricsTool,
  GetServicesTool,
  GetIngressTool,
  GetDeploymentsTool,
  GetResourceTool,
  GetContainerLogsTool,
  GetEventsTool,
  GetNamespacesTool,
  GetMetricsTool,
  GetConfigMapTool,
  GetSecretsTool,
  GetPersistentVolumesTool,
  GetPersistentVolumeClaimsTool,
} from '../tools/kubernetes/index.js';

/**
 * Plugin that registers Kubernetes tools with the MCP server
 */
export class KubernetesToolsPlugin implements MCPPlugin {
  name = 'kubernetes-tools';
  version = '0.1.0';

  private commands: BaseTool[] = [];
  private logger?: MCPServer['logger'];
  private commandMap: Map<string, BaseTool> = new Map();

  constructor(private config?: KubernetesClientConfig) {}

  /**
   * Create the list of all available tool instances
   * This is the single source of truth for all tools in the plugin
   */
  private static createToolInstances(): BaseTool[] {
    return [
      new GetPodsTool(),
      new GetPodMetricsTool(),
      new GetServicesTool(),
      new GetIngressTool(),
      new GetDeploymentsTool(),
      new GetResourceTool(),
      new GetContainerLogsTool(),
      new GetEventsTool(),
      new GetNamespacesTool(),
      new GetMetricsTool(),
      new GetConfigMapTool(),
      new GetSecretsTool(),
      new GetPersistentVolumesTool(),
      new GetPersistentVolumeClaimsTool(),
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
    const plugin = new KubernetesToolsPlugin();

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
    // Initialize Kubernetes client with optional logger
    const client = new KubernetesClient(logger ? { logger } : {});

    // Always refresh the current context to ensure we're using the latest kubeconfig
    await client.refreshCurrentContext();

    const connected = await client.testConnection();
    if (!connected) {
      throw new Error('Failed to connect to Kubernetes cluster');
    }

    try {
      // Execute the command
      return await command.execute(params, client);
    } finally {
      // No cleanup needed since connection pooling was removed
    }
  }

  private async createNewClient(): Promise<KubernetesClient> {
    try {
      const client = new KubernetesClient(this.config);

      // Always refresh the current context to ensure we're using the latest kubeconfig
      await client.refreshCurrentContext();

      const connected = await client.testConnection();
      if (!connected) {
        throw new Error('Failed to connect to Kubernetes cluster');
      }
      this.logger?.info('New Kubernetes client created and connected successfully');
      return client;
    } catch (error) {
      this.logger?.error('Failed to create new Kubernetes client', error);
      throw error;
    }
  }

  async initialize(server: MCPServer): Promise<void> {
    this.logger = server.getLogger();

    try {
      // Initialize commands using the centralized method
      this.commands = KubernetesToolsPlugin.createToolInstances();

      // Create a map of command names to command instances
      for (const command of this.commands) {
        this.commandMap.set(command.tool.name, command);
      }

      // Register each command with the server
      for (const command of this.commands) {
        server.registerTool(command.tool, async (params: any) => {
          const client = await this.createNewClient();
          return command.execute(params, client);
        });
      }

      this.logger.info(
        `KubernetesToolsPlugin initialized with ${this.commands.length} tools. Client will connect on first use.`,
      );
    } catch (error) {
      this.logger.error('Failed to initialize KubernetesToolsPlugin', error);
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
      const client = await this.createNewClient();
      // Context refresh is already handled in createNewClient()
      return command.execute(params, client);
    };
  }

  async shutdown(): Promise<void> {
    // No need to explicitly close the client as it's handled by the server
  }
}

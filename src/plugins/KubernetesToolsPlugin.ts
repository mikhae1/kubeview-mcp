// TODO: All commands should be imported from the tools/kubernetes/index.ts file

import { MCPServer } from '../server/MCPServer.js';
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
import { BaseToolsPlugin } from './BaseToolsPlugin.js';

/**
 * Plugin that registers Kubernetes tools with the MCP server
 */
export class KubernetesToolsPlugin extends BaseToolsPlugin<BaseTool> {
  name = 'kubernetes-tools';
  version = '0.1.0';

  private clientCacheByContext: Map<string, KubernetesClient> = new Map();
  private lastUsedAtByContext: Map<string, number> = new Map();
  private clientTtlMs = 60_000; // reuse client within TTL to reduce overhead

  constructor(private config?: KubernetesClientConfig) {
    super();
  }

  /**
   * Create the list of all available tool instances
   * This is the single source of truth for all tools in the plugin
   */
  protected createToolInstances(): BaseTool[] {
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
    return new KubernetesToolsPlugin().createToolInstances().map((tool) => tool.tool.name);
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
  static async executeCommand(commandName: string, params: Record<string, unknown>): Promise<any> {
    if (
      process.env.DISABLE_KUBERNETES_PLUGIN === 'true' ||
      process.env.DISABLE_KUBERNETES_PLUGIN === '1'
    ) {
      throw new Error('Kubernetes plugin is disabled');
    }

    const plugin = new KubernetesToolsPlugin();
    plugin.commands = plugin.createToolInstances();
    plugin.buildCommandMap();

    const logger = this.createLogger();
    const client = new KubernetesClient(logger ? { logger } : {});
    await client.refreshCurrentContext();
    const connected = await client.testConnection();
    if (!connected) {
      throw new Error('Failed to connect to Kubernetes cluster');
    }

    const cmd = plugin.commandMap.get(commandName);
    if (!cmd) throw new Error(`Unknown tool: ${commandName}`);
    return cmd.execute(params as any, client);
  }

  private async createOrReuseClient(): Promise<KubernetesClient> {
    try {
      // Reuse client by current context if available and not expired
      const tempClientForContext = new KubernetesClient(this.config);
      await tempClientForContext.refreshCurrentContext();
      const contextName = tempClientForContext.getCurrentContext();

      const now = Date.now();
      const lastUsed = this.lastUsedAtByContext.get(contextName) ?? 0;
      const cached = this.clientCacheByContext.get(contextName);
      if (cached && now - lastUsed < this.clientTtlMs) {
        this.lastUsedAtByContext.set(contextName, now);
        return cached;
      }

      const client = tempClientForContext; // reuse the prepared client
      const connected = await client.testConnection();
      if (!connected) {
        throw new Error('Failed to connect to Kubernetes cluster');
      }
      this.logger?.info('Kubernetes client ready');
      this.clientCacheByContext.set(contextName, client);
      this.lastUsedAtByContext.set(contextName, now);
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
      this.commands = this.createToolInstances();

      // Create a map of command names to command instances
      for (const command of this.commands) {
        this.commandMap.set(command.tool.name, command);
      }

      // Register each command with the server
      for (const command of this.commands) {
        server.registerTool(command.tool, async (params: unknown) => {
          const client = await this.createOrReuseClient();
          return command.execute(params as any, client);
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
      const client = await this.createOrReuseClient();
      // Context refresh is already handled in createNewClient()
      return command.execute(params, client);
    };
  }

  async shutdown(): Promise<void> {
    // Clear cached clients
    this.clientCacheByContext.clear();
    this.lastUsedAtByContext.clear();
  }
}

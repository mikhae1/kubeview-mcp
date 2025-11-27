// TODO: All commands should be imported from the tools/kubernetes/index.ts file

import { MCPServer } from '../server/MCPServer.js';
import { KubernetesClient, KubernetesClientConfig } from '../kubernetes/KubernetesClient.js';
import winston from 'winston';
import {
  type BaseTool,
  KubeListTool,
  KubeMetricsTool,
  GetResourceTool,
  GetContainerLogsTool,
  PortForwardTool,
  ExecTool,
  KubeNetTool,
  KubeLogTool,
} from '../tools/kubernetes/index.js';
import { BaseToolsPlugin } from './BaseToolsPlugin.js';

/**
 * Plugin that registers Kubernetes tools with the MCP server
 */
export class KubernetesToolsPlugin extends BaseToolsPlugin<BaseTool> {
  name = 'kubernetes-tools';

  private clientCacheByContext: Map<string, KubernetesClient> = new Map();
  private lastUsedAtByContext: Map<string, number> = new Map();
  private clientTtlMs = 60_000; // reuse client within TTL to reduce overhead

  constructor(private config?: KubernetesClientConfig) {
    super();
    // Merge env-derived config defaults if not explicitly provided
    const envConfig = this.buildConfigFromEnv();
    this.config = { ...envConfig, ...(this.config || {}) };
  }

  /**
   * Create the list of all available tool instances
   * This is the single source of truth for all tools in the plugin
   */
  protected createToolInstances(): BaseTool[] {
    return [
      new KubeListTool(),
      new KubeMetricsTool(),
      new GetResourceTool(),
      new GetContainerLogsTool(),
      new KubeLogTool(),
      new PortForwardTool(),
      new ExecTool(),
      new KubeNetTool(),
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

  /**
   * Static method to directly execute a command from CLI without starting the MCP server
   * @param commandName The name of the command to execute
   * @param params Parameters for the command
   * @returns The result of the command execution
   */
  static async executeCommand(commandName: string, params: Record<string, unknown>): Promise<any> {
    if (
      process.env.MCP_DISABLE_KUBERNETES_PLUGIN === 'true' ||
      process.env.MCP_DISABLE_KUBERNETES_PLUGIN === '1'
    ) {
      throw new Error('Kubernetes plugin is disabled');
    }

    const plugin = new KubernetesToolsPlugin();
    plugin.commands = plugin.createToolInstances();
    plugin.buildCommandMap();

    const logger = this.createLogger();
    const envConfig = plugin.buildConfigFromEnv();
    const client = new KubernetesClient(logger ? { ...envConfig, logger } : envConfig);
    await client.refreshCurrentContext();
    const connected = await client.testConnection();
    if (!connected) {
      throw new Error('Failed to connect to Kubernetes cluster');
    }

    const cmd = plugin.commandMap.get(commandName);
    if (!cmd) throw new Error(`Unknown tool: ${commandName}`);
    const execPromise = cmd.execute(params as any, client);
    const timeoutMs = plugin.computeGlobalTimeoutMs(params);
    // Use BaseToolsPlugin timeout helper
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - accessing protected method from static context via instance
    return plugin.withTimeout(execPromise, timeoutMs, cmd.tool?.name || commandName);
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

  /** Build Kubernetes client config from environment variables */
  private buildConfigFromEnv(): KubernetesClientConfig {
    const cfg: KubernetesClientConfig = {};
    const context = process.env.MCP_KUBE_CONTEXT;
    if (context && typeof context === 'string' && context.trim().length > 0) {
      cfg.context = context.trim();
    }

    const skipTlsEnv = process.env.MCP_K8S_SKIP_TLS_VERIFY;
    if (skipTlsEnv && (skipTlsEnv === 'true' || skipTlsEnv === '1')) {
      cfg.skipTlsVerify = true;
    }

    return cfg;
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
          const execPromise = command.execute(params as any, client);
          const timeoutMs = this.computeGlobalTimeoutMs(params);
          return this.withTimeout(execPromise, timeoutMs, command.tool?.name);
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
   * Re-initialize Kubernetes context for a new conversation by clearing
   * any cached clients so the next tool execution constructs a fresh client
   * from the current kubeconfig context.
   */
  async onNewConversation(): Promise<void> {
    this.logger?.info('New conversation detected: clearing Kubernetes client cache');
    this.clientCacheByContext.clear();
    this.lastUsedAtByContext.clear();
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

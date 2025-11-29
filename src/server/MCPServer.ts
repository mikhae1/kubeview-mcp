import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  Tool,
  Resource,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/types.js';
import winston from 'winston';
import { isSensitiveMaskEnabled, maskObjectDeep } from '../utils/SensitiveData.js';

/**
 * Plugin interface for extending MCP server functionality
 */
export interface MCPPlugin {
  name: string;
  initialize(server: MCPServer): Promise<void>;
  shutdown?(): Promise<void>;
  /**
   * Optional hook invoked when a new conversation starts.
   * Servers typically receive a tools listing at the beginning of a session,
   * so this hook is called from the ListTools handler.
   */
  onNewConversation?(): Promise<void>;
}

/**
 * Tool registry entry
 */
interface ToolEntry {
  tool: Tool;
  handler: (params: any) => Promise<any>;
}

/**
 * Prompt registry entry
 */
interface PromptEntry {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  getMessages: (
    args?: Record<string, string>,
  ) => Promise<Array<{ role: string; content: { type: string; text: string } }>>;
}

/**
 * Core MCP Server implementation for Kubernetes operations
 */
export interface MCPServerOptions {
  skipTransportErrorHandling?: boolean;
  skipGracefulShutdown?: boolean;
}

export class MCPServer {
  private server: Server;
  private transport: StdioServerTransport;
  private logger: winston.Logger;
  private tools: Map<string, ToolEntry> = new Map();
  private resources: Map<string, Resource> = new Map();
  private resourceTemplates: Map<string, ResourceTemplate> = new Map();
  private plugins: Map<string, MCPPlugin> = new Map();
  private prompts: Map<string, PromptEntry> = new Map();
  private isShuttingDown = false;
  private options: MCPServerOptions;
  private eventListeners: Array<{
    target: any;
    event: string;
    handler: (...args: any[]) => void;
  }> = [];

  constructor(options: MCPServerOptions = {}) {
    this.options = options;
    // Initialize Winston logger
    const transports: winston.transport[] = [
      new winston.transports.Console({
        stderrLevels: ['error', 'warn', 'info', 'verbose', 'debug', 'silly'],
        format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      }),
    ];

    // Optional file logging controlled by env
    const isFileLogEnabled =
      process.env.MCP_LOG_ENABLE === 'true' || process.env.MCP_LOG_ENABLE === '1';
    if (isFileLogEnabled) {
      const logFilePath = process.env.MCP_LOG_FILE || 'kubeview-mcp.log';
      transports.push(
        new winston.transports.File({
          filename: logFilePath,
          format: winston.format.json(),
        }),
      );
    }

    this.logger = winston.createLogger({
      level: process.env.MCP_LOG_LEVEL || 'info',
      format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      transports,
    });

    // Initialize MCP server
    this.server = new Server(
      {
        name: 'kubeview-mcp',
        version: '',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      },
    );

    // Initialize stdio transport
    this.transport = new StdioServerTransport();

    // Add custom error handler to the transport (skip in tests)
    if (!options.skipTransportErrorHandling) {
      this.setupTransportErrorHandling();
    }

    // Set up handlers
    this.setupHandlers();

    // Set up graceful shutdown (skip in tests to avoid process listeners)
    if (!this.options.skipGracefulShutdown) {
      this.setupGracefulShutdown();
    }

    const mcpMode = process.env.MCP_MODE?.toLowerCase();
    if (mcpMode !== 'code') {
      this.registerBuiltInTools();
    }

    this.logger.info('MCPServer initialized');
  }

  private registerBuiltInTools(): void {
    const searchTool: Tool = {
      name: 'search_tools',
      description: 'Search registered tools by name or description.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query applied to tool names and descriptions.',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of tools to return.',
            minimum: 1,
            default: 10,
          },
        },
        required: ['query'],
      },
    };

    this.registerTool(searchTool, async (params: { query: string; limit?: number }) => {
      const query = params.query?.toLowerCase() ?? '';
      const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
      const matches = Array.from(this.tools.values())
        .map((entry) => entry.tool)
        .filter((tool) => {
          const nameMatch = tool.name.toLowerCase().includes(query);
          const descriptionMatch = (tool.description ?? '').toLowerCase().includes(query);
          return nameMatch || descriptionMatch;
        })
        .slice(0, limit)
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));

      return {
        total: matches.length,
        tools: matches,
      };
    });
  }

  /**
   * Add an event listener and track it for cleanup
   */
  private addTrackedListener(target: any, event: string, handler: (...args: any[]) => void): void {
    target.on(event, handler);
    this.eventListeners.push({ target, event, handler });
  }

  /**
   * Remove all tracked event listeners
   */
  private removeAllListeners(): void {
    for (const { target, event, handler } of this.eventListeners) {
      try {
        target.removeListener(event, handler);
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.eventListeners = [];
  }

  /**
   * Set up custom error handling for the transport
   */
  private setupTransportErrorHandling(): void {
    // Handle connection errors in the transport
    // StdioServerTransport uses the process stdin/stdout directly
    this.addTrackedListener(process.stdin, 'error', (error) => {
      this.logger.error('Transport stdin error:', error);
      // Don't throw - log and continue
    });

    this.addTrackedListener(process.stdout, 'error', (error) => {
      this.logger.error('Transport stdout error:', error);
      // Don't throw - log and continue
    });

    // Add additional error event listeners to catch more issues
    if (process.stdin.on && typeof process.stdin.on === 'function') {
      this.addTrackedListener(process.stdin, 'close', () => {
        this.logger.warn('Transport stdin closed unexpectedly');
        this.gracefulRestart();
      });
    }

    if (process.stdout.on && typeof process.stdout.on === 'function') {
      this.addTrackedListener(process.stdout, 'close', () => {
        this.logger.warn('Transport stdout closed unexpectedly');
        this.gracefulRestart();
      });
    }
  }

  /**
   * Attempt to gracefully restart the server connection
   */
  private async gracefulRestart(): Promise<void> {
    if (this.isShuttingDown) return;

    this.logger.info('Attempting to gracefully restart server connection...');

    try {
      // Close existing connection
      await this.server.close();

      // Small delay to allow resources to be released
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Create a new transport instance since the old one might be in an invalid state
      this.transport = new StdioServerTransport();

      // Reconnect
      await this.server.connect(this.transport);
      this.logger.info('Server connection restarted successfully');
    } catch (error) {
      this.logger.error('Failed to restart server connection', error);

      // If we get an error about the transport already being started,
      // try to create a completely new server instance
      if (
        error instanceof Error &&
        error.message.includes('StdioServerTransport already started')
      ) {
        this.logger.info('Attempting to create new server instance...');
        try {
          // Re-initialize the server
          this.server = new Server(
            {
              name: 'kubeview-mcp',
              version: '',
            },
            {
              capabilities: {
                tools: {},
                resources: {},
                prompts: {},
              },
            },
          );

          // Recreate the transport
          this.transport = new StdioServerTransport();

          // Re-register all handlers
          this.setupHandlers();

          // Reconnect
          await this.server.connect(this.transport);
          this.logger.info('Server reconnected with new instance successfully');
        } catch (nestedError) {
          this.logger.error('Failed to create new server instance', nestedError);
        }
      }
    }
  }

  /**
   * Set up request handlers for MCP protocol
   */
  private setupHandlers(): void {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // Notify plugins that a new conversation has started. Most MCP clients
      // request tool listings at the start of a session.
      for (const plugin of this.plugins.values()) {
        if (typeof plugin.onNewConversation === 'function') {
          try {
            await plugin.onNewConversation();
          } catch (err) {
            this.logger.warn('Plugin onNewConversation hook failed', {
              plugin: plugin.name,
              error: err,
            });
          }
        }
      }
      const tools = Array.from(this.tools.values()).map((entry) => entry.tool);
      this.logger.debug(`Listing ${tools.length} tools`);
      return { tools };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolEntry = this.tools.get(request.params.name);

      if (!toolEntry) {
        const error = `Tool not found: ${request.params.name}`;
        this.logger.error(error);
        throw new Error(error);
      }

      const argsForLog = isSensitiveMaskEnabled()
        ? maskObjectDeep(request.params.arguments)
        : request.params.arguments;
      this.logger.info(`Executing tool: ${request.params.name}`, {
        arguments: argsForLog,
      });

      try {
        const result = await toolEntry.handler(request.params.arguments);
        const outputPayload = isSensitiveMaskEnabled() ? maskObjectDeep(result) : result;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(outputPayload, null, 2),
            },
          ],
        };
      } catch (error) {
        this.logger.error(`Tool execution failed: ${request.params.name}`, error);
        throw error;
      }
    });

    // Handle resource listing
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = Array.from(this.resources.values());
      this.logger.debug(`Listing ${resources.length} resources`);
      return { resources };
    });

    // Handle resource reading
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const resource = this.resources.get(request.params.uri);

      if (!resource) {
        const error = `Resource not found: ${request.params.uri}`;
        this.logger.error(error);
        throw new Error(error);
      }

      this.logger.info(`Reading resource: ${request.params.uri}`);

      // If the resource has text content directly attached (custom extension for this server)
      // or if we store content in a separate map.
      // For now, let's assume we might extend the Resource type or store it separately.
      // But wait, the Resource interface from SDK doesn't have 'text'.
      // We should probably store the content in a separate map or extend the type locally.
      // Let's check how we register it.

      // Since we are defining the server, we can cast it or look it up.
      // Let's assume we store content in a parallel map or cast to any.
      const content = (resource as any).text || `Resource content for ${request.params.uri}`;

      return {
        contents: [
          {
            type: 'text',
            text: content,
            uri: request.params.uri,
            mimeType: resource.mimeType,
          },
        ],
      };
    });

    // Handle resource template listing
    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      const templates = Array.from(this.resourceTemplates.values());
      this.logger.debug(`Listing ${templates.length} resource templates`);
      return { resourceTemplates: templates };
    });

    // Handle prompt listing
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      const prompts = Array.from(this.prompts.values()).map((entry) => ({
        name: entry.name,
        description: entry.description,
        arguments: entry.arguments,
      }));
      this.logger.debug(`Listing ${prompts.length} prompts`);
      return { prompts };
    });

    // Handle prompt getting
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const promptEntry = this.prompts.get(request.params.name);
      if (!promptEntry) {
        const error = `Prompt not found: ${request.params.name}`;
        this.logger.error(error);
        throw new Error(error);
      }

      this.logger.info(`Getting prompt: ${request.params.name}`);
      const messages = await promptEntry.getMessages(request.params.arguments);
      return {
        description: promptEntry.description,
        messages,
      };
    });
  }

  /**
   * Register a tool with the MCP server
   */
  public registerTool(tool: Tool, handler: (params: any) => Promise<any>): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool already registered: ${tool.name}, overwriting`);
    }

    this.tools.set(tool.name, { tool, handler });
    this.logger.info(`Registered tool: ${tool.name}`);
  }

  /**
   * Get all registered tools
   */
  public getTools(): Tool[] {
    return Array.from(this.tools.values()).map((t) => t.tool);
  }

  /**
   * Execute a tool directly (for internal use, e.g., from run_code sandbox)
   */
  public async executeTool(toolName: string, params: unknown): Promise<unknown> {
    const toolEntry = this.tools.get(toolName);
    if (!toolEntry) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    return toolEntry.handler(params);
  }

  /**
   * Register a resource with the MCP server
   */
  public registerResource(resource: Resource): void {
    if (this.resources.has(resource.uri)) {
      this.logger.warn(`Resource already registered: ${resource.uri}, overwriting`);
    }

    this.resources.set(resource.uri, resource);
    this.logger.info(`Registered resource: ${resource.uri}`);
  }

  /**
   * Register a prompt with the MCP server
   */
  public registerPrompt(prompt: PromptEntry): void {
    if (this.prompts.has(prompt.name)) {
      this.logger.warn(`Prompt already registered: ${prompt.name}, overwriting`);
    }

    this.prompts.set(prompt.name, prompt);
    this.logger.info(`Registered prompt: ${prompt.name}`);
  }

  /**
   * Load and initialize a plugin
   */
  public async loadPlugin(plugin: MCPPlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin already loaded: ${plugin.name}`);
    }

    this.logger.info(`Loading plugin: ${plugin.name}`);

    try {
      await plugin.initialize(this);
      this.plugins.set(plugin.name, plugin);
      this.logger.info(`Plugin loaded successfully: ${plugin.name}`);
    } catch (error) {
      this.logger.error(`Failed to load plugin: ${plugin.name}`, error);
      throw error;
    }
  }

  /**
   * Start the MCP server
   */
  public async start(): Promise<void> {
    this.logger.info('Starting MCP server...');

    try {
      if (this.options.skipTransportErrorHandling) {
        // Simple connection for tests
        await this.server.connect(this.transport);
      } else {
        // Wrap the connection with our custom error handling for production
        await this.connectWithErrorHandling();
      }
      this.logger.info('MCP server started successfully');
    } catch (error) {
      this.logger.error('Failed to start MCP server', error);
      throw error;
    }
  }

  /**
   * Connect to the transport with improved error handling
   */
  private async connectWithErrorHandling(): Promise<void> {
    // Add global handler for parse errors that might not be caught by the SDK
    const originalStdinData = process.stdin.listeners('data') as Array<(chunk: Buffer) => void>;

    // Add our handler before the SDK's handlers
    process.stdin.removeAllListeners('data');

    process.stdin.on('data', (chunk: Buffer) => {
      try {
        // Try to parse as JSON to catch syntax errors early
        const str = chunk.toString().trim();
        if (str.length > 0) {
          try {
            JSON.parse(str);
          } catch (err) {
            this.logger.warn(
              `Received invalid JSON: ${str.substring(0, 100)}${str.length > 100 ? '...' : ''}`,
            );
            this.logger.error('JSON parse error:', err);
            // Continue processing - the SDK will handle the error
          }
        }
      } catch (err) {
        this.logger.error('Error in pre-processing stdin data:', err);
      }
    });

    // Re-add original listeners
    for (const listener of originalStdinData) {
      process.stdin.on('data', listener);
    }

    // Connect to the transport
    await this.server.connect(this.transport);
  }

  /**
   * Stop the MCP server
   */
  public async stop(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.logger.info('Stopping MCP server...');

    // Remove all tracked event listeners
    this.removeAllListeners();

    // Shutdown plugins
    for (const [name, plugin] of this.plugins) {
      if (plugin.shutdown) {
        try {
          await plugin.shutdown();
          this.logger.info(`Plugin shutdown complete: ${name}`);
        } catch (error) {
          this.logger.error(`Plugin shutdown failed: ${name}`, error);
        }
      }
    }

    // Close server connection
    await this.server.close();
    this.logger.info('MCP server stopped');
  }

  /**
   * Set up graceful shutdown handling
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      this.logger.info(`Received ${signal}, initiating graceful shutdown...`);
      await this.stop();
      process.exit(0);
    };

    this.addTrackedListener(process, 'SIGINT', () => shutdown('SIGINT'));
    this.addTrackedListener(process, 'SIGTERM', () => shutdown('SIGTERM'));

    this.addTrackedListener(process, 'uncaughtException', (error) => {
      this.logger.error('Uncaught exception:', error);
      shutdown('uncaughtException');
    });

    this.addTrackedListener(process, 'unhandledRejection', (reason) => {
      this.logger.error('Unhandled rejection:', reason);
      shutdown('unhandledRejection');
    });
  }

  /**
   * Get the logger instance
   */
  public getLogger(): winston.Logger {
    return this.logger;
  }

  /**
   * Get the underlying MCP server instance
   */
  public getServer(): Server {
    return this.server;
  }

  /**
   * Clean up resources and event listeners (useful for tests)
   */
  public cleanup(): void {
    this.removeAllListeners();
  }
}

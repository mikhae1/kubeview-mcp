import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  Tool,
  Resource,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/types.js';
import winston from 'winston';

/**
 * Plugin interface for extending MCP server functionality
 */
export interface MCPPlugin {
  name: string;
  version: string;
  initialize(server: MCPServer): Promise<void>;
  shutdown?(): Promise<void>;
}

/**
 * Tool registry entry
 */
interface ToolEntry {
  tool: Tool;
  handler: (params: any) => Promise<any>;
}

/**
 * Core MCP Server implementation for Kubernetes operations
 */
export class MCPServer {
  private server: Server;
  private transport: StdioServerTransport;
  private logger: winston.Logger;
  private tools: Map<string, ToolEntry> = new Map();
  private resources: Map<string, Resource> = new Map();
  private resourceTemplates: Map<string, ResourceTemplate> = new Map();
  private plugins: Map<string, MCPPlugin> = new Map();
  private isShuttingDown = false;

  constructor() {
    // Initialize Winston logger
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
        }),
        new winston.transports.File({
          filename: 'kube-mcp.log',
          format: winston.format.json(),
        }),
      ],
    });

    // Initialize MCP server
    this.server = new Server(
      {
        name: 'kube-mcp',
        version: '0.1.0',
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

    // Set up handlers
    this.setupHandlers();

    // Set up graceful shutdown
    this.setupGracefulShutdown();

    this.logger.info('MCPServer initialized');
  }

  /**
   * Set up request handlers for MCP protocol
   */
  private setupHandlers(): void {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
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

      this.logger.info(`Executing tool: ${request.params.name}`, {
        arguments: request.params.arguments,
      });

      try {
        const result = await toolEntry.handler(request.params.arguments);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
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

      // This is a placeholder - actual resource reading logic would go here
      return {
        contents: [
          {
            type: 'text',
            text: `Resource content for ${request.params.uri}`,
            uri: request.params.uri,
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
   * Load and initialize a plugin
   */
  public async loadPlugin(plugin: MCPPlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin already loaded: ${plugin.name}`);
    }

    this.logger.info(`Loading plugin: ${plugin.name} v${plugin.version}`);

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
      await this.server.connect(this.transport);
      this.logger.info('MCP server started successfully');
    } catch (error) {
      this.logger.error('Failed to start MCP server', error);
      throw error;
    }
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

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception:', error);
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
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
}

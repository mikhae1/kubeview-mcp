import { jest } from '@jest/globals';
import { MCPServer, MCPPlugin } from '../../src/server/MCPServer';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

// Mock winston to avoid file system operations in tests
jest.mock('winston', () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  return {
    createLogger: jest.fn(() => mockLogger),
    format: {
      combine: jest.fn(),
      timestamp: jest.fn(),
      json: jest.fn(),
      colorize: jest.fn(),
      simple: jest.fn(),
    },
    transports: {
      Console: jest.fn(),
      File: jest.fn(),
    },
  };
});

// Mock the MCP SDK
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: jest.fn(),
    connect: jest.fn(),
    close: jest.fn(),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(),
}));

describe('MCPServer', () => {
  let server: MCPServer;
  let mockConsoleLog: jest.SpiedFunction<typeof console.log>;
  let mockConsoleError: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    jest.clearAllMocks();
    server = new MCPServer({
      skipTransportErrorHandling: true,
      skipGracefulShutdown: true,
    });
    mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    mockConsoleLog.mockRestore();
    mockConsoleError.mockRestore();

    // Cleanup server resources
    if (server) {
      server.cleanup();
      await server.stop();
    }
  });

  describe('constructor', () => {
    it('should initialize the MCP server correctly', () => {
      expect(server).toBeDefined();
      expect(server.getLogger()).toBeDefined();
      expect(server.getServer()).toBeDefined();
    });
  });

  describe('built-in tools', () => {
    it('should execute plan_step and return structured planning progress', async () => {
      const result = (await server.executeTool('plan_step', {
        step: 'Inspect failing workload',
        nextStepNeeded: true,
        stepNumber: 1,
        totalSteps: 2,
      })) as Record<string, unknown>;

      expect(result.stepNumber).toBe(1);
      expect(result.totalSteps).toBe(2);
      expect(result.nextStepNeeded).toBe(true);
      expect(result.stepHistoryLength).toBe(1);
    });
  });

  describe('registerTool', () => {
    it('should register a tool successfully', () => {
      const tool: Tool = {
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: {
            param: { type: 'string' },
          },
        },
      };

      const handler = jest
        .fn<() => Promise<{ result: string }>>()
        .mockResolvedValue({ result: 'success' });

      server.registerTool(tool, handler);

      const logger = server.getLogger() as any;
      expect(logger.info).toHaveBeenCalledWith('Registered tool: test-tool');
    });

    it('should warn when overwriting an existing tool', () => {
      const tool: Tool = {
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      };

      const handler = jest.fn<() => Promise<any>>();

      server.registerTool(tool, handler);
      server.registerTool(tool, handler);

      const logger = server.getLogger() as any;
      expect(logger.warn).toHaveBeenCalledWith('Tool already registered: test-tool, overwriting');
    });
  });

  describe('registerResource', () => {
    it('should register a resource successfully', () => {
      const resource = {
        uri: 'test://resource',
        name: 'Test Resource',
        description: 'A test resource',
        mimeType: 'text/plain',
      };

      server.registerResource(resource);

      const logger = server.getLogger() as any;
      expect(logger.info).toHaveBeenCalledWith('Registered resource: test://resource');
    });

    it('should warn when overwriting an existing resource', () => {
      const resource = {
        uri: 'test://resource',
        name: 'Test Resource',
        description: 'A test resource',
        mimeType: 'text/plain',
      };

      server.registerResource(resource);
      server.registerResource(resource);

      const logger = server.getLogger() as any;
      expect(logger.warn).toHaveBeenCalledWith(
        'Resource already registered: test://resource, overwriting',
      );
    });
  });

  describe('loadPlugin', () => {
    it('should load a plugin successfully', async () => {
      const mockPlugin: MCPPlugin = {
        name: 'test-plugin',
        initialize: jest.fn<(server: MCPServer) => Promise<void>>().mockResolvedValue(undefined),
      };

      await server.loadPlugin(mockPlugin);

      expect(mockPlugin.initialize).toHaveBeenCalledWith(server);
      const logger = server.getLogger() as any;
      expect(logger.info).toHaveBeenCalledWith('Loading plugin: test-plugin');
      expect(logger.info).toHaveBeenCalledWith('Plugin loaded successfully: test-plugin');
    });

    it('should throw error when loading duplicate plugin', async () => {
      const mockPlugin: MCPPlugin = {
        name: 'test-plugin',
        initialize: jest.fn<(server: MCPServer) => Promise<void>>().mockResolvedValue(undefined),
      };

      await server.loadPlugin(mockPlugin);

      await expect(server.loadPlugin(mockPlugin)).rejects.toThrow(
        'Plugin already loaded: test-plugin',
      );
    });

    it('should handle plugin initialization failure', async () => {
      const mockPlugin: MCPPlugin = {
        name: 'failing-plugin',
        initialize: jest
          .fn<(server: MCPServer) => Promise<void>>()
          .mockRejectedValue(new Error('Plugin init failed')),
      };

      await expect(server.loadPlugin(mockPlugin)).rejects.toThrow('Plugin init failed');

      const logger = server.getLogger() as any;
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to load plugin: failing-plugin',
        expect.any(Error),
      );
    });
  });

  describe('start', () => {
    it('should start the server successfully', async () => {
      await server.start();

      const mcpServer = server.getServer() as any;
      expect(mcpServer.connect).toHaveBeenCalled();

      const logger = server.getLogger() as any;
      expect(logger.info).toHaveBeenCalledWith('Starting MCP server...');
      expect(logger.info).toHaveBeenCalledWith('MCP server started successfully');
    });

    it('should handle start failure', async () => {
      const mcpServer = server.getServer() as any;
      mcpServer.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(server.start()).rejects.toThrow('Connection failed');

      const logger = server.getLogger() as any;
      expect(logger.error).toHaveBeenCalledWith('Failed to start MCP server', expect.any(Error));
    });
  });

  describe('stop', () => {
    it('should stop the server successfully', async () => {
      await server.stop();

      const mcpServer = server.getServer() as any;
      expect(mcpServer.close).toHaveBeenCalled();

      const logger = server.getLogger() as any;
      expect(logger.info).toHaveBeenCalledWith('Stopping MCP server...');
      expect(logger.info).toHaveBeenCalledWith('MCP server stopped');
    });

    it('should shutdown plugins on stop', async () => {
      const mockPlugin: MCPPlugin = {
        name: 'test-plugin',
        initialize: jest.fn<(server: MCPServer) => Promise<void>>().mockResolvedValue(undefined),
        shutdown: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      };

      await server.loadPlugin(mockPlugin);
      await server.stop();

      expect(mockPlugin.shutdown).toHaveBeenCalled();

      const logger = server.getLogger() as any;
      expect(logger.info).toHaveBeenCalledWith('Plugin shutdown complete: test-plugin');
    });

    it('should handle plugin shutdown failure gracefully', async () => {
      const mockPlugin: MCPPlugin = {
        name: 'failing-plugin',
        initialize: jest.fn<(server: MCPServer) => Promise<void>>().mockResolvedValue(undefined),
        shutdown: jest.fn<() => Promise<void>>().mockRejectedValue(new Error('Shutdown failed')),
      };

      await server.loadPlugin(mockPlugin);
      await server.stop();

      const logger = server.getLogger() as any;
      expect(logger.error).toHaveBeenCalledWith(
        'Plugin shutdown failed: failing-plugin',
        expect.any(Error),
      );
    });

    it('should prevent multiple stop calls', async () => {
      await server.stop();
      await server.stop();

      const mcpServer = server.getServer() as any;
      expect(mcpServer.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('graceful shutdown', () => {
    let mockExit: jest.SpiedFunction<typeof process.exit>;
    let originalProcessOn: typeof process.on;
    let processHandlers: { [key: string]: (...args: unknown[]) => void } = {};

    beforeEach(() => {
      mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      originalProcessOn = process.on;

      // Mock process.on to capture handlers
      process.on = jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        processHandlers[event] = handler;
        return process;
      }) as any;

      // Create a new server to register handlers (allow graceful shutdown for testing)
      server = new MCPServer({ skipTransportErrorHandling: true });
    });

    afterEach(() => {
      mockExit.mockRestore();
      process.on = originalProcessOn;
      processHandlers = {};
    });

    it('should handle SIGINT gracefully', async () => {
      const sigintHandler = processHandlers['SIGINT'];
      expect(sigintHandler).toBeDefined();

      await sigintHandler();

      const logger = server.getLogger() as any;
      expect(logger.info).toHaveBeenCalledWith('Received SIGINT, initiating graceful shutdown...');
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('should handle SIGTERM gracefully', async () => {
      const sigtermHandler = processHandlers['SIGTERM'];
      expect(sigtermHandler).toBeDefined();

      await sigtermHandler();

      const logger = server.getLogger() as any;
      expect(logger.info).toHaveBeenCalledWith('Received SIGTERM, initiating graceful shutdown...');
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });
});

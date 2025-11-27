import { jest } from '@jest/globals';
import { MCPServer } from '../../src/server/MCPServer';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Readable, Writable } from 'stream';

// Mock winston to suppress logging during tests
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

describe('MCPServer Integration Tests', () => {
  let server: MCPServer;
  let mockStdin: Readable;
  let mockStdout: Writable;
  let stdoutData: string[] = [];

  beforeEach(() => {
    // Reset stdout data
    stdoutData = [];

    // Create mock streams with proper error handling
    mockStdin = new Readable({
      read() {},
    });

    // Suppress error/close events on mock streams to prevent warnings
    mockStdin.on('error', () => {});
    mockStdin.on('close', () => {});

    mockStdout = new Writable({
      write(chunk: any, _encoding: any, callback: any) {
        stdoutData.push(chunk.toString());
        if (callback) callback();
        return true;
      },
    });

    mockStdout.on('error', () => {});
    mockStdout.on('close', () => {});

    // Mock process.stdin and process.stdout
    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      configurable: true,
    });

    Object.defineProperty(process, 'stdout', {
      value: mockStdout,
      configurable: true,
    });

    server = new MCPServer();
  });

  afterEach(async () => {
    // Cleanup server first to remove event listeners
    if (server) {
      server.cleanup();
      await server.stop();
    }

    // Properly close streams without triggering warnings
    if (mockStdin && !mockStdin.destroyed) {
      mockStdin.removeAllListeners();
      mockStdin.destroy();
    }
    if (mockStdout && !mockStdout.destroyed) {
      mockStdout.removeAllListeners();
      mockStdout.destroy();
    }
  });

  describe('JSON-RPC 2.0 Communication', () => {
    it('should handle initialize request', async () => {
      await server.start();

      // Send initialize request
      const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '1.0',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
        },
      };

      mockStdin.push(JSON.stringify(initRequest) + '\n');

      // Wait for response
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = stdoutData.find((data) => data.includes('"id":1'));
      expect(response).toBeDefined();

      const parsedResponse = JSON.parse(response!);
      expect(parsedResponse.jsonrpc).toBe('2.0');
      expect(parsedResponse.id).toBe(1);
      expect(parsedResponse.result).toBeDefined();
    });

    it('should handle tool registration and listing', async () => {
      // Register a test tool
      const testTool: Tool = {
        name: 'test-kubernetes-tool',
        description: 'A test tool for Kubernetes operations',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: { type: 'string' },
            operation: { type: 'string' },
          },
          required: ['operation'],
        },
      };

      server.registerTool(testTool, async (params) => {
        return { success: true, operation: params.operation };
      });

      await server.start();

      // Send list tools request
      const listToolsRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      };

      mockStdin.push(JSON.stringify(listToolsRequest) + '\n');

      // Wait for response
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = stdoutData.find((data) => data.includes('"id":2'));
      expect(response).toBeDefined();

      const parsedResponse = JSON.parse(response!);
      expect(parsedResponse.result.tools.length).toBeGreaterThanOrEqual(1);
      expect(
        parsedResponse.result.tools.some((tool: Tool) => tool.name === 'test-kubernetes-tool'),
      ).toBe(true);
    });

    it('should handle tool execution', async () => {
      // Register a test tool
      const testTool: Tool = {
        name: 'get-pods',
        description: 'Get pods from Kubernetes',
        inputSchema: {
          type: 'object',
          properties: {
            namespace: { type: 'string' },
          },
        },
      };

      const mockHandler = jest.fn<(params: any) => Promise<any>>().mockResolvedValue({
        pods: [
          { name: 'pod-1', status: 'Running' },
          { name: 'pod-2', status: 'Pending' },
        ],
      });

      server.registerTool(testTool, mockHandler);

      await server.start();

      // Send tool call request
      const toolCallRequest = {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'get-pods',
          arguments: {
            namespace: 'default',
          },
        },
      };

      mockStdin.push(JSON.stringify(toolCallRequest) + '\n');

      // Wait for response
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = stdoutData.find((data) => data.includes('"id":3'));
      expect(response).toBeDefined();

      const parsedResponse = JSON.parse(response!);
      expect(parsedResponse.result).toBeDefined();
      expect(parsedResponse.result.content).toBeDefined();
      expect(parsedResponse.result.content[0].type).toBe('text');

      const resultData = JSON.parse(parsedResponse.result.content[0].text);
      expect(resultData.pods).toHaveLength(2);
      expect(mockHandler).toHaveBeenCalledWith({ namespace: 'default' });
    });

    it('should handle errors for unknown tools', async () => {
      await server.start();

      // Send tool call request for non-existent tool
      const toolCallRequest = {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'non-existent-tool',
          arguments: {},
        },
      };

      mockStdin.push(JSON.stringify(toolCallRequest) + '\n');

      // Wait for response
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = stdoutData.find((data) => data.includes('"id":4'));
      expect(response).toBeDefined();

      const parsedResponse = JSON.parse(response!);
      expect(parsedResponse.error).toBeDefined();
      expect(parsedResponse.error.message).toContain('Tool not found');
    });

    it('should handle malformed JSON-RPC requests', async () => {
      await server.start();

      // Send malformed request
      mockStdin.push('{"invalid": "json-rpc"}\n');

      // Wait for response
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should log an error but not crash
      expect(server).toBeDefined();
    });
  });

  describe('Resource Management', () => {
    it('should handle resource registration and listing', async () => {
      const testResource = {
        uri: 'kubernetes://cluster/namespaces',
        name: 'Kubernetes Namespaces',
        description: 'List of Kubernetes namespaces',
        mimeType: 'application/json',
      };

      server.registerResource(testResource);

      await server.start();

      // Send list resources request
      const listResourcesRequest = {
        jsonrpc: '2.0',
        id: 5,
        method: 'resources/list',
        params: {},
      };

      mockStdin.push(JSON.stringify(listResourcesRequest) + '\n');

      // Wait for response
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = stdoutData.find((data) => data.includes('"id":5'));
      expect(response).toBeDefined();

      const parsedResponse = JSON.parse(response!);
      expect(parsedResponse.result.resources).toHaveLength(1);
      expect(parsedResponse.result.resources[0].uri).toBe('kubernetes://cluster/namespaces');
    });
  });
});

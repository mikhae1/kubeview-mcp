import { KubernetesToolsPlugin } from '../../src/plugins/KubernetesToolsPlugin.js';
import { KubernetesClient } from '../../src/kubernetes/KubernetesClient.js';
import { MCPServer } from '../../src/server/MCPServer.js';
import winston from 'winston';

// Mock dependencies
jest.mock('../../src/kubernetes/KubernetesClient.js');
jest.mock('winston');

// Create mock tool instances
const createMockTool = (name: string) => ({
  tool: {
    name,
    description: `Mock ${name}`,
    inputSchema: { type: 'object', properties: {} },
  },
  execute: jest.fn().mockResolvedValue({ result: 'mock result' }),
});

// Mock the tools module (consolidated)
jest.mock('../../src/tools/kubernetes/index.js', () => {
  return {
    KubeListTool: jest.fn().mockImplementation(() => createMockTool('kube_list')),
    KubeMetricsTool: jest.fn().mockImplementation(() => createMockTool('kube_metrics')),
    GetResourceTool: jest.fn().mockImplementation(() => createMockTool('kube_get')),
    GetContainerLogsTool: jest.fn().mockImplementation(() => createMockTool('kube_logs')),
    KubeLogTool: jest.fn().mockImplementation(() => createMockTool('kube_log')),
    PortForwardTool: jest.fn().mockImplementation(() => createMockTool('kube_port')),
    ExecTool: jest.fn().mockImplementation(() => createMockTool('kube_exec')),
    KubeNetTool: jest.fn().mockImplementation(() => createMockTool('kube_net')),
  };
});

describe('KubernetesToolsPlugin', () => {
  let plugin: KubernetesToolsPlugin;
  let mockServer: jest.Mocked<MCPServer>;
  let mockClient: jest.Mocked<KubernetesClient>;
  let mockLogger: jest.Mocked<winston.Logger>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock winston logger
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      level: 'info',
    } as any;

    // Mock KubernetesClient
    mockClient = {
      core: {
        listPodForAllNamespaces: jest.fn().mockResolvedValue({ items: [] }),
      },
      refreshCurrentContext: jest.fn().mockResolvedValue(undefined),
      testConnection: jest.fn().mockResolvedValue(true),
      getCurrentContext: jest.fn().mockReturnValue('test-context'),
      getAuthMethod: jest.fn().mockReturnValue('kubeconfig'),
    } as any;

    (KubernetesClient as unknown as jest.Mock).mockImplementation(() => mockClient);

    // Mock MCPServer
    mockServer = {
      getLogger: jest.fn().mockReturnValue(mockLogger),
      registerTool: jest.fn(),
    } as any;

    plugin = new KubernetesToolsPlugin();
  });

  describe('Context Refresh Integration', () => {
    it('should refresh context when creating new client for MCP tool execution', async () => {
      await plugin.initialize(mockServer);

      // Get the registered tool handler for kube_list
      const registerToolCalls = mockServer.registerTool.mock.calls;
      const kubeListCall = registerToolCalls.find((call) => call[0].name === 'kube_list');

      expect(kubeListCall).toBeDefined();

      // Execute the tool handler
      const toolHandler = kubeListCall![1];
      await toolHandler({});

      // Verify that refreshCurrentContext was called
      expect(mockClient.refreshCurrentContext).toHaveBeenCalled();
      expect(mockClient.testConnection).toHaveBeenCalled();
    });

    it('should refresh context when executing tool via getToolFunction', async () => {
      await plugin.initialize(mockServer);

      const toolFunction = plugin.getToolFunction('kube_list');
      expect(toolFunction).toBeDefined();

      // Execute the tool function
      await toolFunction!({});

      // Verify that refreshCurrentContext was called
      expect(mockClient.refreshCurrentContext).toHaveBeenCalled();
      expect(mockClient.testConnection).toHaveBeenCalled();
    });

    it('should refresh context when executing command via static executeCommand', async () => {
      await KubernetesToolsPlugin.executeCommand('kube_list', {});

      // Verify that refreshCurrentContext was called
      expect(mockClient.refreshCurrentContext).toHaveBeenCalled();
      expect(mockClient.testConnection).toHaveBeenCalled();
    });

    it('should handle refresh context errors gracefully', async () => {
      // Make refreshCurrentContext throw an error
      mockClient.refreshCurrentContext.mockRejectedValue(new Error('Refresh failed'));
      mockClient.testConnection.mockResolvedValue(false);

      await plugin.initialize(mockServer);

      const registerToolCalls = mockServer.registerTool.mock.calls;
      const kubeListCall = registerToolCalls.find((call) => call[0].name === 'kube_list');
      const toolHandler = kubeListCall![1];

      // Should throw because refreshCurrentContext fails
      await expect(toolHandler({})).rejects.toThrow('Refresh failed');

      // testConnection should not be called if refresh fails
      expect(mockClient.testConnection).not.toHaveBeenCalled();
    });
  });

  describe('Plugin Initialization', () => {
    it('should initialize and register all consolidated tools', async () => {
      await plugin.initialize(mockServer);

      // Should register all consolidated tools (now includes kube_log)
      expect(mockServer.registerTool).toHaveBeenCalledTimes(8);

      // Verify some specific tools are registered
      const toolNames = mockServer.registerTool.mock.calls.map((call) => call[0].name);
      expect(toolNames).toContain('kube_list');
      expect(toolNames).toContain('kube_metrics');
      expect(toolNames).toContain('kube_get');
      expect(toolNames).toContain('kube_log');
      expect(toolNames).toContain('kube_port');
      expect(toolNames).toContain('kube_exec');
      expect(toolNames).toContain('kube_net');
    });

    it('should handle initialization errors', async () => {
      mockServer.getLogger.mockImplementation(() => {
        throw new Error('Logger initialization failed');
      });

      await expect(plugin.initialize(mockServer)).rejects.toThrow('Logger initialization failed');
    });
  });

  describe('Tool Execution', () => {
    it('should return undefined for non-existent tool', async () => {
      await plugin.initialize(mockServer);

      const toolFunction = plugin.getToolFunction('non-existent-tool');
      expect(toolFunction).toBeUndefined();
    });

    it('should handle client creation failures', async () => {
      (KubernetesClient as unknown as jest.Mock).mockImplementation(() => {
        throw new Error('Client creation failed');
      });

      await plugin.initialize(mockServer);

      const registerToolCalls = mockServer.registerTool.mock.calls;
      const kubeListCall = registerToolCalls.find((call) => call[0].name === 'kube_list');
      const toolHandler = kubeListCall![1];

      await expect(toolHandler({})).rejects.toThrow('Client creation failed');
    });
  });
});

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

// Mock the tools module
jest.mock('../../src/tools/kubernetes/index.js', () => {
  return {
    GetPodsTool: jest.fn().mockImplementation(() => createMockTool('get_pods')),
    GetPodMetricsTool: jest.fn().mockImplementation(() => createMockTool('get_pod_metrics')),
    GetServicesTool: jest.fn().mockImplementation(() => createMockTool('get_services')),
    GetIngressTool: jest.fn().mockImplementation(() => createMockTool('get_ingresses')),
    GetDeploymentsTool: jest.fn().mockImplementation(() => createMockTool('get_deployments')),
    GetNodesTool: jest.fn().mockImplementation(() => createMockTool('get_nodes')),
    GetReplicaSetsTool: jest.fn().mockImplementation(() => createMockTool('get_replicasets')),
    GetStatefulSetsTool: jest.fn().mockImplementation(() => createMockTool('get_statefulsets')),
    GetDaemonSetsTool: jest.fn().mockImplementation(() => createMockTool('get_daemonsets')),
    GetJobsTool: jest.fn().mockImplementation(() => createMockTool('get_jobs')),
    GetCronJobsTool: jest.fn().mockImplementation(() => createMockTool('get_cronjobs')),
    GetHPATool: jest.fn().mockImplementation(() => createMockTool('get_hpa')),
    GetPDBTool: jest.fn().mockImplementation(() => createMockTool('get_pdb')),
    GetEndpointsTool: jest.fn().mockImplementation(() => createMockTool('get_endpoints')),
    GetEndpointSlicesTool: jest.fn().mockImplementation(() => createMockTool('get_endpointslices')),
    GetResourceQuotaTool: jest.fn().mockImplementation(() => createMockTool('get_resourcequotas')),
    GetLimitRangesTool: jest.fn().mockImplementation(() => createMockTool('get_limitranges')),
    GetResourceTool: jest.fn().mockImplementation(() => createMockTool('get_resource')),
    GetContainerLogsTool: jest.fn().mockImplementation(() => createMockTool('pod_logs')),
    GetEventsTool: jest.fn().mockImplementation(() => createMockTool('get_events')),
    GetNamespacesTool: jest.fn().mockImplementation(() => createMockTool('get_namespaces')),
    GetMetricsTool: jest.fn().mockImplementation(() => createMockTool('get_metrics')),
    GetConfigMapTool: jest.fn().mockImplementation(() => createMockTool('get_configmaps')),
    GetSecretsTool: jest.fn().mockImplementation(() => createMockTool('get_secrets')),
    GetPersistentVolumesTool: jest
      .fn()
      .mockImplementation(() => createMockTool('get_persistent_volumes')),
    GetPersistentVolumeClaimsTool: jest
      .fn()
      .mockImplementation(() => createMockTool('get_persistent_volume_claims')),
    PortForwardTool: jest.fn().mockImplementation(() => createMockTool('port_forward')),
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

      // Get the registered tool handler for get_pods
      const registerToolCalls = mockServer.registerTool.mock.calls;
      const getPodsCall = registerToolCalls.find((call) => call[0].name === 'get_pods');

      expect(getPodsCall).toBeDefined();

      // Execute the tool handler
      const toolHandler = getPodsCall![1];
      await toolHandler({});

      // Verify that refreshCurrentContext was called
      expect(mockClient.refreshCurrentContext).toHaveBeenCalled();
      expect(mockClient.testConnection).toHaveBeenCalled();
    });

    it('should refresh context when executing tool via getToolFunction', async () => {
      await plugin.initialize(mockServer);

      const toolFunction = plugin.getToolFunction('get_pods');
      expect(toolFunction).toBeDefined();

      // Execute the tool function
      await toolFunction!({});

      // Verify that refreshCurrentContext was called
      expect(mockClient.refreshCurrentContext).toHaveBeenCalled();
      expect(mockClient.testConnection).toHaveBeenCalled();
    });

    it('should refresh context when executing command via static executeCommand', async () => {
      await KubernetesToolsPlugin.executeCommand('get_pods', {});

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
      const getPodsCall = registerToolCalls.find((call) => call[0].name === 'get_pods');
      const toolHandler = getPodsCall![1];

      // Should throw because refreshCurrentContext fails
      await expect(toolHandler({})).rejects.toThrow('Refresh failed');

      // testConnection should not be called if refresh fails
      expect(mockClient.testConnection).not.toHaveBeenCalled();
    });
  });

  describe('Plugin Initialization', () => {
    it('should initialize and register all tools', async () => {
      await plugin.initialize(mockServer);

      // Should register multiple tools
      expect(mockServer.registerTool).toHaveBeenCalledTimes(27); // Updated count with new tools

      // Verify some specific tools are registered
      const toolNames = mockServer.registerTool.mock.calls.map((call) => call[0].name);
      expect(toolNames).toContain('get_pods');
      expect(toolNames).toContain('get_services');
      expect(toolNames).toContain('get_ingresses');
      expect(toolNames).toContain('get_deployments');
      expect(toolNames).toContain('get_metrics');
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
      const getPodsCall = registerToolCalls.find((call) => call[0].name === 'get_pods');
      const toolHandler = getPodsCall![1];

      await expect(toolHandler({})).rejects.toThrow('Client creation failed');
    });
  });
});

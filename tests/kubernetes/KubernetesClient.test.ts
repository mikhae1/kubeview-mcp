import {
  KubernetesClient,
  KubernetesClientConfig,
  AuthMethod,
} from '../../src/kubernetes/KubernetesClient';
import * as k8s from '@kubernetes/client-node';
import { Logger } from 'winston';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Tell Jest to use the manual mock
jest.mock('@kubernetes/client-node');
jest.mock('fs');

describe('KubernetesClient', () => {
  let mockLogger: jest.Mocked<Logger>;
  let mockKubeConfig: any;
  let mockCoreV1Api: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock logger
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as any;

    // Mock file system
    (existsSync as jest.Mock).mockReturnValue(true);

    // Setup mock KubeConfig
    mockKubeConfig = {
      getCurrentContext: jest.fn().mockReturnValue('default'),
      getContexts: jest.fn().mockReturnValue([
        { name: 'default', cluster: 'default-cluster', user: 'default-user' },
        { name: 'test', cluster: 'test-cluster', user: 'test-user' },
      ]),
      getClusters: jest.fn().mockReturnValue([
        { name: 'default-cluster', server: 'https://localhost:6443' },
        { name: 'test-cluster', server: 'https://test.k8s.local:6443' },
      ]),
      loadFromFile: jest.fn(),
      loadFromCluster: jest.fn(),
      loadFromOptions: jest.fn(),
      setCurrentContext: jest.fn(),
      makeApiClient: jest.fn((apiType: any) => {
        if (apiType === k8s.CoreV1Api) {
          return {
            listNamespace: jest.fn().mockResolvedValue({ body: { items: [] } }),
          };
        }
        return {} as any;
      }),
    };

    // Mock the KubeConfig constructor to return our mock instance
    (k8s.KubeConfig as any).mockImplementation(() => mockKubeConfig);

    // Mock CoreV1Api
    mockCoreV1Api = {
      listNamespace: jest.fn().mockResolvedValue({ body: { items: [] } }),
    } as any;

    // Mock k8s module
    mockKubeConfig.makeApiClient.mockReturnValue(mockCoreV1Api);
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with default kubeconfig', () => {
      const client = new KubernetesClient();

      expect(k8s.KubeConfig).toHaveBeenCalled();
      const mockInstance = (k8s.KubeConfig as any).mock.results[0].value;
      expect(mockInstance.loadFromFile).toHaveBeenCalledWith(join(homedir(), '.kube', 'config'));
      expect(client.getAuthMethod()).toBe(AuthMethod.KUBECONFIG);
    });

    it('should initialize with custom kubeconfig path', () => {
      const customPath = '/custom/path/config';
      new KubernetesClient({ kubeConfigPath: customPath });

      const mockInstance = (k8s.KubeConfig as any).mock.results[0].value;
      expect(mockInstance.loadFromFile).toHaveBeenCalledWith(customPath);
    });

    it('should initialize with specific context', () => {
      new KubernetesClient({ context: 'test' });

      const mockInstance = (k8s.KubeConfig as any).mock.results[0].value;
      expect(mockInstance.setCurrentContext).toHaveBeenCalledWith('test');
    });

    it('should throw error if kubeconfig file does not exist', () => {
      (existsSync as jest.Mock).mockReturnValue(false);

      expect(() => new KubernetesClient()).toThrow('Kubeconfig file not found');
    });

    it('should use KUBECONFIG environment variable', () => {
      const envPath = '/env/path/config';
      process.env.KUBECONFIG = envPath;

      new KubernetesClient();

      const mockInstance = (k8s.KubeConfig as any).mock.results[0].value;
      expect(mockInstance.loadFromFile).toHaveBeenCalledWith(envPath);

      delete process.env.KUBECONFIG;
    });

    it('should handle multiple paths in KUBECONFIG environment variable', () => {
      const path1 = '/path1/config';
      const path2 = '/path2/config';
      process.env.KUBECONFIG = `${path1}:${path2}`;

      (existsSync as jest.Mock).mockImplementation((path) => path === path2);

      new KubernetesClient();

      const mockInstance = (k8s.KubeConfig as any).mock.results[0].value;
      expect(mockInstance.loadFromFile).toHaveBeenCalledWith(path2);

      delete process.env.KUBECONFIG;
    });
  });

  describe('In-Cluster Authentication', () => {
    it('should initialize with in-cluster config', () => {
      const client = new KubernetesClient({ inCluster: true });

      const mockInstance = (k8s.KubeConfig as any).mock.results[0].value;
      expect(mockInstance.loadFromCluster).toHaveBeenCalled();
      expect(client.getAuthMethod()).toBe(AuthMethod.IN_CLUSTER);
    });

    it('should use factory method for in-cluster', () => {
      const client = KubernetesClient.fromInCluster(mockLogger);

      const mockInstance = (k8s.KubeConfig as any).mock.results[0].value;
      expect(mockInstance.loadFromCluster).toHaveBeenCalled();
      expect(client.getAuthMethod()).toBe(AuthMethod.IN_CLUSTER);
    });
  });

  describe('Token Authentication', () => {
    it('should initialize with bearer token', () => {
      const config: KubernetesClientConfig = {
        bearerToken: 'test-token',
        apiServerUrl: 'https://api.k8s.local',
      };

      const client = new KubernetesClient(config);

      const mockInstance = (k8s.KubeConfig as any).mock.results[0].value;
      expect(mockInstance.loadFromOptions).toHaveBeenCalledWith({
        clusters: [
          {
            name: 'default',
            server: 'https://api.k8s.local',
            skipTLSVerify: false,
          },
        ],
        users: [
          {
            name: 'default',
            token: 'test-token',
          },
        ],
        contexts: [
          {
            name: 'default',
            cluster: 'default',
            user: 'default',
          },
        ],
        currentContext: 'default',
      });
      expect(client.getAuthMethod()).toBe(AuthMethod.TOKEN);
    });

    it('should support skipTlsVerify option', () => {
      const config: KubernetesClientConfig = {
        bearerToken: 'test-token',
        apiServerUrl: 'https://api.k8s.local',
        skipTlsVerify: true,
      };

      new KubernetesClient(config);

      const mockInstance = (k8s.KubeConfig as any).mock.results[0].value;
      const callArgs = mockInstance.loadFromOptions.mock.calls[0][0];
      expect(callArgs.clusters[0].skipTLSVerify).toBe(true);
    });

    it('should throw error if token but no API server URL', () => {
      const config: KubernetesClientConfig = {
        bearerToken: 'test-token',
      };

      // Mock file system to return false for kubeconfig check
      (existsSync as jest.Mock).mockReturnValue(false);

      // When only bearerToken is provided without apiServerUrl, it falls back to kubeconfig
      // and will throw error about missing kubeconfig file
      expect(() => new KubernetesClient(config)).toThrow('Kubeconfig file not found');

      // Restore the mock for other tests
      (existsSync as jest.Mock).mockReturnValue(true);
    });

    it('should use factory method for token auth', () => {
      const client = KubernetesClient.fromToken(
        'https://api.k8s.local',
        'test-token',
        false,
        mockLogger,
      );

      const mockInstance = (k8s.KubeConfig as any).mock.results[0].value;
      expect(mockInstance.loadFromOptions).toHaveBeenCalled();
      expect(client.getAuthMethod()).toBe(AuthMethod.TOKEN);
    });
  });

  describe('Context Management', () => {
    it('should get current context', () => {
      const client = new KubernetesClient();

      expect(client.getCurrentContext()).toBe('default');
    });

    it('should get all contexts', () => {
      const client = new KubernetesClient();
      const contexts = client.getContexts();

      expect(contexts).toEqual(['default', 'test']);
    });

    it('should switch context successfully', () => {
      const client = new KubernetesClient();
      client.switchContext('test');

      const mockInstance = (k8s.KubeConfig as any).mock.results[0].value;
      expect(mockInstance.setCurrentContext).toHaveBeenCalledWith('test');
    });

    it('should throw error when switching to non-existent context', async () => {
      const client = new KubernetesClient();
      await expect(client.switchContext('non-existent')).rejects.toThrow(
        'Context not found: non-existent',
      );
    });
  });

  describe('Cluster Information', () => {
    it('should get current cluster information', () => {
      const client = new KubernetesClient();
      const cluster = client.getCurrentCluster();

      expect(cluster).toEqual({
        name: 'default-cluster',
        server: 'https://localhost:6443',
      });
    });

    it('should return null if no current context', () => {
      const mockInstance = {
        getCurrentContext: jest.fn().mockReturnValue(''),
        getContexts: jest.fn().mockReturnValue([]),
        getClusters: jest.fn().mockReturnValue([]),
        loadFromFile: jest.fn(),
        loadFromCluster: jest.fn(),
        loadFromOptions: jest.fn(),
        setCurrentContext: jest.fn(),
        makeApiClient: jest.fn(() => ({})),
      };

      (k8s.KubeConfig as any).mockImplementation(() => mockInstance);

      const client = new KubernetesClient();
      const cluster = client.getCurrentCluster();

      expect(cluster).toBeNull();
    });
  });

  describe('Connection Testing', () => {
    it('should test connection successfully', async () => {
      const client = new KubernetesClient({ logger: mockLogger });
      const result = await client.testConnection();

      const mockInstance = (k8s.KubeConfig as any).mock.results[0].value;
      expect(mockInstance.makeApiClient).toHaveBeenCalled();
      expect(result).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Successfully connected to Kubernetes API server',
      );
    });

    it('should handle connection test failure', async () => {
      // Create a new mock instance with failing listNamespace
      const failingMockInstance = {
        getCurrentContext: jest.fn().mockReturnValue('default'),
        getContexts: jest.fn().mockReturnValue([]),
        getClusters: jest.fn().mockReturnValue([]),
        loadFromFile: jest.fn(),
        loadFromCluster: jest.fn(),
        loadFromOptions: jest.fn(),
        setCurrentContext: jest.fn(),
        makeApiClient: jest.fn(() => ({
          listNamespace: jest.fn().mockRejectedValue(new Error('Connection failed')),
        })),
      };

      (k8s.KubeConfig as any).mockImplementation(() => failingMockInstance);

      const client = new KubernetesClient({ logger: mockLogger });
      const result = await client.testConnection();

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to connect to Kubernetes API server'),
      );
    });
  });

  describe('API Client Getters', () => {
    it('should provide access to API clients', () => {
      const client = new KubernetesClient();

      expect(client.core).toBeDefined();
      expect(client.apps).toBeDefined();
      expect(client.batch).toBeDefined();
      expect(client.networking).toBeDefined();
      expect(client.kubeConfig).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should log and throw initialization errors', () => {
      const failingMockInstance = {
        loadFromFile: jest.fn(() => {
          throw new Error('Invalid kubeconfig');
        }),
        loadFromCluster: jest.fn(),
        loadFromOptions: jest.fn(),
        setCurrentContext: jest.fn(),
        makeApiClient: jest.fn(),
        getCurrentContext: jest.fn(),
        getContexts: jest.fn(),
        getClusters: jest.fn(),
      };

      (k8s.KubeConfig as any).mockImplementation(() => failingMockInstance);

      expect(() => new KubernetesClient({ logger: mockLogger })).toThrow(
        'Failed to initialize Kubernetes client: Invalid kubeconfig',
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to initialize Kubernetes client: Invalid kubeconfig',
      );
    });

    it('should handle non-Error exceptions', () => {
      const failingMockInstance = {
        loadFromFile: jest.fn(() => {
          throw 'String error';
        }),
        loadFromCluster: jest.fn(),
        loadFromOptions: jest.fn(),
        setCurrentContext: jest.fn(),
        makeApiClient: jest.fn(),
        getCurrentContext: jest.fn(),
        getContexts: jest.fn(),
        getClusters: jest.fn(),
      };

      (k8s.KubeConfig as any).mockImplementation(() => failingMockInstance);

      expect(() => new KubernetesClient({ logger: mockLogger })).toThrow(
        'Failed to initialize Kubernetes client: String error',
      );
    });
  });

  describe('Factory Methods', () => {
    it('should create client from kubeconfig with all options', () => {
      KubernetesClient.fromKubeConfig('/custom/config', 'test-context', mockLogger);

      const mockInstance = (k8s.KubeConfig as any).mock.results[0].value;
      expect(mockInstance.loadFromFile).toHaveBeenCalledWith('/custom/config');
      expect(mockInstance.setCurrentContext).toHaveBeenCalledWith('test-context');
    });
  });

  describe('refreshCurrentContext', () => {
    it('should refresh context for kubeconfig-based authentication', async () => {
      const client = new KubernetesClient({
        kubeConfigPath: '/test/.kube/config',
      });

      // Mock context change
      mockKubeConfig.getCurrentContext
        .mockReturnValueOnce('old-context') // First call (store old context)
        .mockReturnValueOnce('new-context'); // Second call (after reload)

      await client.refreshCurrentContext();

      expect(mockKubeConfig.loadFromFile).toHaveBeenCalledWith('/test/.kube/config');
      expect(mockKubeConfig.makeApiClient).toHaveBeenCalled(); // API clients reinitialized
    });

    it('should skip refresh for in-cluster authentication', async () => {
      const client = new KubernetesClient({
        inCluster: true,
      });

      await client.refreshCurrentContext();

      expect(mockKubeConfig.loadFromFile).not.toHaveBeenCalled();
    });

    it('should skip refresh for token-based authentication', async () => {
      const client = new KubernetesClient({
        bearerToken: 'test-token',
        apiServerUrl: 'https://test.example.com',
      });

      await client.refreshCurrentContext();

      expect(mockKubeConfig.loadFromFile).not.toHaveBeenCalled();
    });

    it('should handle missing kubeconfig file gracefully', async () => {
      // First create client with existing config
      const client = new KubernetesClient({
        kubeConfigPath: '/existing/.kube/config',
      });

      // Clear previous calls
      mockKubeConfig.loadFromFile.mockClear();

      // Now mock file as missing during refresh
      (existsSync as jest.Mock).mockReturnValue(false);

      await expect(client.refreshCurrentContext()).resolves.not.toThrow();
      expect(mockKubeConfig.loadFromFile).not.toHaveBeenCalled();
    });

    it('should handle loadFromFile errors gracefully', async () => {
      const client = new KubernetesClient({
        kubeConfigPath: '/test/.kube/config',
      });

      mockKubeConfig.loadFromFile.mockImplementation(() => {
        throw new Error('Invalid config file');
      });

      await expect(client.refreshCurrentContext()).resolves.not.toThrow();
    });

    it('should not reinitialize API clients if context unchanged', async () => {
      const client = new KubernetesClient({
        kubeConfigPath: '/test/.kube/config',
      });

      // Mock unchanged context
      mockKubeConfig.getCurrentContext.mockReturnValue('same-context');

      // Clear previous makeApiClient calls from constructor
      mockKubeConfig.makeApiClient.mockClear();

      await client.refreshCurrentContext();

      expect(mockKubeConfig.loadFromFile).toHaveBeenCalledWith('/test/.kube/config');
      // API clients should not be reinitialized since context didn't change
      expect(mockKubeConfig.makeApiClient).not.toHaveBeenCalled();
    });
  });
});

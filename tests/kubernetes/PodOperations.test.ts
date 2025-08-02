import { PodOperations } from '../../src/kubernetes/resources/PodOperations';
import { KubernetesClient } from '../../src/kubernetes/KubernetesClient';
import * as k8s from '@kubernetes/client-node';
import { WatchEventType } from '../../src/kubernetes/BaseResourceOperations';

// Mock KubernetesClient and Watch
jest.mock('../../src/kubernetes/KubernetesClient');
jest.mock('@kubernetes/client-node', () => ({
  ...jest.requireActual('@kubernetes/client-node'),
  Watch: jest.fn(),
}));

describe('PodOperations', () => {
  let mockClient: jest.Mocked<KubernetesClient>;
  let podOperations: PodOperations;
  let mockCoreV1Api: jest.Mocked<k8s.CoreV1Api>;
  let mockCustomObjectsApi: jest.Mocked<k8s.CustomObjectsApi>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock CoreV1Api
    mockCoreV1Api = {
      readNamespacedPod: jest.fn(),
      listNamespacedPod: jest.fn(),
      listPodForAllNamespaces: jest.fn(),
      readNamespacedPodLog: jest.fn(),
    } as any;

    // Setup mock CustomObjectsApi
    mockCustomObjectsApi = {
      getNamespacedCustomObject: jest.fn(),
    } as any;

    // Setup mock client
    mockClient = {
      core: mockCoreV1Api,
      kubeConfig: {
        makeApiClient: jest.fn().mockReturnValue(mockCustomObjectsApi),
      },
      logger: {
        error: jest.fn(),
      },
      config: {
        logger: {
          error: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          debug: jest.fn(),
        },
      },
    } as any;

    // Create PodOperations instance
    podOperations = new PodOperations(mockClient);
  });

  describe('Read-only Operations', () => {
    describe('get', () => {
      it('should get a pod by name', async () => {
        const mockPod = { metadata: { name: 'test-pod' } };
        mockCoreV1Api.readNamespacedPod.mockResolvedValue(mockPod);

        const result = await podOperations.get('test-pod', { namespace: 'default' });

        expect(result).toBe(mockPod);
        expect(mockCoreV1Api.readNamespacedPod).toHaveBeenCalledWith({
          name: 'test-pod',
          namespace: 'default',
        });
      });

      it('should handle errors when getting a pod', async () => {
        const error = new Error('Not found');
        mockCoreV1Api.readNamespacedPod.mockRejectedValue(error);

        await expect(podOperations.get('test-pod')).rejects.toThrow();
      });
    });

    describe('list', () => {
      it('should list pods in a namespace', async () => {
        const mockPodList = { items: [{ metadata: { name: 'test-pod' } }] };
        mockCoreV1Api.listNamespacedPod.mockResolvedValue(mockPodList);

        const result = await podOperations.list({ namespace: 'default' });

        expect(result).toBe(mockPodList);
        expect(mockCoreV1Api.listNamespacedPod).toHaveBeenCalledWith(
          expect.objectContaining({
            namespace: 'default',
          }),
        );
      });

      it('should list pods across all namespaces', async () => {
        const mockPodList = { items: [{ metadata: { name: 'test-pod' } }] };
        mockCoreV1Api.listPodForAllNamespaces.mockResolvedValue(mockPodList);

        const result = await podOperations.list();

        expect(result).toBe(mockPodList);
        expect(mockCoreV1Api.listPodForAllNamespaces).toHaveBeenCalled();
      });

      it('should handle errors when listing pods', async () => {
        const error = new Error('List failed');
        mockCoreV1Api.listNamespacedPod.mockRejectedValue(error);

        await expect(podOperations.list({ namespace: 'default' })).rejects.toThrow();
      });
    });

    describe('watch', () => {
      it('should watch pods for changes', async () => {
        const mockCallback = jest.fn();
        const abortFn = jest.fn();
        const mockWatchInstance = {
          watch: jest.fn().mockImplementation((_path, _opts, onData, _onError) => {
            onData('ADDED', { metadata: { name: 'test-pod' } });
            return { abort: abortFn };
          }),
        };
        (k8s.Watch as unknown as jest.Mock).mockReturnValue(mockWatchInstance);

        const cleanup = podOperations.watch(mockCallback, { namespace: 'default' });
        // Wait for async startWatch to complete
        await new Promise((r) => setImmediate(r));
        cleanup();
        expect(abortFn).toHaveBeenCalled();
      });

      it('should handle watch errors', () => {
        const mockCallback = jest.fn();
        const error = new Error('Watch error');
        const mockWatchInstance = {
          watch: jest.fn().mockImplementation((_path, _opts, _onData, onError) => {
            onError(error);
            return { abort: jest.fn() };
          }),
        };
        (k8s.Watch as unknown as jest.Mock).mockImplementation(() => mockWatchInstance);

        podOperations.watch(mockCallback, { namespace: 'default' });

        expect(mockCallback).toHaveBeenCalledWith({
          type: WatchEventType.ERROR,
          object: error,
        });
      });
    });

    describe('getLogs', () => {
      it('should get pod logs', async () => {
        const mockLogs = 'test logs';
        mockCoreV1Api.readNamespacedPodLog.mockResolvedValue(mockLogs);

        const result = await podOperations.getLogs('test-pod', {
          namespace: 'default',
          container: 'test-container',
          follow: true,
          tailLines: 100,
          previous: false,
          timestamps: true,
        });

        expect(result).toBe(mockLogs);
        expect(mockCoreV1Api.readNamespacedPodLog).toHaveBeenCalledWith({
          name: 'test-pod',
          namespace: 'default',
          container: 'test-container',
          follow: true,
          tailLines: 100,
          previous: false,
          timestamps: true,
        });
      });

      it('should handle errors when getting logs', async () => {
        const error = new Error('Logs not available');
        mockCoreV1Api.readNamespacedPodLog.mockRejectedValue(error);

        await expect(podOperations.getLogs('test-pod')).rejects.toThrow();
      });
    });

    describe('streamLogs', () => {
      it('should stream pod logs', () => {
        const mockLogs = 'test logs';
        mockCoreV1Api.readNamespacedPodLog.mockResolvedValue(mockLogs);
        const onData = jest.fn();

        const cleanup = podOperations.streamLogs('test-pod', onData, {
          namespace: 'default',
          container: 'test-container',
          follow: true,
        });

        expect(mockCoreV1Api.readNamespacedPodLog).toHaveBeenCalledWith({
          name: 'test-pod',
          namespace: 'default',
          container: 'test-container',
          follow: true,
        });

        cleanup();
      });
    });

    describe('getMetrics', () => {
      it('should get pod metrics', async () => {
        const mockMetrics = { usage: { cpu: '100m', memory: '100Mi' } };
        mockCustomObjectsApi.getNamespacedCustomObject.mockResolvedValue(mockMetrics);

        const result = await podOperations.getMetrics('test-pod', { namespace: 'default' });

        expect(result).toBe(mockMetrics);
        expect(mockCustomObjectsApi.getNamespacedCustomObject).toHaveBeenCalledWith({
          group: 'metrics.k8s.io',
          version: 'v1beta1',
          namespace: 'default',
          plural: 'pods',
          name: 'test-pod',
        });
      });

      it('should handle errors when getting metrics', async () => {
        const error = new Error('Metrics not available');
        mockCustomObjectsApi.getNamespacedCustomObject.mockRejectedValue(error);

        await expect(podOperations.getMetrics('test-pod')).rejects.toThrow();
      });
    });
  });

  describe('Unsupported Operations', () => {
    it('should throw error for create operation', async () => {
      await expect(podOperations.create({} as k8s.V1Pod)).rejects.toThrow(
        'Create operation is not supported in read-only mode',
      );
    });

    it('should throw error for update operation', async () => {
      await expect(podOperations.update({} as k8s.V1Pod)).rejects.toThrow(
        'Update operation is not supported in read-only mode',
      );
    });

    it('should throw error for patch operation', async () => {
      await expect(podOperations.patch('test-pod', {})).rejects.toThrow(
        'Patch operation is not supported in read-only mode',
      );
    });

    it('should throw error for delete operation', async () => {
      await expect(podOperations.delete('test-pod')).rejects.toThrow(
        'Delete operation is not supported in read-only mode',
      );
    });
  });
});

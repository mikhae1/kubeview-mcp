import { ServiceOperations } from '../../src/kubernetes/resources/ServiceOperations';
import { KubernetesClient } from '../../src/kubernetes/KubernetesClient';
import * as k8s from '@kubernetes/client-node';
import { WatchEventType } from '../../src/kubernetes/BaseResourceOperations';

// Mock KubernetesClient and Watch
jest.mock('../../src/kubernetes/KubernetesClient');
jest.mock('@kubernetes/client-node', () => ({
  ...jest.requireActual('@kubernetes/client-node'),
  Watch: jest.fn(),
}));

describe('ServiceOperations', () => {
  let mockClient: jest.Mocked<KubernetesClient>;
  let serviceOperations: ServiceOperations;
  let mockCoreV1Api: jest.Mocked<k8s.CoreV1Api>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock CoreV1Api
    mockCoreV1Api = {
      readNamespacedService: jest.fn(),
      listNamespacedService: jest.fn(),
      listServiceForAllNamespaces: jest.fn(),
      readNamespacedEndpoints: jest.fn(),
    } as any;

    // Setup mock Watch
    (k8s.Watch as unknown as jest.Mock).mockImplementation(() => ({
      watch: jest.fn(),
    }));

    // Setup mock client
    mockClient = {
      core: mockCoreV1Api,
      kubeConfig: {
        makeApiClient: jest.fn(),
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

    // Create ServiceOperations instance
    serviceOperations = new ServiceOperations(mockClient);
  });

  describe('Read-only Operations', () => {
    describe('get', () => {
      it('should get a service by name', async () => {
        const mockService = { metadata: { name: 'test-service' } };
        mockCoreV1Api.readNamespacedService.mockResolvedValue(mockService);

        const result = await serviceOperations.get('test-service', { namespace: 'default' });

        expect(result).toBe(mockService);
        expect(mockCoreV1Api.readNamespacedService).toHaveBeenCalledWith({
          name: 'test-service',
          namespace: 'default',
        });
      });

      it('should handle errors when getting a service', async () => {
        const error = new Error('Not found');
        mockCoreV1Api.readNamespacedService.mockRejectedValue(error);

        await expect(serviceOperations.get('test-service')).rejects.toThrow();
      });
    });

    describe('list', () => {
      it('should list services in a namespace', async () => {
        const mockServiceList = { items: [{ metadata: { name: 'test-service' } }] };
        mockCoreV1Api.listNamespacedService.mockResolvedValue(mockServiceList);

        const result = await serviceOperations.list({ namespace: 'default' });

        expect(result).toBe(mockServiceList);
        expect(mockCoreV1Api.listNamespacedService).toHaveBeenCalledWith(
          expect.objectContaining({
            namespace: 'default',
          }),
        );
      });

      it('should list services across all namespaces', async () => {
        const mockServiceList = { items: [{ metadata: { name: 'test-service' } }] };
        mockCoreV1Api.listServiceForAllNamespaces.mockResolvedValue(mockServiceList);

        const result = await serviceOperations.list();

        expect(result).toBe(mockServiceList);
        expect(mockCoreV1Api.listServiceForAllNamespaces).toHaveBeenCalled();
      });

      it('should handle errors when listing services', async () => {
        const error = new Error('List failed');
        mockCoreV1Api.listNamespacedService.mockRejectedValue(error);

        await expect(serviceOperations.list({ namespace: 'default' })).rejects.toThrow();
      });
    });

    describe('watch', () => {
      it('should watch services for changes', async () => {
        const mockCallback = jest.fn();
        const abortFn = jest.fn();
        const mockWatchInstance = {
          watch: jest.fn().mockImplementation((_path, _opts, onData, _onError) => {
            onData('ADDED', { metadata: { name: 'test-service' } });
            return { abort: abortFn };
          }),
        };
        (k8s.Watch as unknown as jest.Mock).mockReturnValue(mockWatchInstance);

        const cleanup = serviceOperations.watch(mockCallback, { namespace: 'default' });
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
        (k8s.Watch as unknown as jest.Mock).mockReturnValue(mockWatchInstance);

        serviceOperations.watch(mockCallback, { namespace: 'default' });

        expect(mockCallback).toHaveBeenCalledWith({
          type: WatchEventType.ERROR,
          object: error,
        });
      });
    });

    describe('getEndpoints', () => {
      it('should get service endpoints', async () => {
        const mockEndpoints = { subsets: [{ addresses: [{ ip: '10.0.0.1' }] }] };
        mockCoreV1Api.readNamespacedEndpoints.mockResolvedValue(mockEndpoints);

        const result = await serviceOperations.getEndpoints('test-service', {
          namespace: 'default',
        });

        expect(result).toBe(mockEndpoints);
        expect(mockCoreV1Api.readNamespacedEndpoints).toHaveBeenCalledWith({
          name: 'test-service',
          namespace: 'default',
        });
      });

      it('should handle errors when getting endpoints', async () => {
        const error = new Error('Endpoints not available');
        mockCoreV1Api.readNamespacedEndpoints.mockRejectedValue(error);

        await expect(serviceOperations.getEndpoints('test-service')).rejects.toThrow();
      });
    });
  });

  describe('Unsupported Operations', () => {
    it('should throw error for create operation', async () => {
      await expect(serviceOperations.create({} as k8s.V1Service)).rejects.toThrow(
        'Create operation is not supported in read-only mode',
      );
    });

    it('should throw error for update operation', async () => {
      await expect(serviceOperations.update({} as k8s.V1Service)).rejects.toThrow(
        'Update operation is not supported in read-only mode',
      );
    });

    it('should throw error for patch operation', async () => {
      await expect(serviceOperations.patch('test-service', {})).rejects.toThrow(
        'Patch operation is not supported in read-only mode',
      );
    });

    it('should throw error for delete operation', async () => {
      await expect(serviceOperations.delete('test-service')).rejects.toThrow(
        'Delete operation is not supported in read-only mode',
      );
    });
  });
});

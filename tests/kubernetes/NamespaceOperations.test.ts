import { NamespaceOperations } from '../../src/kubernetes/resources/NamespaceOperations';
import { KubernetesClient } from '../../src/kubernetes/KubernetesClient';
import * as k8s from '@kubernetes/client-node';
import { WatchEventType } from '../../src/kubernetes/BaseResourceOperations';

// Mock KubernetesClient and Watch
jest.mock('../../src/kubernetes/KubernetesClient');
jest.mock('@kubernetes/client-node', () => ({
  ...jest.requireActual('@kubernetes/client-node'),
  Watch: jest.fn(),
}));

describe('NamespaceOperations', () => {
  let mockClient: jest.Mocked<KubernetesClient>;
  let namespaceOperations: NamespaceOperations;
  let mockCoreV1Api: jest.Mocked<k8s.CoreV1Api>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCoreV1Api = {
      readNamespace: jest.fn(),
      listNamespace: jest.fn(),
    } as any;
    (k8s.Watch as unknown as jest.Mock).mockImplementation(() => ({
      watch: jest.fn(),
    }));
    mockClient = {
      core: mockCoreV1Api,
      kubeConfig: {
        makeApiClient: jest.fn(),
      },
      logger: {
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
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
    namespaceOperations = new NamespaceOperations(mockClient);
  });

  describe('Read-only Operations', () => {
    it('should get a namespace by name', async () => {
      const mockNamespace = { metadata: { name: 'test-ns' } };
      mockCoreV1Api.readNamespace.mockResolvedValue(mockNamespace);
      const result = await namespaceOperations.get('test-ns');
      expect(result).toBe(mockNamespace);
      expect(mockCoreV1Api.readNamespace).toHaveBeenCalledWith({ name: 'test-ns' });
    });
    it('should handle errors on get', async () => {
      mockCoreV1Api.readNamespace.mockRejectedValue(new Error('Get failed'));
      await expect(namespaceOperations.get('fail')).rejects.toThrow();
    });
    it('should list namespaces', async () => {
      const mockList = { items: [{ metadata: { name: 'test-ns' } }] };
      mockCoreV1Api.listNamespace.mockResolvedValue(mockList);
      const result = await namespaceOperations.list();
      expect(result).toBe(mockList);
      expect(mockCoreV1Api.listNamespace).toHaveBeenCalled();
    });
    it('should handle errors on list', async () => {
      mockCoreV1Api.listNamespace.mockRejectedValue(new Error('List failed'));
      await expect(namespaceOperations.list()).rejects.toThrow();
    });
    it('should throw error for create operation', async () => {
      await expect(namespaceOperations.create({} as k8s.V1Namespace)).rejects.toThrow(
        'Create operation is not supported in read-only mode',
      );
    });
    it('should throw error for update operation', async () => {
      await expect(namespaceOperations.update({} as k8s.V1Namespace)).rejects.toThrow(
        'Update operation is not supported in read-only mode',
      );
    });
    it('should throw error for patch operation', async () => {
      await expect(namespaceOperations.patch('test-ns', {})).rejects.toThrow(
        'Patch operation is not supported in read-only mode',
      );
    });
    it('should throw error for delete operation', async () => {
      await expect(namespaceOperations.delete('test-ns')).rejects.toThrow(
        'Delete operation is not supported in read-only mode',
      );
    });
  });

  describe('watch', () => {
    it('should watch namespaces for changes', async () => {
      const mockCallback = jest.fn();
      const abortFn = jest.fn();
      const mockWatchInstance = {
        watch: jest.fn().mockImplementation((_path, _opts, onData, _onError) => {
          onData('ADDED', { metadata: { name: 'test-ns' } });
          return { abort: abortFn };
        }),
      };
      (k8s.Watch as unknown as jest.Mock).mockReturnValue(mockWatchInstance);
      const cleanup = namespaceOperations.watch(mockCallback);
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
      namespaceOperations.watch(mockCallback);
      expect(mockCallback).toHaveBeenCalledWith({
        type: WatchEventType.ERROR,
        object: error,
      });
    });
  });
});

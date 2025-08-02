import { DeploymentOperations } from '../../src/kubernetes/resources/DeploymentOperations';
import { KubernetesClient } from '../../src/kubernetes/KubernetesClient';
import * as k8s from '@kubernetes/client-node';
import { WatchEventType } from '../../src/kubernetes/BaseResourceOperations';

// Mock KubernetesClient and Watch
jest.mock('../../src/kubernetes/KubernetesClient');
jest.mock('@kubernetes/client-node', () => ({
  ...jest.requireActual('@kubernetes/client-node'),
  Watch: jest.fn(),
}));

describe('DeploymentOperations', () => {
  let mockClient: jest.Mocked<KubernetesClient>;
  let deploymentOperations: DeploymentOperations;
  let mockAppsV1Api: jest.Mocked<k8s.AppsV1Api>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock AppsV1Api
    mockAppsV1Api = {
      readNamespacedDeployment: jest.fn(),
      listNamespacedDeployment: jest.fn(),
      listDeploymentForAllNamespaces: jest.fn(),
      readNamespacedDeploymentStatus: jest.fn(),
    } as any;

    // Setup mock Watch
    (k8s.Watch as unknown as jest.Mock).mockImplementation(() => ({
      watch: jest.fn(),
    }));

    // Setup mock client
    mockClient = {
      apps: mockAppsV1Api,
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

    // Create DeploymentOperations instance
    deploymentOperations = new DeploymentOperations(mockClient);
  });

  describe('Read-only Operations', () => {
    describe('get', () => {
      it('should get a deployment by name', async () => {
        const mockDeployment = { metadata: { name: 'test-deployment' } };
        mockAppsV1Api.readNamespacedDeployment.mockResolvedValue(mockDeployment);

        const result = await deploymentOperations.get('test-deployment', { namespace: 'default' });

        expect(result).toBe(mockDeployment);
        expect(mockAppsV1Api.readNamespacedDeployment).toHaveBeenCalledWith({
          name: 'test-deployment',
          namespace: 'default',
        });
      });

      it('should handle errors when getting a deployment', async () => {
        const error = new Error('Not found');
        mockAppsV1Api.readNamespacedDeployment.mockRejectedValue(error);

        await expect(deploymentOperations.get('test-deployment')).rejects.toThrow();
      });
    });

    describe('list', () => {
      it('should list deployments in a namespace', async () => {
        const mockDeploymentList = { items: [{ metadata: { name: 'test-deployment' } }] };
        mockAppsV1Api.listNamespacedDeployment.mockResolvedValue(mockDeploymentList);

        const result = await deploymentOperations.list({ namespace: 'default' });

        expect(result).toBe(mockDeploymentList);
        expect(mockAppsV1Api.listNamespacedDeployment).toHaveBeenCalledWith(
          expect.objectContaining({
            namespace: 'default',
          }),
        );
      });

      it('should list deployments across all namespaces', async () => {
        const mockDeploymentList = { items: [{ metadata: { name: 'test-deployment' } }] };
        mockAppsV1Api.listDeploymentForAllNamespaces.mockResolvedValue(mockDeploymentList);

        const result = await deploymentOperations.list();

        expect(result).toBe(mockDeploymentList);
        expect(mockAppsV1Api.listDeploymentForAllNamespaces).toHaveBeenCalled();
      });

      it('should handle errors when listing deployments', async () => {
        const error = new Error('List failed');
        mockAppsV1Api.listNamespacedDeployment.mockRejectedValue(error);

        await expect(deploymentOperations.list({ namespace: 'default' })).rejects.toThrow();
      });
    });

    describe('watch', () => {
      it('should watch deployments for changes', async () => {
        const mockCallback = jest.fn();
        const abortFn = jest.fn();
        const mockWatchInstance = {
          watch: jest.fn().mockImplementation((_path, _opts, onData, _onError) => {
            onData('ADDED', { metadata: { name: 'test-deployment' } });
            return { abort: abortFn };
          }),
        };
        (k8s.Watch as unknown as jest.Mock).mockReturnValue(mockWatchInstance);

        const cleanup = deploymentOperations.watch(mockCallback, { namespace: 'default' });
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

        deploymentOperations.watch(mockCallback, { namespace: 'default' });

        expect(mockCallback).toHaveBeenCalledWith({
          type: WatchEventType.ERROR,
          object: error,
        });
      });
    });

    describe('getStatus', () => {
      it('should get deployment status', async () => {
        const mockStatus = { readyReplicas: 3, replicas: 3 };
        mockAppsV1Api.readNamespacedDeploymentStatus.mockResolvedValue({ status: mockStatus });

        const result = await deploymentOperations.getStatus('test-deployment', {
          namespace: 'default',
        });

        expect(result).toEqual(mockStatus);
        expect(mockAppsV1Api.readNamespacedDeploymentStatus).toHaveBeenCalledWith({
          name: 'test-deployment',
          namespace: 'default',
        });
      });

      it('should handle errors when getting status', async () => {
        const error = new Error('Status not available');
        mockAppsV1Api.readNamespacedDeploymentStatus.mockRejectedValue(error);

        await expect(deploymentOperations.getStatus('test-deployment')).rejects.toThrow();
      });
    });

    describe('waitForReady', () => {
      it('should wait for deployment to be ready', async () => {
        const mockStatus = {
          readyReplicas: 3,
          replicas: 3,
          updatedReplicas: 3,
          availableReplicas: 3,
        };
        mockAppsV1Api.readNamespacedDeploymentStatus.mockResolvedValue({ status: mockStatus });

        const result = await deploymentOperations.waitForReady('test-deployment', {
          namespace: 'default',
          timeoutSeconds: 5,
        });

        expect(result).toBe(true);
        expect(mockAppsV1Api.readNamespacedDeploymentStatus).toHaveBeenCalledWith({
          name: 'test-deployment',
          namespace: 'default',
        });
      });

      it('should timeout if deployment is not ready', async () => {
        const mockStatus = { readyReplicas: 1, replicas: 3 };
        mockAppsV1Api.readNamespacedDeploymentStatus.mockResolvedValue({ status: mockStatus });

        const result = await deploymentOperations.waitForReady('test-deployment', {
          namespace: 'default',
          timeoutSeconds: 1,
        });

        expect(result).toBe(false);
      });

      it('should handle errors during wait', async () => {
        const error = new Error('Status check failed');
        mockAppsV1Api.readNamespacedDeploymentStatus.mockRejectedValue(error);

        await expect(
          deploymentOperations.waitForReady('test-deployment', {
            namespace: 'default',
            timeoutSeconds: 1,
          }),
        ).rejects.toThrow();
      });
    });
  });

  describe('Unsupported Operations', () => {
    it('should throw error for create operation', async () => {
      await expect(deploymentOperations.create({} as k8s.V1Deployment)).rejects.toThrow(
        'Create operation is not supported in read-only mode',
      );
    });

    it('should throw error for update operation', async () => {
      await expect(deploymentOperations.update({} as k8s.V1Deployment)).rejects.toThrow(
        'Update operation is not supported in read-only mode',
      );
    });

    it('should throw error for patch operation', async () => {
      await expect(deploymentOperations.patch('test-deployment', {})).rejects.toThrow(
        'Patch operation is not supported in read-only mode',
      );
    });

    it('should throw error for delete operation', async () => {
      await expect(deploymentOperations.delete('test-deployment')).rejects.toThrow(
        'Delete operation is not supported in read-only mode',
      );
    });
  });
});

import {
  ConnectionManager,
  ConnectionManagerConfig,
  ClusterConfig,
  LoadBalancingStrategy,
} from '../../src/kubernetes/ConnectionManager';
import {
  ConnectionPool,
  ConnectionEntry,
  ConnectionState,
} from '../../src/kubernetes/ConnectionPool';
import * as k8s from '@kubernetes/client-node';
import { Logger } from 'winston';
import { EventEmitter } from 'events';

// Mock ConnectionPool
jest.mock('../../src/kubernetes/ConnectionPool');

describe('ConnectionManager', () => {
  let mockLogger: Logger;
  let mockConnectionPool: jest.Mocked<ConnectionPool>;
  let mockConnectionEntry: jest.Mocked<ConnectionEntry>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock logger
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    // Setup mock connection entry
    mockConnectionEntry = {
      id: 'test-conn-1',
      state: ConnectionState.IN_USE,
      kubeConfig: {} as any,
      markUsed: jest.fn(),
      release: jest.fn(),
    } as any;

    // Setup mock connection pool
    const MockConnectionPool = ConnectionPool as jest.MockedClass<typeof ConnectionPool>;
    mockConnectionPool = new MockConnectionPool('test', jest.fn()) as any;

    // Mock EventEmitter methods
    Object.setPrototypeOf(mockConnectionPool, EventEmitter.prototype);
    mockConnectionPool.on = jest.fn().mockReturnThis();
    mockConnectionPool.emit = jest.fn();
    mockConnectionPool.acquire = jest.fn().mockResolvedValue(mockConnectionEntry);
    mockConnectionPool.release = jest.fn();
    mockConnectionPool.dispose = jest.fn().mockResolvedValue(undefined);

    // Mock the stats getter
    Object.defineProperty(mockConnectionPool, 'stats', {
      get: jest.fn().mockReturnValue({
        total: 2,
        idle: 1,
        inUse: 1,
        unhealthy: 0,
        waitQueueLength: 0,
      }),
      configurable: true,
    });
  });

  describe('Constructor', () => {
    it('should create a connection manager with default config', () => {
      const manager = new ConnectionManager();
      expect(manager).toBeDefined();
    });

    it('should create a connection manager with custom config', () => {
      const config: ConnectionManagerConfig = {
        loadBalancingStrategy: LoadBalancingStrategy.LEAST_CONNECTIONS,
        logger: mockLogger,
        enableFailover: true,
        clusterHealthCheckInterval: 5000,
      };

      const manager = new ConnectionManager(config);
      expect(manager).toBeDefined();
    });
  });

  describe('Cluster Management', () => {
    it('should add a cluster successfully', async () => {
      const manager = new ConnectionManager({ logger: mockLogger });

      const clusterConfig: ClusterConfig = {
        name: 'test-cluster',
        kubeConfigFactory: jest.fn().mockReturnValue({} as k8s.KubeConfig),
      };

      await manager.addCluster(clusterConfig);

      expect(mockLogger.info).toHaveBeenCalledWith('Adding cluster: test-cluster');
      expect(ConnectionPool).toHaveBeenCalledWith(
        'test-cluster',
        clusterConfig.kubeConfigFactory,
        expect.objectContaining({ logger: mockLogger }),
      );
    });

    it('should reject adding duplicate clusters', async () => {
      const manager = new ConnectionManager({ logger: mockLogger });

      const clusterConfig: ClusterConfig = {
        name: 'test-cluster',
        kubeConfigFactory: jest.fn(),
      };

      await manager.addCluster(clusterConfig);

      await expect(manager.addCluster(clusterConfig)).rejects.toThrow(
        'Cluster already exists: test-cluster',
      );
    });

    it('should remove a cluster successfully', async () => {
      const manager = new ConnectionManager({ logger: mockLogger });

      const clusterConfig: ClusterConfig = {
        name: 'test-cluster',
        kubeConfigFactory: jest.fn(),
      };

      await manager.addCluster(clusterConfig);
      await manager.removeCluster('test-cluster');

      expect(mockConnectionPool.dispose).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Removing cluster: test-cluster');
    });

    it('should enable/disable clusters', async () => {
      const manager = new ConnectionManager({ logger: mockLogger });

      const clusterConfig: ClusterConfig = {
        name: 'test-cluster',
        kubeConfigFactory: jest.fn(),
      };

      await manager.addCluster(clusterConfig);

      manager.setClusterEnabled('test-cluster', false);
      expect(mockLogger.info).toHaveBeenCalledWith('Cluster test-cluster disabled');

      manager.setClusterEnabled('test-cluster', true);
      expect(mockLogger.info).toHaveBeenCalledWith('Cluster test-cluster enabled');
    });
  });

  describe('Connection Acquisition', () => {
    it('should acquire connection from preferred cluster', async () => {
      const manager = new ConnectionManager({ logger: mockLogger });

      await manager.addCluster({
        name: 'cluster-1',
        kubeConfigFactory: jest.fn(),
      });

      const result = await manager.acquire('cluster-1');

      expect(result.cluster).toBe('cluster-1');
      expect(result.connection).toBe(mockConnectionEntry);
      expect(mockConnectionPool.acquire).toHaveBeenCalled();
    });

    it('should use load balancing when no preferred cluster', async () => {
      const manager = new ConnectionManager({
        logger: mockLogger,
        loadBalancingStrategy: LoadBalancingStrategy.ROUND_ROBIN,
      });

      await manager.addCluster({
        name: 'cluster-1',
        kubeConfigFactory: jest.fn(),
      });

      await manager.addCluster({
        name: 'cluster-2',
        kubeConfigFactory: jest.fn(),
      });

      const result1 = await manager.acquire();
      expect(['cluster-1', 'cluster-2']).toContain(result1.cluster);
    });

    it('should failover to another cluster on error', async () => {
      const manager = new ConnectionManager({
        logger: mockLogger,
        enableFailover: true,
      });

      // First cluster will fail
      const failingPool = new (ConnectionPool as any)();
      failingPool.acquire = jest.fn().mockRejectedValue(new Error('Connection failed'));
      failingPool.on = jest.fn();
      failingPool.dispose = jest.fn();

      const MockPool = ConnectionPool as jest.MockedClass<typeof ConnectionPool>;
      MockPool.mockImplementationOnce(() => failingPool);

      await manager.addCluster({
        name: 'failing-cluster',
        kubeConfigFactory: jest.fn(),
      });

      await manager.addCluster({
        name: 'working-cluster',
        kubeConfigFactory: jest.fn(),
      });

      const result = await manager.acquire('failing-cluster');

      expect(result.cluster).toBe('working-cluster');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to acquire from preferred cluster'),
      );
    });

    it('should throw error when no clusters available', async () => {
      const manager = new ConnectionManager({ logger: mockLogger });

      await expect(manager.acquire()).rejects.toThrow('No available clusters');
    });
  });

  describe('Load Balancing Strategies', () => {
    it('should use round-robin strategy', async () => {
      const manager = new ConnectionManager({
        logger: mockLogger,
        loadBalancingStrategy: LoadBalancingStrategy.ROUND_ROBIN,
      });

      await manager.addCluster({ name: 'cluster-1', kubeConfigFactory: jest.fn() });
      await manager.addCluster({ name: 'cluster-2', kubeConfigFactory: jest.fn() });
      await manager.addCluster({ name: 'cluster-3', kubeConfigFactory: jest.fn() });

      const results: string[] = [];
      for (let i = 0; i < 6; i++) {
        const result = await manager.acquire();
        results.push(result.cluster);
      }

      // Should cycle through clusters
      expect(results).toEqual([
        'cluster-1',
        'cluster-2',
        'cluster-3',
        'cluster-1',
        'cluster-2',
        'cluster-3',
      ]);
    });

    it('should use least-connections strategy', async () => {
      const manager = new ConnectionManager({
        logger: mockLogger,
        loadBalancingStrategy: LoadBalancingStrategy.LEAST_CONNECTIONS,
      });

      // Create pools with different connection counts
      const pool1 = new (ConnectionPool as any)();
      Object.defineProperty(pool1, 'stats', {
        get: jest.fn().mockReturnValue({ inUse: 5 }),
        configurable: true,
      });
      pool1.acquire = jest.fn().mockResolvedValue(mockConnectionEntry);
      pool1.on = jest.fn();
      pool1.dispose = jest.fn();

      const pool2 = new (ConnectionPool as any)();
      Object.defineProperty(pool2, 'stats', {
        get: jest.fn().mockReturnValue({ inUse: 2 }),
        configurable: true,
      });
      pool2.acquire = jest.fn().mockResolvedValue(mockConnectionEntry);
      pool2.on = jest.fn();
      pool2.dispose = jest.fn();

      const MockPool = ConnectionPool as jest.MockedClass<typeof ConnectionPool>;
      MockPool.mockImplementationOnce(() => pool1).mockImplementationOnce(() => pool2);

      await manager.addCluster({ name: 'busy-cluster', kubeConfigFactory: jest.fn() });
      await manager.addCluster({ name: 'idle-cluster', kubeConfigFactory: jest.fn() });

      const result = await manager.acquire();

      expect(result.cluster).toBe('idle-cluster');
    });

    it('should use weighted strategy', async () => {
      const manager = new ConnectionManager({
        logger: mockLogger,
        loadBalancingStrategy: LoadBalancingStrategy.WEIGHTED,
      });

      await manager.addCluster({
        name: 'cluster-1',
        kubeConfigFactory: jest.fn(),
        weight: 1,
      });

      await manager.addCluster({
        name: 'cluster-2',
        kubeConfigFactory: jest.fn(),
        weight: 9,
      });

      const results: Record<string, number> = {
        'cluster-1': 0,
        'cluster-2': 0,
      };

      // Run many iterations to verify weight distribution
      for (let i = 0; i < 100; i++) {
        const result = await manager.acquire();
        results[result.cluster]++;
      }

      // Cluster-2 should get roughly 90% of traffic
      expect(results['cluster-2']).toBeGreaterThan(80);
      expect(results['cluster-1']).toBeLessThan(20);
    });

    it('should use random strategy', async () => {
      const manager = new ConnectionManager({
        logger: mockLogger,
        loadBalancingStrategy: LoadBalancingStrategy.RANDOM,
      });

      await manager.addCluster({ name: 'cluster-1', kubeConfigFactory: jest.fn() });
      await manager.addCluster({ name: 'cluster-2', kubeConfigFactory: jest.fn() });
      await manager.addCluster({ name: 'cluster-3', kubeConfigFactory: jest.fn() });

      const results = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const result = await manager.acquire();
        results.add(result.cluster);
      }

      // Should eventually hit all clusters
      expect(results.size).toBeGreaterThan(1);
    });
  });

  describe('Connection Release', () => {
    it('should release connection to correct pool', async () => {
      const manager = new ConnectionManager({ logger: mockLogger });

      await manager.addCluster({
        name: 'test-cluster',
        kubeConfigFactory: jest.fn(),
      });

      const { connection } = await manager.acquire('test-cluster');
      manager.release('test-cluster', connection);

      expect(mockConnectionPool.release).toHaveBeenCalledWith(connection);
    });

    it('should handle release to non-existent pool', () => {
      const manager = new ConnectionManager({ logger: mockLogger });

      manager.release('non-existent', mockConnectionEntry);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Cannot release connection: pool not found for cluster non-existent',
      );
    });
  });

  describe('Statistics', () => {
    it('should return statistics for all clusters', async () => {
      const manager = new ConnectionManager({ logger: mockLogger });

      await manager.addCluster({
        name: 'cluster-1',
        kubeConfigFactory: jest.fn(),
        weight: 2,
      });

      await manager.addCluster({
        name: 'cluster-2',
        kubeConfigFactory: jest.fn(),
        enabled: false,
      });

      const stats = manager.getStats();

      expect(stats.size).toBe(2);
      expect(stats.get('cluster-1')).toMatchObject({
        name: 'cluster-1',
        enabled: true,
        healthy: true,
        weight: 2,
        poolStats: mockConnectionPool.stats,
      });

      expect(stats.get('cluster-2')).toMatchObject({
        name: 'cluster-2',
        enabled: false,
      });
    });
  });

  describe('Health Monitoring', () => {
    it('should disable unhealthy clusters with failover enabled', async () => {
      jest.useFakeTimers();

      const manager = new ConnectionManager({
        logger: mockLogger,
        enableFailover: true,
        clusterHealthCheckInterval: 1000,
      });

      // Create unhealthy pool
      const unhealthyPool = new (ConnectionPool as any)();
      Object.defineProperty(unhealthyPool, 'stats', {
        get: jest.fn().mockReturnValue({ total: 0, idle: 0, inUse: 0 }),
        configurable: true,
      });
      unhealthyPool.on = jest.fn();
      unhealthyPool.dispose = jest.fn();

      const MockPool = ConnectionPool as jest.MockedClass<typeof ConnectionPool>;
      MockPool.mockImplementationOnce(() => unhealthyPool).mockImplementationOnce(
        () => mockConnectionPool,
      );

      await manager.addCluster({ name: 'unhealthy-cluster', kubeConfigFactory: jest.fn() });
      await manager.addCluster({ name: 'healthy-cluster', kubeConfigFactory: jest.fn() });

      // Trigger health check
      jest.advanceTimersByTime(1000);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Auto-disabling unhealthy cluster'),
      );

      jest.useRealTimers();
    });
  });

  describe('Disposal', () => {
    it('should dispose all pools and clear resources', async () => {
      const manager = new ConnectionManager({ logger: mockLogger });

      await manager.addCluster({ name: 'cluster-1', kubeConfigFactory: jest.fn() });
      await manager.addCluster({ name: 'cluster-2', kubeConfigFactory: jest.fn() });

      await manager.dispose();

      expect(mockConnectionPool.dispose).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledWith('Disposing connection manager');
    });

    it('should handle multiple dispose calls', async () => {
      const manager = new ConnectionManager({ logger: mockLogger });

      await manager.addCluster({ name: 'cluster-1', kubeConfigFactory: jest.fn() });

      await manager.dispose();
      await manager.dispose(); // Second call should be no-op

      expect(mockConnectionPool.dispose).toHaveBeenCalledTimes(1);
    });

    it('should reject operations after disposal', async () => {
      const manager = new ConnectionManager({ logger: mockLogger });

      await manager.dispose();

      await expect(manager.acquire()).rejects.toThrow('Connection manager has been disposed');

      await expect(
        manager.addCluster({
          name: 'test',
          kubeConfigFactory: jest.fn(),
        }),
      ).rejects.toThrow('Connection manager has been disposed');
    });
  });

  describe('Events', () => {
    it('should forward pool events with cluster context', async () => {
      const manager = new ConnectionManager({ logger: mockLogger });

      const createdSpy = jest.fn();
      manager.on('connectionCreated', createdSpy);

      await manager.addCluster({ name: 'test-cluster', kubeConfigFactory: jest.fn() });

      // Simulate pool emitting event
      const poolOnCall = (mockConnectionPool.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'connectionCreated',
      );

      if (poolOnCall) {
        poolOnCall[1](mockConnectionEntry);
      }

      expect(createdSpy).toHaveBeenCalledWith({
        cluster: 'test-cluster',
        connection: mockConnectionEntry,
      });
    });

    it('should emit cluster lifecycle events', async () => {
      const manager = new ConnectionManager({ logger: mockLogger });

      const addedSpy = jest.fn();
      const removedSpy = jest.fn();

      manager.on('clusterAdded', addedSpy);
      manager.on('clusterRemoved', removedSpy);

      await manager.addCluster({ name: 'test-cluster', kubeConfigFactory: jest.fn() });
      expect(addedSpy).toHaveBeenCalledWith('test-cluster');

      await manager.removeCluster('test-cluster');
      expect(removedSpy).toHaveBeenCalledWith('test-cluster');
    });
  });
});

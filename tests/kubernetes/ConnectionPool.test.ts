import {
  ConnectionPool,
  ConnectionPoolConfig,
  ConnectionState,
} from '../../src/kubernetes/ConnectionPool';
import * as k8s from '@kubernetes/client-node';
import { Logger } from 'winston';

// Mock k8s client
jest.mock('@kubernetes/client-node');

describe('ConnectionPool', () => {
  let mockKubeConfigFactory: jest.Mock;
  let mockLogger: Logger;
  let mockKubeConfig: jest.Mocked<k8s.KubeConfig>;
  let mockCoreV1Api: jest.Mocked<k8s.CoreV1Api>;
  let pools: ConnectionPool[] = [];

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock logger
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    // Setup mock KubeConfig
    mockCoreV1Api = {
      listNamespace: jest.fn().mockResolvedValue({ body: { items: [] } }),
    } as any;

    mockKubeConfig = {
      makeApiClient: jest.fn().mockReturnValue(mockCoreV1Api),
    } as any;

    mockKubeConfigFactory = jest.fn().mockReturnValue(mockKubeConfig);
    pools = [];
  });

  const createPool = (config?: ConnectionPoolConfig): ConnectionPool => {
    const pool = new ConnectionPool('test-context', mockKubeConfigFactory, config);
    pools.push(pool);
    return pool;
  };

  afterEach(async () => {
    for (const pool of pools) {
      await pool.dispose();
    }
    pools = [];
  });

  describe('Constructor', () => {
    it('should create a connection pool with default config', () => {
      const pool = createPool();
      expect(pool).toBeDefined();
      expect(pool.stats.total).toBe(0);
    });

    it('should create a connection pool with custom config', () => {
      const config: ConnectionPoolConfig = {
        maxConnections: 5,
        minConnections: 1,
        logger: mockLogger,
        enableWarmup: false,
      };

      const pool = createPool(config);
      expect(pool).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Creating connection pool for context: test-context',
        expect.any(Object),
      );
    });

    it('should warm up pool if enabled', async () => {
      const config: ConnectionPoolConfig = {
        minConnections: 2,
        enableWarmup: true,
        logger: mockLogger,
      };

      const pool = createPool(config);

      // Wait for warmup to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockKubeConfigFactory).toHaveBeenCalledTimes(2);
      expect(pool.stats.total).toBe(2);
      expect(pool.stats.idle).toBe(2);
    });
  });

  describe('Connection Management', () => {
    it('should acquire a connection successfully', async () => {
      const pool = createPool({
        enableWarmup: false,
        logger: mockLogger,
      });
      pools.push(pool);

      const conn = await pool.acquire();
      expect(conn).toBeDefined();
      expect(conn.state).toBe(ConnectionState.IN_USE);
      expect(pool.stats.inUse).toBe(1);

      pool.release(conn);
      expect(pool.stats.idle).toBe(1);
      expect(pool.stats.inUse).toBe(0);
      expect(conn.state).toBe(ConnectionState.IDLE);
    });

    it('should reuse idle connections', async () => {
      const pool = createPool({
        enableWarmup: false,
        logger: mockLogger,
      });
      pools.push(pool);

      const conn1 = await pool.acquire();
      pool.release(conn1);

      const conn2 = await pool.acquire();
      expect(conn1).toBe(conn2);
      expect(mockKubeConfigFactory).toHaveBeenCalledTimes(1);
    });

    it('should create new connections up to max limit', async () => {
      const pool = createPool({
        maxConnections: 2,
        enableWarmup: false,
        logger: mockLogger,
      });
      pools.push(pool);

      const conn1 = await pool.acquire();
      const conn2 = await pool.acquire();

      expect(pool.stats.total).toBe(2);
      expect(pool.stats.inUse).toBe(2);
      expect(conn1).not.toBe(conn2);
    });

    it('should wait for available connection when at max limit', async () => {
      const pool = createPool({
        maxConnections: 1,
        acquireTimeout: 1000,
        enableWarmup: false,
        logger: mockLogger,
      });
      pools.push(pool);

      const conn1 = await pool.acquire();

      // Try to acquire another connection
      const acquirePromise = pool.acquire();

      // Should be waiting
      expect(pool.stats.waitQueueLength).toBe(1);

      // Release the first connection
      setTimeout(() => pool.release(conn1), 50);

      const conn2 = await acquirePromise;
      expect(conn2).toBe(conn1);
    });

    it('should timeout when waiting too long', async () => {
      const pool = createPool({
        maxConnections: 1,
        acquireTimeout: 100,
        enableWarmup: false,
        logger: mockLogger,
      });
      pools.push(pool);

      await pool.acquire();

      await expect(pool.acquire()).rejects.toThrow('Connection acquire timeout');
    });

    it('should release connections properly', async () => {
      const pool = createPool({
        enableWarmup: false,
        logger: mockLogger,
      });
      pools.push(pool);

      const conn = await pool.acquire();
      expect(pool.stats.inUse).toBe(1);

      pool.release(conn);
      expect(pool.stats.idle).toBe(1);
      expect(pool.stats.inUse).toBe(0);
      expect(conn.state).toBe(ConnectionState.IDLE);
    });
  });

  describe('Health Checks', () => {
    it('should mark unhealthy connections', async () => {
      const pool = createPool({
        healthCheckRetries: 1,
        enableWarmup: false,
        logger: mockLogger,
      });

      const conn = await pool.acquire();
      pool.release(conn);

      // Make health check fail
      mockCoreV1Api.listNamespace.mockRejectedValueOnce(new Error('API Error'));

      const healthy = await conn.checkHealth();
      expect(healthy).toBe(false);
      expect(conn.state).toBe(ConnectionState.UNHEALTHY);
    });

    it('should recover unhealthy connections', async () => {
      const pool = createPool({
        enableWarmup: false,
        logger: mockLogger,
      });

      const conn = await pool.acquire();
      pool.release(conn);

      // Make health check fail then succeed
      mockCoreV1Api.listNamespace.mockRejectedValueOnce(new Error('API Error'));
      await conn.checkHealth();
      expect(conn.state).toBe(ConnectionState.UNHEALTHY);

      mockCoreV1Api.listNamespace.mockResolvedValueOnce({ body: { items: [] } } as any);
      const healthy = await conn.checkHealth();
      expect(healthy).toBe(true);
      expect(conn.state).toBe(ConnectionState.IDLE);
    });
  });

  describe('Connection Lifecycle', () => {
    it('should track connection usage', async () => {
      const pool = createPool({
        enableWarmup: false,
        logger: mockLogger,
      });

      const conn = await pool.acquire();
      expect(conn.useCount).toBe(1);

      pool.release(conn);
      await pool.acquire();
      expect(conn.useCount).toBe(2);
    });

    it('should remove idle expired connections', async () => {
      const pool = createPool({
        minConnections: 0,
        maxIdleTime: 100,
        enableWarmup: false,
        logger: mockLogger,
      });

      const conn = await pool.acquire();
      pool.release(conn);

      // Wait for idle check
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Manually trigger idle check (normally done by timer)
      (pool as any).removeIdleConnections();

      expect(pool.stats.total).toBe(0);
    });

    it('should maintain minimum connections', async () => {
      const pool = createPool({
        minConnections: 2,
        maxIdleTime: 100,
        enableWarmup: true,
        logger: mockLogger,
      });

      // Wait for warmup
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(pool.stats.total).toBe(2);

      // Manually trigger idle check
      (pool as any).removeIdleConnections();

      // Should still have minimum connections
      expect(pool.stats.total).toBe(2);
    });
  });

  describe('Pool Disposal', () => {
    it('should dispose all connections', async () => {
      const pool = createPool({
        minConnections: 2,
        enableWarmup: true,
        logger: mockLogger,
      });

      // Wait for warmup
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(pool.stats.total).toBe(2);

      await pool.dispose();
      expect(pool.stats.total).toBe(0);
    });

    it('should reject new acquisitions after disposal', async () => {
      const pool = createPool({
        enableWarmup: false,
        logger: mockLogger,
      });

      await pool.dispose();

      await expect(pool.acquire()).rejects.toThrow('Connection pool has been disposed');
    });

    it('should clear waiting queue on disposal', async () => {
      const pool = createPool({
        maxConnections: 1,
        enableWarmup: false,
        logger: mockLogger,
      });

      await pool.acquire();

      const waitingPromise = pool.acquire();

      await pool.dispose();

      await expect(waitingPromise).rejects.toThrow('Failed to acquire connection');
    });
  });

  describe('Events', () => {
    it('should emit connection events', async () => {
      const pool = createPool({
        enableWarmup: false,
        logger: mockLogger,
      });

      const createdSpy = jest.fn();
      const acquiredSpy = jest.fn();
      const releasedSpy = jest.fn();

      pool.on('connectionCreated', createdSpy);
      pool.on('connectionAcquired', acquiredSpy);
      pool.on('connectionReleased', releasedSpy);

      const conn = await pool.acquire();
      expect(createdSpy).toHaveBeenCalledWith(conn);
      expect(acquiredSpy).toHaveBeenCalledWith(conn);

      pool.release(conn);
      expect(releasedSpy).toHaveBeenCalledWith(conn);
    });

    it('should emit disposal event', async () => {
      const pool = createPool({
        enableWarmup: false,
        logger: mockLogger,
      });

      const disposedSpy = jest.fn();
      pool.on('disposed', disposedSpy);

      await pool.dispose();
      expect(disposedSpy).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle connection creation failures', async () => {
      mockCoreV1Api.listNamespace.mockRejectedValue(new Error('Auth failed'));

      const pool = createPool({
        enableWarmup: false,
        logger: mockLogger,
      });

      await expect(pool.acquire()).rejects.toThrow('Failed to create healthy connection');
    });

    it('should not release non-in-use connections', () => {
      const pool = createPool({
        enableWarmup: false,
        logger: mockLogger,
      });

      const conn = {
        state: ConnectionState.IDLE,
        id: 'test-1',
      } as any;

      pool.release(conn);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Attempting to release connection test-1 that is not in use',
      );
    });
  });

  describe('API Client Creation', () => {
    it('should create API clients through connection', async () => {
      const pool = createPool({
        enableWarmup: false,
        logger: mockLogger,
      });

      const conn = await pool.acquire();
      const api = conn.makeApiClient(k8s.CoreV1Api);

      expect(api).toBe(mockCoreV1Api);
      expect(mockKubeConfig.makeApiClient).toHaveBeenCalledWith(k8s.CoreV1Api);
    });
  });
});

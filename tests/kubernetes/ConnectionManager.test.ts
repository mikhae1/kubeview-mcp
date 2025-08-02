import { ConnectionManager, ConnectionManagerConfig } from '../../src/kubernetes/ConnectionManager';
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
  let kubeConfigFactory: jest.Mock;

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

    // Always return the same mockConnectionPool for any new ConnectionPool()
    (ConnectionPool as unknown as jest.Mock).mockImplementation(() => mockConnectionPool);

    // Mock kubeConfigFactory
    kubeConfigFactory = jest.fn().mockReturnValue({} as k8s.KubeConfig);
  });

  describe('Constructor', () => {
    it('should create a connection manager with default config', () => {
      const manager = new ConnectionManager(kubeConfigFactory);
      expect(manager).toBeDefined();
    });

    it('should create a connection manager with custom config', () => {
      const config: ConnectionManagerConfig = {
        logger: mockLogger,
      };
      const manager = new ConnectionManager(kubeConfigFactory, config);
      expect(manager).toBeDefined();
    });
  });

  describe('Connection Acquisition', () => {
    it('should acquire a connection from the pool', async () => {
      const manager = new ConnectionManager(kubeConfigFactory, { logger: mockLogger });
      const conn = await manager.acquire();
      expect(conn).toBe(mockConnectionEntry);
      expect(mockConnectionPool.acquire).toHaveBeenCalled();
    });

    it('should release a connection back to the pool', () => {
      const manager = new ConnectionManager(kubeConfigFactory, { logger: mockLogger });
      manager.release(mockConnectionEntry);
      expect(mockConnectionPool.release).toHaveBeenCalledWith(mockConnectionEntry);
    });
  });

  describe('Stats and Health', () => {
    it('should return cluster stats', () => {
      const manager = new ConnectionManager(kubeConfigFactory, { logger: mockLogger });
      const stats = manager.getStats();
      expect(stats).toHaveProperty('healthy');
      expect(stats).toHaveProperty('poolStats');
      expect(stats.poolStats.total).toBe(2);
    });
  });

  describe('Dispose', () => {
    it('should dispose the connection manager and pool', async () => {
      const manager = new ConnectionManager(kubeConfigFactory, { logger: mockLogger });
      await manager.dispose();
      expect(mockConnectionPool.dispose).toHaveBeenCalled();
    });
  });
});

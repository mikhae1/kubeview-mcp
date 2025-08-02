import * as k8s from '@kubernetes/client-node';
import { Logger } from 'winston';
import { EventEmitter } from 'events';
import { ConnectionPool, ConnectionPoolConfig, ConnectionEntry } from './ConnectionPool.js';

/**
 * Configuration for SingleClusterConnectionManager
 */
export interface ConnectionManagerConfig {
  /**
   * Connection pool configuration
   */
  poolConfig?: ConnectionPoolConfig;

  /**
   * Logger instance
   */
  logger?: Logger;
}

/**
 * Statistics for the managed cluster
 */
export interface ClusterStats {
  healthy: boolean;
  poolStats: {
    total: number;
    idle: number;
    inUse: number;
    unhealthy: number;
    waitQueueLength: number;
  };
}

/**
 * Connection manager for handling a single Kubernetes cluster
 */
export class ConnectionManager extends EventEmitter {
  private readonly pool: ConnectionPool;
  private readonly logger?: Logger;
  private disposed = false;

  constructor(kubeConfigFactory: () => k8s.KubeConfig, config: ConnectionManagerConfig = {}) {
    super();
    this.logger = config.logger;
    this.pool = new ConnectionPool('default', kubeConfigFactory, {
      ...config.poolConfig,
      logger: this.logger,
    });
    // Forward pool events
    this.pool.on('connectionCreated', (conn) => {
      this.emit('connectionCreated', { connection: conn });
    });
    this.pool.on('connectionRemoved', (conn) => {
      this.emit('connectionRemoved', { connection: conn });
    });
    this.pool.on('connectionAcquired', (conn) => {
      this.emit('connectionAcquired', { connection: conn });
    });
    this.pool.on('connectionReleased', (conn) => {
      this.emit('connectionReleased', { connection: conn });
    });
  }

  /**
   * Acquire a connection from the pool
   */
  async acquire(): Promise<ConnectionEntry> {
    if (this.disposed) {
      throw new Error('Connection manager has been disposed');
    }
    return this.pool.acquire();
  }

  /**
   * Release a connection back to the pool
   */
  release(connection: ConnectionEntry): void {
    this.pool.release(connection);
  }

  /**
   * Get statistics for the cluster
   */
  getStats(): ClusterStats {
    return {
      healthy: this.isClusterHealthy(),
      poolStats: this.pool.stats,
    };
  }

  /**
   * Check if the cluster is healthy
   */
  private isClusterHealthy(): boolean {
    const stats = this.pool.stats;
    // Consider healthy if at least one available connection
    return stats.total > 0 && (stats.idle > 0 || stats.inUse > 0);
  }

  /**
   * Dispose of the connection manager
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.logger?.info('Disposing connection manager');
    await this.pool.dispose();
    this.emit('disposed');
    this.removeAllListeners();
  }
}

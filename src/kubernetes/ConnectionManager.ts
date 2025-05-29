import * as k8s from '@kubernetes/client-node';
import { Logger } from 'winston';
import { EventEmitter } from 'events';
import { ConnectionPool, ConnectionPoolConfig, ConnectionEntry } from './ConnectionPool';

/**
 * Load balancing strategies for connection selection
 */
export enum LoadBalancingStrategy {
  ROUND_ROBIN = 'round-robin',
  LEAST_CONNECTIONS = 'least-connections',
  RANDOM = 'random',
  WEIGHTED = 'weighted',
}

/**
 * Cluster configuration for connection manager
 */
export interface ClusterConfig {
  /**
   * Name of the cluster/context
   */
  name: string;

  /**
   * KubeConfig factory function
   */
  kubeConfigFactory: () => k8s.KubeConfig;

  /**
   * Weight for weighted load balancing (default: 1)
   */
  weight?: number;

  /**
   * Whether this cluster is enabled (default: true)
   */
  enabled?: boolean;

  /**
   * Connection pool configuration for this cluster
   */
  poolConfig?: ConnectionPoolConfig;
}

/**
 * Configuration for ConnectionManager
 */
export interface ConnectionManagerConfig {
  /**
   * Load balancing strategy to use
   */
  loadBalancingStrategy?: LoadBalancingStrategy;

  /**
   * Default connection pool configuration for all clusters
   */
  defaultPoolConfig?: ConnectionPoolConfig;

  /**
   * Logger instance
   */
  logger?: Logger;

  /**
   * Enable automatic failover when a cluster becomes unhealthy
   */
  enableFailover?: boolean;

  /**
   * Health check interval for cluster health monitoring (ms)
   */
  clusterHealthCheckInterval?: number;
}

/**
 * Statistics for a managed cluster
 */
export interface ClusterStats {
  name: string;
  enabled: boolean;
  healthy: boolean;
  poolStats: {
    total: number;
    idle: number;
    inUse: number;
    unhealthy: number;
    waitQueueLength: number;
  };
  lastHealthCheck?: Date;
  weight: number;
}

/**
 * Connection manager for handling multiple Kubernetes clusters
 */
export class ConnectionManager extends EventEmitter {
  private readonly pools: Map<string, ConnectionPool> = new Map();
  private readonly clusterConfigs: Map<string, ClusterConfig> = new Map();
  private readonly logger?: Logger;
  private readonly config: ConnectionManagerConfig;
  private roundRobinIndex = 0;
  private clusterHealthTimer?: NodeJS.Timeout;
  private disposed = false;

  constructor(config: ConnectionManagerConfig = {}) {
    super();
    this.config = config;
    this.logger = config.logger;

    if (config.clusterHealthCheckInterval && config.clusterHealthCheckInterval > 0) {
      this.startClusterHealthChecks();
    }
  }

  /**
   * Add a cluster to the connection manager
   */
  async addCluster(clusterConfig: ClusterConfig): Promise<void> {
    if (this.disposed) {
      throw new Error('Connection manager has been disposed');
    }

    if (this.pools.has(clusterConfig.name)) {
      throw new Error(`Cluster already exists: ${clusterConfig.name}`);
    }

    this.logger?.info(`Adding cluster: ${clusterConfig.name}`);

    // Merge pool configs
    const poolConfig = {
      ...this.config.defaultPoolConfig,
      ...clusterConfig.poolConfig,
      logger: this.logger,
    };

    // Create connection pool
    const pool = new ConnectionPool(
      clusterConfig.name,
      clusterConfig.kubeConfigFactory,
      poolConfig,
    );

    // Add event listeners
    pool.on('connectionCreated', (conn) => {
      this.emit('connectionCreated', { cluster: clusterConfig.name, connection: conn });
    });

    pool.on('connectionRemoved', (conn) => {
      this.emit('connectionRemoved', { cluster: clusterConfig.name, connection: conn });
    });

    pool.on('connectionAcquired', (conn) => {
      this.emit('connectionAcquired', { cluster: clusterConfig.name, connection: conn });
    });

    pool.on('connectionReleased', (conn) => {
      this.emit('connectionReleased', { cluster: clusterConfig.name, connection: conn });
    });

    this.pools.set(clusterConfig.name, pool);
    this.clusterConfigs.set(clusterConfig.name, {
      ...clusterConfig,
      weight: clusterConfig.weight || 1,
      enabled: clusterConfig.enabled !== false,
    });

    this.emit('clusterAdded', clusterConfig.name);
  }

  /**
   * Remove a cluster from the connection manager
   */
  async removeCluster(clusterName: string): Promise<void> {
    const pool = this.pools.get(clusterName);
    if (!pool) {
      throw new Error(`Cluster not found: ${clusterName}`);
    }

    this.logger?.info(`Removing cluster: ${clusterName}`);

    await pool.dispose();
    this.pools.delete(clusterName);
    this.clusterConfigs.delete(clusterName);

    this.emit('clusterRemoved', clusterName);
  }

  /**
   * Enable or disable a cluster
   */
  setClusterEnabled(clusterName: string, enabled: boolean): void {
    const config = this.clusterConfigs.get(clusterName);
    if (!config) {
      throw new Error(`Cluster not found: ${clusterName}`);
    }

    config.enabled = enabled;
    this.logger?.info(`Cluster ${clusterName} ${enabled ? 'enabled' : 'disabled'}`);
    this.emit('clusterStatusChanged', { cluster: clusterName, enabled });
  }

  /**
   * Get a connection from the appropriate cluster based on load balancing
   */
  async acquire(
    preferredCluster?: string,
  ): Promise<{ cluster: string; connection: ConnectionEntry }> {
    if (this.disposed) {
      throw new Error('Connection manager has been disposed');
    }

    // If preferred cluster is specified and available, use it
    if (preferredCluster) {
      const config = this.clusterConfigs.get(preferredCluster);
      const pool = this.pools.get(preferredCluster);

      if (config && config.enabled && pool) {
        try {
          const connection = await pool.acquire();
          return { cluster: preferredCluster, connection };
        } catch (error) {
          this.logger?.warn(
            `Failed to acquire from preferred cluster ${preferredCluster}: ${error}`,
          );
          if (!this.config.enableFailover) {
            throw error;
          }
          // Fall through to load balancing
        }
      }
    }

    // Select cluster based on load balancing strategy
    const cluster = await this.selectCluster();
    if (!cluster) {
      throw new Error('No available clusters');
    }

    const pool = this.pools.get(cluster);
    if (!pool) {
      throw new Error(`Pool not found for cluster: ${cluster}`);
    }

    try {
      const connection = await pool.acquire();
      return { cluster, connection };
    } catch (error) {
      this.logger?.error(`Failed to acquire connection from cluster ${cluster}: ${error}`);

      if (this.config.enableFailover) {
        // Try other clusters
        const remainingClusters = this.getEnabledClusters().filter((c) => c !== cluster);
        for (const altCluster of remainingClusters) {
          const altPool = this.pools.get(altCluster);
          if (altPool) {
            try {
              const connection = await altPool.acquire();
              this.logger?.info(`Failover successful to cluster: ${altCluster}`);
              return { cluster: altCluster, connection };
            } catch (altError) {
              this.logger?.warn(`Failover to cluster ${altCluster} failed: ${altError}`);
            }
          }
        }
      }

      throw error;
    }
  }

  /**
   * Release a connection back to its pool
   */
  release(cluster: string, connection: ConnectionEntry): void {
    const pool = this.pools.get(cluster);
    if (!pool) {
      this.logger?.error(`Cannot release connection: pool not found for cluster ${cluster}`);
      return;
    }

    pool.release(connection);
  }

  /**
   * Select a cluster based on the load balancing strategy
   */
  private async selectCluster(): Promise<string | null> {
    const enabledClusters = this.getEnabledClusters();

    if (enabledClusters.length === 0) {
      return null;
    }

    switch (this.config.loadBalancingStrategy) {
      case LoadBalancingStrategy.ROUND_ROBIN:
        return this.selectRoundRobin(enabledClusters);

      case LoadBalancingStrategy.LEAST_CONNECTIONS:
        return this.selectLeastConnections(enabledClusters);

      case LoadBalancingStrategy.RANDOM:
        return this.selectRandom(enabledClusters);

      case LoadBalancingStrategy.WEIGHTED:
        return this.selectWeighted(enabledClusters);

      default:
        return this.selectRoundRobin(enabledClusters);
    }
  }

  /**
   * Get list of enabled clusters
   */
  private getEnabledClusters(): string[] {
    const clusters: string[] = [];

    for (const [name, config] of this.clusterConfigs) {
      if (config.enabled) {
        clusters.push(name);
      }
    }

    return clusters;
  }

  /**
   * Round-robin selection
   */
  private selectRoundRobin(clusters: string[]): string {
    const selected = clusters[this.roundRobinIndex % clusters.length];
    this.roundRobinIndex++;
    return selected;
  }

  /**
   * Least connections selection
   */
  private selectLeastConnections(clusters: string[]): string | null {
    let selectedCluster: string | null = null;
    let minInUse = Infinity;

    for (const cluster of clusters) {
      const pool = this.pools.get(cluster);
      if (pool) {
        const stats = pool.stats;
        if (stats.inUse < minInUse) {
          minInUse = stats.inUse;
          selectedCluster = cluster;
        }
      }
    }

    return selectedCluster;
  }

  /**
   * Random selection
   */
  private selectRandom(clusters: string[]): string {
    const index = Math.floor(Math.random() * clusters.length);
    return clusters[index];
  }

  /**
   * Weighted selection
   */
  private selectWeighted(clusters: string[]): string {
    const weights: number[] = [];
    let totalWeight = 0;

    for (const cluster of clusters) {
      const config = this.clusterConfigs.get(cluster);
      const weight = config?.weight || 1;
      weights.push(weight);
      totalWeight += weight;
    }

    let random = Math.random() * totalWeight;

    for (let i = 0; i < clusters.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return clusters[i];
      }
    }

    return clusters[clusters.length - 1];
  }

  /**
   * Get statistics for all clusters
   */
  getStats(): Map<string, ClusterStats> {
    const stats = new Map<string, ClusterStats>();

    for (const [name, config] of this.clusterConfigs) {
      const pool = this.pools.get(name);

      if (pool) {
        stats.set(name, {
          name,
          enabled: config.enabled || false,
          healthy: this.isClusterHealthy(name),
          poolStats: pool.stats,
          weight: config.weight || 1,
        });
      }
    }

    return stats;
  }

  /**
   * Check if a cluster is healthy
   */
  private isClusterHealthy(clusterName: string): boolean {
    const pool = this.pools.get(clusterName);
    if (!pool) {
      return false;
    }

    const stats = pool.stats;
    // Consider a cluster healthy if it has at least one available connection
    return stats.total > 0 && (stats.idle > 0 || stats.inUse > 0);
  }

  /**
   * Start periodic cluster health checks
   */
  private startClusterHealthChecks(): void {
    this.clusterHealthTimer = setInterval(() => {
      this.checkClusterHealth();
    }, this.config.clusterHealthCheckInterval!);
  }

  /**
   * Check health of all clusters
   */
  private async checkClusterHealth(): Promise<void> {
    if (this.disposed) {
      return;
    }

    for (const [name, config] of this.clusterConfigs) {
      if (!config.enabled) {
        continue;
      }

      const wasHealthy = this.isClusterHealthy(name);

      // Pool has its own health checks, we just monitor the overall status
      const isHealthy = this.isClusterHealthy(name);

      if (wasHealthy !== isHealthy) {
        this.logger?.warn(`Cluster ${name} health changed: ${wasHealthy} -> ${isHealthy}`);
        this.emit('clusterHealthChanged', { cluster: name, healthy: isHealthy });

        // Auto-disable unhealthy clusters if failover is enabled
        if (!isHealthy && this.config.enableFailover) {
          const enabledCount = this.getEnabledClusters().length;
          if (enabledCount > 1) {
            this.logger?.warn(`Auto-disabling unhealthy cluster: ${name}`);
            this.setClusterEnabled(name, false);
          }
        }
      }
    }
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

    if (this.clusterHealthTimer) {
      clearInterval(this.clusterHealthTimer);
    }

    // Dispose all pools
    const disposePromises: Promise<void>[] = [];
    for (const pool of this.pools.values()) {
      disposePromises.push(pool.dispose());
    }

    await Promise.all(disposePromises);

    this.pools.clear();
    this.clusterConfigs.clear();

    this.emit('disposed');
    this.removeAllListeners();
  }
}

import * as k8s from '@kubernetes/client-node';
import { Logger } from 'winston';
import { EventEmitter } from 'events';

/**
 * Configuration options for connection pooling
 */
export interface ConnectionPoolConfig {
  /**
   * Maximum number of connections per pool
   */
  maxConnections?: number;

  /**
   * Minimum number of connections to maintain
   */
  minConnections?: number;

  /**
   * Maximum idle time for a connection before removal (ms)
   */
  maxIdleTime?: number;

  /**
   * Time to wait for a connection to become available (ms)
   */
  acquireTimeout?: number;

  /**
   * Interval for health check runs (ms)
   */
  healthCheckInterval?: number;

  /**
   * Number of retries for failed health checks
   */
  healthCheckRetries?: number;

  /**
   * Enable connection warm-up on pool initialization
   */
  enableWarmup?: boolean;

  /**
   * Logger instance for debug output
   */
  logger?: Logger;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<Omit<ConnectionPoolConfig, 'logger'>> = {
  maxConnections: 10,
  minConnections: 2,
  maxIdleTime: 300000, // 5 minutes
  acquireTimeout: 30000, // 30 seconds
  healthCheckInterval: 60000, // 1 minute
  healthCheckRetries: 3,
  enableWarmup: true,
};

/**
 * Connection state enum
 */
export enum ConnectionState {
  IDLE = 'idle',
  IN_USE = 'in-use',
  UNHEALTHY = 'unhealthy',
  DISPOSED = 'disposed',
}

/**
 * Connection entry tracking individual API client instances
 */
export class ConnectionEntry {
  private _state: ConnectionState = ConnectionState.IDLE;
  private _lastUsed: Date = new Date();
  private _createdAt: Date = new Date();
  private _useCount: number = 0;
  private _lastHealthCheck?: Date;
  private _healthCheckFailures: number = 0;

  constructor(
    public readonly id: string,
    public readonly kubeConfig: k8s.KubeConfig,
    private readonly logger?: Logger,
  ) {}

  /**
   * Get the current state of the connection
   */
  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Set the connection state
   */
  set state(value: ConnectionState) {
    this.logger?.debug(`Connection ${this.id} state changed: ${this._state} -> ${value}`);
    this._state = value;
  }

  /**
   * Get the last used timestamp
   */
  get lastUsed(): Date {
    return this._lastUsed;
  }

  /**
   * Get the creation timestamp
   */
  get createdAt(): Date {
    return this._createdAt;
  }

  /**
   * Get the use count
   */
  get useCount(): number {
    return this._useCount;
  }

  /**
   * Get health check failure count
   */
  get healthCheckFailures(): number {
    return this._healthCheckFailures;
  }

  /**
   * Get last health check timestamp
   */
  get lastHealthCheck(): Date | undefined {
    return this._lastHealthCheck;
  }

  /**
   * Mark the connection as used
   */
  markUsed(): void {
    this._lastUsed = new Date();
    this._useCount++;
    this.state = ConnectionState.IN_USE;
  }

  /**
   * Release the connection back to the pool
   */
  release(): void {
    if (this.state === ConnectionState.IN_USE) {
      this.state = ConnectionState.IDLE;
    }
  }

  /**
   * Perform a health check on the connection
   */
  async checkHealth(): Promise<boolean> {
    try {
      const api = this.kubeConfig.makeApiClient(k8s.CoreV1Api);
      await api.listNamespace();

      this._lastHealthCheck = new Date();
      this._healthCheckFailures = 0;

      if (this.state === ConnectionState.UNHEALTHY) {
        this.state = ConnectionState.IDLE;
        this.logger?.info(`Connection ${this.id} recovered`);
      }

      return true;
    } catch (error) {
      this._healthCheckFailures++;
      this.logger?.warn(`Health check failed for connection ${this.id}: ${error}`);

      if (this.state !== ConnectionState.IN_USE) {
        this.state = ConnectionState.UNHEALTHY;
      }

      return false;
    }
  }

  /**
   * Check if the connection has been idle too long
   */
  isIdleExpired(maxIdleTime: number): boolean {
    if (this.state !== ConnectionState.IDLE) {
      return false;
    }

    const idleTime = Date.now() - this.lastUsed.getTime();
    return idleTime > maxIdleTime;
  }

  /**
   * Dispose of the connection
   */
  dispose(): void {
    this.state = ConnectionState.DISPOSED;
    this.logger?.debug(`Connection ${this.id} disposed`);
  }

  /**
   * Create an API client of the specified type
   */
  makeApiClient<T extends k8s.ApiType>(apiClientType: new (config: k8s.Configuration) => T): T {
    return this.kubeConfig.makeApiClient(apiClientType);
  }
}

/**
 * Connection pool for managing Kubernetes API client connections
 */
export class ConnectionPool extends EventEmitter {
  private readonly config: Required<Omit<ConnectionPoolConfig, 'logger'>>;
  private readonly connections: Map<string, ConnectionEntry> = new Map();
  private readonly waitQueue: Array<(conn: ConnectionEntry | null) => void> = [];
  private healthCheckTimer?: NodeJS.Timeout;
  private idleCheckTimer?: NodeJS.Timeout;
  private disposed = false;
  private connectionCounter = 0;

  constructor(
    private readonly contextName: string,
    private readonly kubeConfigFactory: () => k8s.KubeConfig,
    config: ConnectionPoolConfig = {},
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = config.logger;

    this.logger?.info(`Creating connection pool for context: ${contextName}`, {
      config: this.config,
    });

    if (this.config.enableWarmup) {
      this.warmup();
    }

    this.startHealthChecks();
    this.startIdleChecks();
  }

  private logger?: Logger;

  /**
   * Get pool statistics
   */
  get stats(): {
    total: number;
    idle: number;
    inUse: number;
    unhealthy: number;
    waitQueueLength: number;
  } {
    let idle = 0;
    let inUse = 0;
    let unhealthy = 0;

    for (const conn of this.connections.values()) {
      switch (conn.state) {
        case ConnectionState.IDLE:
          idle++;
          break;
        case ConnectionState.IN_USE:
          inUse++;
          break;
        case ConnectionState.UNHEALTHY:
          unhealthy++;
          break;
      }
    }

    return {
      total: this.connections.size,
      idle,
      inUse,
      unhealthy,
      waitQueueLength: this.waitQueue.length,
    };
  }

  /**
   * Warm up the pool by creating minimum connections
   */
  private async warmup(): Promise<void> {
    this.logger?.debug(`Warming up pool for context: ${this.contextName}`);

    const promises: Promise<ConnectionEntry>[] = [];
    for (let i = 0; i < this.config.minConnections; i++) {
      promises.push(this.createConnection());
    }

    await Promise.all(promises);
    this.logger?.info(`Pool warmed up with ${this.config.minConnections} connections`);
  }

  /**
   * Create a new connection
   */
  private async createConnection(): Promise<ConnectionEntry> {
    const id = `${this.contextName}-${++this.connectionCounter}`;
    const kubeConfig = this.kubeConfigFactory();

    const connection = new ConnectionEntry(id, kubeConfig, this.logger);

    // Verify the connection works
    const isHealthy = await connection.checkHealth();
    if (!isHealthy) {
      throw new Error(`Failed to create healthy connection for context: ${this.contextName}`);
    }

    this.connections.set(id, connection);
    this.emit('connectionCreated', connection);

    this.logger?.debug(`Created connection: ${id}`);
    return connection;
  }

  /**
   * Acquire a connection from the pool
   */
  async acquire(): Promise<ConnectionEntry> {
    if (this.disposed) {
      throw new Error('Connection pool has been disposed');
    }

    // Try to find an idle connection
    for (const conn of this.connections.values()) {
      if (conn.state === ConnectionState.IDLE) {
        conn.markUsed();
        this.emit('connectionAcquired', conn);
        return conn;
      }
    }

    // Create a new connection if under the limit
    if (this.connections.size < this.config.maxConnections) {
      try {
        const conn = await this.createConnection();
        conn.markUsed();
        this.emit('connectionAcquired', conn);
        return conn;
      } catch (error) {
        this.logger?.error(`Failed to create new connection: ${error}`);
        throw error;
      }
    }

    // Wait for a connection to become available
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const index = this.waitQueue.indexOf(callback);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
        }
        reject(new Error(`Connection acquire timeout after ${this.config.acquireTimeout}ms`));
      }, this.config.acquireTimeout);

      const callback = (conn: ConnectionEntry | null) => {
        clearTimeout(timeoutId);
        if (conn) {
          conn.markUsed();
          this.emit('connectionAcquired', conn);
          resolve(conn);
        } else {
          reject(new Error('Failed to acquire connection'));
        }
      };

      this.waitQueue.push(callback);
    });
  }

  /**
   * Release a connection back to the pool
   */
  release(connection: ConnectionEntry): void {
    if (connection.state !== ConnectionState.IN_USE) {
      this.logger?.warn(`Attempting to release connection ${connection.id} that is not in use`);
      return;
    }

    connection.release();
    this.emit('connectionReleased', connection);

    // If there are waiting requests, fulfill them
    if (this.waitQueue.length > 0) {
      const callback = this.waitQueue.shift();
      if (callback) {
        callback(connection);
        return;
      }
    }

    // Check if we have too many idle connections
    const stats = this.stats;
    if (stats.idle > this.config.minConnections) {
      // Remove this connection if it's the oldest idle one
      let oldestIdle: ConnectionEntry | null = null;
      for (const conn of this.connections.values()) {
        if (conn.state === ConnectionState.IDLE && conn !== connection) {
          if (!oldestIdle || conn.lastUsed < oldestIdle.lastUsed) {
            oldestIdle = conn;
          }
        }
      }

      if (oldestIdle && oldestIdle.lastUsed < connection.lastUsed) {
        this.removeConnection(oldestIdle.id);
      }
    }
  }

  /**
   * Remove a connection from the pool
   */
  private removeConnection(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.dispose();
      this.connections.delete(connectionId);
      this.emit('connectionRemoved', conn);
      this.logger?.debug(`Removed connection: ${connectionId}`);
    }
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    if (this.config.healthCheckInterval <= 0) {
      return;
    }

    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.healthCheckInterval);
  }

  /**
   * Perform health checks on all connections
   */
  private async performHealthChecks(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.logger?.debug(`Performing health checks for pool: ${this.contextName}`);
    const promises: Promise<void>[] = [];

    for (const conn of this.connections.values()) {
      if (conn.state !== ConnectionState.IN_USE) {
        promises.push(
          conn.checkHealth().then((healthy) => {
            if (!healthy && conn.healthCheckFailures >= this.config.healthCheckRetries) {
              this.logger?.warn(`Connection ${conn.id} failed health checks, removing from pool`);
              this.removeConnection(conn.id);
            }
          }),
        );
      }
    }

    await Promise.all(promises);

    // Ensure minimum connections
    const stats = this.stats;
    if (stats.total < this.config.minConnections && !this.disposed) {
      const toCreate = this.config.minConnections - stats.total;
      for (let i = 0; i < toCreate; i++) {
        try {
          await this.createConnection();
        } catch (error) {
          this.logger?.error(`Failed to create connection during health check: ${error}`);
        }
      }
    }
  }

  /**
   * Start periodic idle connection checks
   */
  private startIdleChecks(): void {
    this.idleCheckTimer = setInterval(() => {
      this.removeIdleConnections();
    }, 30000); // Check every 30 seconds
  }

  /**
   * Remove connections that have been idle too long
   */
  private removeIdleConnections(): void {
    if (this.disposed) {
      return;
    }

    const stats = this.stats;
    if (stats.total <= this.config.minConnections) {
      return;
    }

    for (const conn of this.connections.values()) {
      if (conn.isIdleExpired(this.config.maxIdleTime) && stats.total > this.config.minConnections) {
        this.removeConnection(conn.id);
        stats.total--;
      }
    }
  }

  /**
   * Dispose of the connection pool
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.logger?.info(`Disposing connection pool for context: ${this.contextName}`);

    // Clear timers
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
    }

    // Reject all waiting requests
    while (this.waitQueue.length > 0) {
      const callback = this.waitQueue.shift();
      if (callback) {
        callback(null);
      }
    }

    // Dispose all connections
    for (const conn of this.connections.values()) {
      conn.dispose();
    }
    this.connections.clear();

    this.emit('disposed');
    this.removeAllListeners();
  }
}

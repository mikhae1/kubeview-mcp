import * as k8s from '@kubernetes/client-node';
import { Logger } from 'winston';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { ResourceOperations } from './ResourceOperations';
import { ConnectionPool, ConnectionPoolConfig, ConnectionEntry } from './ConnectionPool';

/**
 * Configuration options for KubernetesClient
 */
export interface KubernetesClientConfig {
  /**
   * Path to kubeconfig file. If not specified, will try default locations
   */
  kubeConfigPath?: string;

  /**
   * Specific context to use from kubeconfig. If not specified, uses current context
   */
  context?: string;

  /**
   * Whether to use in-cluster configuration (for pods running inside k8s)
   */
  inCluster?: boolean;

  /**
   * Bearer token for authentication
   */
  bearerToken?: string;

  /**
   * Kubernetes API server URL (used with bearerToken)
   */
  apiServerUrl?: string;

  /**
   * Skip TLS verification (not recommended for production)
   */
  skipTlsVerify?: boolean;

  /**
   * Logger instance for debug output
   */
  logger?: Logger;

  /**
   * Enable connection pooling for API clients
   */
  enableConnectionPooling?: boolean;

  /**
   * Connection pool configuration
   */
  connectionPoolConfig?: ConnectionPoolConfig;
}

/**
 * Authentication method types
 */
export enum AuthMethod {
  KUBECONFIG = 'kubeconfig',
  IN_CLUSTER = 'in-cluster',
  TOKEN = 'token',
}

/**
 * KubernetesClient provides a high-level interface for interacting with Kubernetes clusters
 */
export class KubernetesClient {
  private kc: k8s.KubeConfig;
  private coreV1Api!: k8s.CoreV1Api;
  private appsV1Api!: k8s.AppsV1Api;
  private batchV1Api!: k8s.BatchV1Api;
  private networkingV1Api!: k8s.NetworkingV1Api;
  private authMethod: AuthMethod;
  private logger?: Logger;
  private _resources: ResourceOperations;
  private connectionPool?: ConnectionPool;
  private pooledConnection?: ConnectionEntry;

  // Cached API clients when using pooling
  private cachedCoreV1Api?: k8s.CoreV1Api;
  private cachedAppsV1Api?: k8s.AppsV1Api;
  private cachedBatchV1Api?: k8s.BatchV1Api;
  private cachedNetworkingV1Api?: k8s.NetworkingV1Api;

  constructor(private config: KubernetesClientConfig = {}) {
    this.logger = config.logger;
    this.kc = new k8s.KubeConfig();
    this.authMethod = this.detectAuthMethod();
    this.initializeClient();

    if (config.enableConnectionPooling) {
      this.initializeConnectionPool();
    } else {
      this.initializeApiClients();
    }

    this._resources = new ResourceOperations(this);
  }

  /**
   * Detect which authentication method to use based on configuration
   */
  private detectAuthMethod(): AuthMethod {
    if (this.config.inCluster) {
      return AuthMethod.IN_CLUSTER;
    }

    if (this.config.bearerToken && this.config.apiServerUrl) {
      return AuthMethod.TOKEN;
    }

    return AuthMethod.KUBECONFIG;
  }

  /**
   * Initialize the Kubernetes client based on the detected auth method
   */
  private initializeClient(): void {
    try {
      switch (this.authMethod) {
        case AuthMethod.IN_CLUSTER:
          this.initializeInClusterConfig();
          break;

        case AuthMethod.TOKEN:
          this.initializeTokenConfig();
          break;

        case AuthMethod.KUBECONFIG:
        default:
          this.initializeKubeConfig();
          break;
      }

      this.logger?.info(`Kubernetes client initialized using ${this.authMethod} authentication`);
    } catch (error) {
      const message = `Failed to initialize Kubernetes client: ${error instanceof Error ? error.message : String(error)}`;
      this.logger?.error(message);
      throw new Error(message);
    }
  }

  /**
   * Initialize using kubeconfig file
   */
  private initializeKubeConfig(): void {
    const kubeConfigPath = this.getKubeConfigPath();

    if (!existsSync(kubeConfigPath)) {
      throw new Error(`Kubeconfig file not found at: ${kubeConfigPath}`);
    }

    this.kc.loadFromFile(kubeConfigPath);

    if (this.config.context) {
      this.kc.setCurrentContext(this.config.context);
    }

    this.logger?.debug(`Loaded kubeconfig from: ${kubeConfigPath}`);
  }

  /**
   * Initialize using in-cluster configuration
   */
  private initializeInClusterConfig(): void {
    this.kc.loadFromCluster();
    this.logger?.debug('Loaded in-cluster configuration');
  }

  /**
   * Initialize using bearer token
   */
  private initializeTokenConfig(): void {
    if (!this.config.bearerToken || !this.config.apiServerUrl) {
      throw new Error('Bearer token and API server URL are required for token authentication');
    }

    const cluster: k8s.Cluster = {
      name: 'default',
      server: this.config.apiServerUrl,
      skipTLSVerify: this.config.skipTlsVerify || false,
    };

    const user: k8s.User = {
      name: 'default',
      token: this.config.bearerToken,
    };

    const context: k8s.Context = {
      name: 'default',
      cluster: cluster.name,
      user: user.name,
    };

    this.kc.loadFromOptions({
      clusters: [cluster],
      users: [user],
      contexts: [context],
      currentContext: context.name,
    });

    this.logger?.debug(`Configured token authentication for: ${this.config.apiServerUrl}`);
  }

  /**
   * Get the path to the kubeconfig file
   */
  private getKubeConfigPath(): string {
    if (this.config.kubeConfigPath) {
      return this.config.kubeConfigPath;
    }

    // Check KUBECONFIG environment variable
    const kubeConfigEnv = process.env.KUBECONFIG;
    if (kubeConfigEnv) {
      // KUBECONFIG can contain multiple paths separated by :
      const paths = kubeConfigEnv.split(':');
      for (const path of paths) {
        if (existsSync(path)) {
          return path;
        }
      }
    }

    // Default location
    return join(homedir(), '.kube', 'config');
  }

  /**
   * Initialize connection pool
   */
  private initializeConnectionPool(): void {
    const contextName = this.getCurrentContext();
    const poolConfig = {
      ...this.config.connectionPoolConfig,
      logger: this.logger,
    };

    this.connectionPool = new ConnectionPool(
      contextName,
      () => {
        // Factory function to create new KubeConfig instances
        const newKc = new k8s.KubeConfig();
        switch (this.authMethod) {
          case AuthMethod.IN_CLUSTER:
            newKc.loadFromCluster();
            break;
          case AuthMethod.TOKEN:
            this.initializeTokenConfig();
            Object.assign(newKc, this.kc);
            break;
          case AuthMethod.KUBECONFIG:
          default:
            newKc.loadFromFile(this.getKubeConfigPath());
            if (this.config.context) {
              newKc.setCurrentContext(this.config.context);
            }
            break;
        }
        return newKc;
      },
      poolConfig,
    );

    this.logger?.info('Connection pooling enabled for Kubernetes client');
  }

  /**
   * Initialize API clients for different Kubernetes resources
   */
  private initializeApiClients(): void {
    this.coreV1Api = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsV1Api = this.kc.makeApiClient(k8s.AppsV1Api);
    this.batchV1Api = this.kc.makeApiClient(k8s.BatchV1Api);
    this.networkingV1Api = this.kc.makeApiClient(k8s.NetworkingV1Api);
  }

  /**
   * Get a pooled connection
   */
  private async getPooledConnection(): Promise<ConnectionEntry> {
    if (!this.connectionPool) {
      throw new Error('Connection pooling is not enabled');
    }

    if (this.pooledConnection && this.pooledConnection.state === 'in-use') {
      return this.pooledConnection;
    }

    this.pooledConnection = await this.connectionPool.acquire();
    return this.pooledConnection;
  }

  /**
   * Release the pooled connection
   */
  private releasePooledConnection(): void {
    if (this.connectionPool && this.pooledConnection) {
      this.connectionPool.release(this.pooledConnection);
      this.pooledConnection = undefined;
      // Clear cached API clients
      this.cachedCoreV1Api = undefined;
      this.cachedAppsV1Api = undefined;
      this.cachedBatchV1Api = undefined;
      this.cachedNetworkingV1Api = undefined;
    }
  }

  /**
   * Get the current cluster information
   */
  public getCurrentCluster(): k8s.Cluster | null {
    const currentContext = this.kc.getCurrentContext();
    const contexts = this.kc.getContexts();
    const context = contexts.find((c) => c.name === currentContext);

    if (!context) {
      return null;
    }

    const clusters = this.kc.getClusters();
    return clusters.find((c) => c.name === context.cluster) || null;
  }

  /**
   * Get the current context name
   */
  public getCurrentContext(): string {
    return this.kc.getCurrentContext();
  }

  /**
   * Get all available contexts
   */
  public getContexts(): string[] {
    return this.kc.getContexts().map((ctx) => ctx.name);
  }

  /**
   * Switch to a different context
   */
  public async switchContext(contextName: string): Promise<void> {
    const contexts = this.kc.getContexts();
    const context = contexts.find((c) => c.name === contextName);

    if (!context) {
      throw new Error(`Context not found: ${contextName}`);
    }

    // Release current pooled connection if using pooling
    if (this.connectionPool) {
      this.releasePooledConnection();
      await this.connectionPool.dispose();
    }

    this.kc.setCurrentContext(contextName);

    if (this.config.enableConnectionPooling) {
      this.initializeConnectionPool();
    } else {
      this.initializeApiClients();
    }

    this.logger?.info(`Switched to context: ${contextName}`);
  }

  /**
   * Get the authentication method being used
   */
  public getAuthMethod(): AuthMethod {
    return this.authMethod;
  }

  /**
   * Test the connection to the Kubernetes API server
   */
  public async testConnection(): Promise<boolean> {
    try {
      const api = await this.getCore();
      await api.listNamespace();
      this.logger?.debug('Successfully connected to Kubernetes API server');
      return true;
    } catch (error) {
      this.logger?.error(`Failed to connect to Kubernetes API server: ${error}`);
      return false;
    } finally {
      if (this.config.enableConnectionPooling) {
        this.releasePooledConnection();
      }
    }
  }

  /**
   * Get connection pool statistics
   */
  public getPoolStats(): any {
    if (!this.connectionPool) {
      return null;
    }
    return this.connectionPool.stats;
  }

  /**
   * Factory method to create a KubernetesClient from a kubeconfig file
   */
  public static fromKubeConfig(
    kubeConfigPath?: string,
    context?: string,
    logger?: Logger,
  ): KubernetesClient {
    return new KubernetesClient({
      kubeConfigPath,
      context,
      logger,
    });
  }

  /**
   * Factory method to create a KubernetesClient for in-cluster use
   */
  public static fromInCluster(logger?: Logger): KubernetesClient {
    return new KubernetesClient({
      inCluster: true,
      logger,
    });
  }

  /**
   * Factory method to create a KubernetesClient using a bearer token
   */
  public static fromToken(
    apiServerUrl: string,
    bearerToken: string,
    skipTlsVerify = false,
    logger?: Logger,
  ): KubernetesClient {
    return new KubernetesClient({
      apiServerUrl,
      bearerToken,
      skipTlsVerify,
      logger,
    });
  }

  // Getters for API clients (to be used by resource-specific methods)
  private async getCore(): Promise<k8s.CoreV1Api> {
    if (this.config.enableConnectionPooling) {
      if (!this.cachedCoreV1Api) {
        const connection = await this.getPooledConnection();
        this.cachedCoreV1Api = connection.makeApiClient(k8s.CoreV1Api);
      }
      return this.cachedCoreV1Api;
    }
    return this.coreV1Api;
  }

  public get core(): k8s.CoreV1Api {
    if (this.config.enableConnectionPooling) {
      // For backwards compatibility, return a proxy that handles async
      return new Proxy({} as k8s.CoreV1Api, {
        get: (_target, prop) => {
          return async (...args: any[]) => {
            const api = await this.getCore();
            const method = (api as any)[prop];
            if (typeof method === 'function') {
              return method.apply(api, args);
            }
            return method;
          };
        },
      });
    }
    return this.coreV1Api;
  }

  private async getApps(): Promise<k8s.AppsV1Api> {
    if (this.config.enableConnectionPooling) {
      if (!this.cachedAppsV1Api) {
        const connection = await this.getPooledConnection();
        this.cachedAppsV1Api = connection.makeApiClient(k8s.AppsV1Api);
      }
      return this.cachedAppsV1Api;
    }
    return this.appsV1Api;
  }

  public get apps(): k8s.AppsV1Api {
    if (this.config.enableConnectionPooling) {
      return new Proxy({} as k8s.AppsV1Api, {
        get: (_target, prop) => {
          return async (...args: any[]) => {
            const api = await this.getApps();
            const method = (api as any)[prop];
            if (typeof method === 'function') {
              return method.apply(api, args);
            }
            return method;
          };
        },
      });
    }
    return this.appsV1Api;
  }

  private async getBatch(): Promise<k8s.BatchV1Api> {
    if (this.config.enableConnectionPooling) {
      if (!this.cachedBatchV1Api) {
        const connection = await this.getPooledConnection();
        this.cachedBatchV1Api = connection.makeApiClient(k8s.BatchV1Api);
      }
      return this.cachedBatchV1Api;
    }
    return this.batchV1Api;
  }

  public get batch(): k8s.BatchV1Api {
    if (this.config.enableConnectionPooling) {
      return new Proxy({} as k8s.BatchV1Api, {
        get: (_target, prop) => {
          return async (...args: any[]) => {
            const api = await this.getBatch();
            const method = (api as any)[prop];
            if (typeof method === 'function') {
              return method.apply(api, args);
            }
            return method;
          };
        },
      });
    }
    return this.batchV1Api;
  }

  private async getNetworking(): Promise<k8s.NetworkingV1Api> {
    if (this.config.enableConnectionPooling) {
      if (!this.cachedNetworkingV1Api) {
        const connection = await this.getPooledConnection();
        this.cachedNetworkingV1Api = connection.makeApiClient(k8s.NetworkingV1Api);
      }
      return this.cachedNetworkingV1Api;
    }
    return this.networkingV1Api;
  }

  public get networking(): k8s.NetworkingV1Api {
    if (this.config.enableConnectionPooling) {
      return new Proxy({} as k8s.NetworkingV1Api, {
        get: (_target, prop) => {
          return async (...args: any[]) => {
            const api = await this.getNetworking();
            const method = (api as any)[prop];
            if (typeof method === 'function') {
              return method.apply(api, args);
            }
            return method;
          };
        },
      });
    }
    return this.networkingV1Api;
  }

  public get kubeConfig(): k8s.KubeConfig {
    return this.kc;
  }

  /**
   * Get resource operations for working with Kubernetes resources
   */
  public get resources(): ResourceOperations {
    return this._resources;
  }

  /**
   * Dispose of the client and clean up resources
   */
  public async dispose(): Promise<void> {
    if (this.connectionPool) {
      await this.connectionPool.dispose();
    }
  }
}

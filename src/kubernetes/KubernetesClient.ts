import * as k8s from '@kubernetes/client-node';
import { Logger } from 'winston';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { ResourceOperations } from './ResourceOperations.js';
import type { ApiType, Configuration } from '@kubernetes/client-node';
// import { URL } from 'url';

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
  private _customObjectsApi?: k8s.CustomObjectsApi;

  constructor(private config: KubernetesClientConfig = {}) {
    this.logger = config.logger;
    this.kc = new k8s.KubeConfig();
    this.authMethod = this.detectAuthMethod();
    this.initializeClient();

    this.config.skipTlsVerify = true;

    this.initializeApiClients();

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
   * Initialize API clients for different Kubernetes resources
   */
  private initializeApiClients(): void {
    this.coreV1Api = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsV1Api = this.kc.makeApiClient(k8s.AppsV1Api);
    this.batchV1Api = this.kc.makeApiClient(k8s.BatchV1Api);
    this.networkingV1Api = this.kc.makeApiClient(k8s.NetworkingV1Api);
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
   * Refresh the current context by reloading the kubeconfig file
   * This ensures we always use the latest context when executing operations
   */
  public async refreshCurrentContext(): Promise<void> {
    // Only refresh for kubeconfig-based authentication
    if (this.authMethod !== AuthMethod.KUBECONFIG) {
      this.logger?.debug('Skipping context refresh for non-kubeconfig authentication');
      return;
    }

    try {
      const kubeConfigPath = this.getKubeConfigPath();

      if (!existsSync(kubeConfigPath)) {
        this.logger?.warn(`Kubeconfig file not found at: ${kubeConfigPath} during refresh`);
        return;
      }

      // Store the old context to detect changes
      const oldContext = this.kc.getCurrentContext();

      // Reload the kubeconfig file to get the latest context
      this.kc.loadFromFile(kubeConfigPath);

      const newContext = this.kc.getCurrentContext();

      // If context changed, reinitialize API clients
      if (oldContext !== newContext) {
        this.initializeApiClients();
        this.logger?.info(
          `Context changed from '${oldContext}' to '${newContext}' - API clients reinitialized`,
        );
      } else {
        this.logger?.debug(`Context unchanged: '${newContext}'`);
      }
    } catch (error) {
      this.logger?.error(
        `Failed to refresh current context: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Don't throw - we'll continue with the existing context
    }
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

    this.kc.setCurrentContext(contextName);
    this.initializeApiClients();

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
      await this.coreV1Api.listNamespace();
      this.logger?.debug('Successfully connected to Kubernetes API server');
      return true;
    } catch (error) {
      this.logger?.error(`Failed to connect to Kubernetes API server: ${error}`);
      return false;
    }
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

  // Getters for API clients
  public get core(): k8s.CoreV1Api {
    return this.coreV1Api;
  }

  public get apps(): k8s.AppsV1Api {
    return this.appsV1Api;
  }

  public get batch(): k8s.BatchV1Api {
    return this.batchV1Api;
  }

  public get networking(): k8s.NetworkingV1Api {
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
   * Returns a Kubernetes API client for the specified API constructor.
   * This allows for accessing various Kubernetes APIs in a type-safe manner.
   * @param apiClientConstructor The constructor of the API client to instantiate (e.g., k8s.CoreV1Api).
   *                           It should conform to `new (config: Configuration) => T`.
   * @returns An instance of the requested API client.
   */
  public getGenericApiClient<T extends ApiType>(
    apiClientConstructor: new (config: Configuration) => T,
  ): T {
    return this.kc.makeApiClient(apiClientConstructor);
  }

  /**
   * Makes a generic GET request to the Kubernetes API server.
   * This is useful for accessing API endpoints not covered by specific client APIs (e.g., custom resources or aggregated APIs like metrics.k8s.io).
   * @param path The API path to request (e.g., '/apis/metrics.k8s.io/v1beta1/nodes').
   * @returns A promise that resolves with the API response.
   * @throws Will throw an error if the request fails.
   */
  public async getRaw<T = any>(path: string): Promise<T> {
    this.logger?.debug(`Making authenticated raw request to: ${path}`);

    try {
      // Use the customObjects API as a workaround for raw requests
      // Since metrics are served by the metrics-server through custom resources
      if (path.includes('metrics.k8s.io')) {
        const group = 'metrics.k8s.io';
        const version = 'v1beta1';

        if (path.includes('/nodes')) {
          return (await this.customObjects.listClusterCustomObject({
            group: group,
            version: version,
            plural: 'nodes',
          })) as T;
        } else if (path.includes('/pods')) {
          // Handle namespaced vs cluster-wide pod metrics
          const namespacedMatch = path.match(/\/namespaces\/([\w-]+)\/pods/);
          if (namespacedMatch) {
            const namespace = namespacedMatch[1];
            return (await this.customObjects.listNamespacedCustomObject({
              group: group,
              version: version,
              namespace: namespace,
              plural: 'pods',
            })) as T;
          } else {
            return (await this.customObjects.listClusterCustomObject({
              group: group,
              version: version,
              plural: 'pods',
            })) as T;
          }
        }
      }

      // For non-metrics paths, throw an error explaining the limitation
      throw new Error(
        `Raw requests are only supported for metrics.k8s.io API paths. Attempted path: ${path}`,
      );
    } catch (error: any) {
      this.logger?.error(`Error making raw request to ${path}: ${error.message}`);

      // If it's a 403 error, provide more helpful debugging information
      if (error.statusCode === 403 || (error.response && error.response.statusCode === 403)) {
        this.logger?.error(
          'Authentication failed - check that your kubeconfig is valid and you have the necessary permissions',
        );
        this.logger?.error(
          'If using exec-based auth, ensure the authentication plugin is properly configured',
        );
      }

      throw error;
    }
  }

  public get customObjects(): k8s.CustomObjectsApi {
    if (!this._customObjectsApi) {
      this._customObjectsApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
    }
    return this._customObjectsApi;
  }

  /**
   * Sets whether to skip TLS verification for API requests
   * @param skip True to skip TLS verification, false otherwise
   */
  public setSkipTlsVerify(skip: boolean): void {
    this.config.skipTlsVerify = skip;
    this.logger?.debug(`TLS verification set to: ${!skip}`);
  }
}

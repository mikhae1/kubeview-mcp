import * as k8s from '@kubernetes/client-node';
import { Logger } from 'winston';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { ResourceOperations } from './ResourceOperations.js';
import type { ApiType, Configuration } from '@kubernetes/client-node';
import { URL } from 'url';
import * as http from 'http';
import * as https from 'https';

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
  private storageV1Api!: k8s.StorageV1Api;
  private autoscalingV2Api!: k8s.AutoscalingV2Api;
  private policyV1Api!: k8s.PolicyV1Api;
  private discoveryV1Api!: k8s.DiscoveryV1Api;
  private rbacAuthorizationV1Api!: k8s.RbacAuthorizationV1Api;
  private authorizationV1Api!: k8s.AuthorizationV1Api;
  private authMethod: AuthMethod;
  private logger?: Logger;
  private _resources: ResourceOperations;
  private _customObjectsApi?: k8s.CustomObjectsApi;

  constructor(private config: KubernetesClientConfig = {}) {
    this.logger = config.logger;
    this.kc = new k8s.KubeConfig();
    this.authMethod = this.detectAuthMethod();
    this.initializeClient();

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
    this.storageV1Api = this.kc.makeApiClient(k8s.StorageV1Api);
    // Additional APIs for debugging tools
    this.autoscalingV2Api = this.kc.makeApiClient(k8s.AutoscalingV2Api);
    this.policyV1Api = this.kc.makeApiClient(k8s.PolicyV1Api);
    this.discoveryV1Api = this.kc.makeApiClient(k8s.DiscoveryV1Api);
    // RBAC and Authorization APIs
    this.rbacAuthorizationV1Api = this.kc.makeApiClient(k8s.RbacAuthorizationV1Api);
    this.authorizationV1Api = this.kc.makeApiClient(k8s.AuthorizationV1Api);
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
   * Get the current namespace from the active context, falling back to 'default' if undefined
   */
  public getCurrentNamespace(): string | undefined {
    const currentContextName = this.kc.getCurrentContext();
    const contexts = this.kc.getContexts();
    const ctx = contexts.find((c) => c.name === currentContextName);
    // Kubernetes defaults to 'default' namespace when not specified
    return ctx?.namespace || 'default';
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

  public get storage(): k8s.StorageV1Api {
    return this.storageV1Api;
  }

  public get kubeConfig(): k8s.KubeConfig {
    return this.kc;
  }

  public get autoscaling(): k8s.AutoscalingV2Api {
    return this.autoscalingV2Api;
  }

  public get policy(): k8s.PolicyV1Api {
    return this.policyV1Api;
  }

  public get discovery(): k8s.DiscoveryV1Api {
    return this.discoveryV1Api;
  }

  public get rbac(): k8s.RbacAuthorizationV1Api {
    return this.rbacAuthorizationV1Api;
  }

  public get authorization(): k8s.AuthorizationV1Api {
    return this.authorizationV1Api;
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
      // Fast path: metrics.k8s.io via CustomObjects API (avoids manual HTTP plumbing)
      if (path.includes('metrics.k8s.io')) {
        const group = 'metrics.k8s.io';
        const version = 'v1beta1';

        if (path.includes('/nodes')) {
          const resp = (await this.customObjects.listClusterCustomObject({
            group,
            version,
            plural: 'nodes',
          })) as any;
          return (resp?.body ?? resp) as T;
        }

        if (path.includes('/pods')) {
          const namespacedMatch = path.match(/\/namespaces\/([\w-]+)\/pods/);
          if (namespacedMatch) {
            const namespace = namespacedMatch[1];
            const resp = (await this.customObjects.listNamespacedCustomObject({
              group,
              version,
              namespace,
              plural: 'pods',
            })) as any;
            return (resp?.body ?? resp) as T;
          }
          const resp = (await this.customObjects.listClusterCustomObject({
            group,
            version,
            plural: 'pods',
          })) as any;
          return (resp?.body ?? resp) as T;
        }
      }

      // Generic Kubernetes API raw GET support (e.g., /api/v1/nodes/{name}/proxy/stats/summary)
      const cluster = this.getCurrentCluster();
      if (!cluster || !cluster.server) {
        throw new Error('No current cluster server configured');
      }

      const base = cluster.server.replace(/\/$/, '');
      const fullUrl = `${base}${path.startsWith('/') ? path : `/${path}`}`;
      const url = new URL(fullUrl);

      // Prepare request options and let kubeconfig inject auth and TLS material
      const reqOpts: any = {
        method: 'GET',
        headers: { Accept: 'application/json' as const },
        // Node https options
        hostname: url.hostname,
        port: url.port ? parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        protocol: url.protocol,
      };

      // Apply kubeconfig auth to headers/TLS if available (supports exec plugins)
      try {
        const maybeApply: any = this.kc as any;
        if (maybeApply && typeof maybeApply.applyToRequest === 'function') {
          const reqLike: any = { url: fullUrl, headers: { ...(reqOpts.headers || {}) } };
          maybeApply.applyToRequest(reqLike);
          // Merge headers set by applyToRequest
          reqOpts.headers = { ...(reqOpts.headers || {}), ...(reqLike.headers || {}) };
          // Also copy TLS fields if present
          if (reqLike.ca) (reqOpts as any).ca = reqLike.ca;
          if (reqLike.cert) (reqOpts as any).cert = reqLike.cert;
          if (reqLike.key) (reqOpts as any).key = reqLike.key;
        }
      } catch (e) {
        this.logger?.warn?.(
          `applyToRequest integration failed for ${fullUrl}: ${e instanceof Error ? e.message : e}`,
        );
      }

      // Apply simple auth based on current kubeconfig user (token) and cluster TLS options
      const user = this.kc.getCurrentUser();
      if (user && (user as any).token) {
        reqOpts.headers = reqOpts.headers || {};
        reqOpts.headers.Authorization = `Bearer ${(user as any).token}`;
      }

      // Honor skipTlsVerify when using HTTPS and attach CA/cert/key if provided
      if (url.protocol === 'https:') {
        const clusterAny: any = this.getCurrentCluster();
        const skipTls = this.config.skipTlsVerify || clusterAny?.skipTLSVerify;
        (reqOpts as any).rejectUnauthorized = !skipTls;

        if (clusterAny?.caData) {
          try {
            (reqOpts as any).ca = Buffer.from(clusterAny.caData, 'base64');
          } catch {
            (reqOpts as any).ca = clusterAny.caData;
          }
        }
        if ((user as any)?.certData) {
          try {
            (reqOpts as any).cert = Buffer.from((user as any).certData, 'base64');
          } catch {
            (reqOpts as any).cert = (user as any).certData;
          }
        }
        if ((user as any)?.keyData) {
          try {
            (reqOpts as any).key = Buffer.from((user as any).keyData, 'base64');
          } catch {
            (reqOpts as any).key = (user as any).keyData;
          }
        }
      }

      const client = url.protocol === 'https:' ? https : http;

      return await new Promise<T>((resolve, reject) => {
        const req = client.request(reqOpts, (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            const status = res.statusCode || 0;
            if (status >= 200 && status < 300) {
              try {
                const parsed = raw ? JSON.parse(raw) : ({} as T);
                resolve(parsed as T);
              } catch (parseErr: any) {
                this.logger?.error(
                  `Failed to parse JSON from ${fullUrl}: ${parseErr?.message || parseErr}`,
                );
                // Return raw string if not JSON
                resolve(raw as unknown as T);
              }
            } else {
              this.logger?.error(
                `Raw request to ${fullUrl} failed: ${status} ${res.statusMessage}. Body: ${raw?.slice(0, 1024)}`,
              );
              reject(new Error(`HTTP ${status} ${res.statusMessage}`));
            }
          });
        });
        req.on('error', (err) => reject(err));
        req.end();
      });
    } catch (error: any) {
      this.logger?.error(`Error making raw request to ${path}: ${error.message}`);

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

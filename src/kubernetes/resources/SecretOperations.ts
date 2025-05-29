import * as k8s from '@kubernetes/client-node';
import {
  BaseResourceOperations,
  ResourceOperationOptions,
  WatchCallback,
  WatchEventType,
} from '../ResourceOperations';
import { KubernetesClient } from '../KubernetesClient';

/**
 * Secret types
 */
export enum SecretType {
  OPAQUE = 'Opaque',
  SERVICE_ACCOUNT_TOKEN = 'kubernetes.io/service-account-token',
  DOCKER_CONFIG = 'kubernetes.io/dockercfg',
  DOCKER_CONFIG_JSON = 'kubernetes.io/dockerconfigjson',
  BASIC_AUTH = 'kubernetes.io/basic-auth',
  SSH_AUTH = 'kubernetes.io/ssh-auth',
  TLS = 'kubernetes.io/tls',
}

/**
 * Secret operations implementation
 */
export class SecretOperations extends BaseResourceOperations<k8s.V1Secret> {
  constructor(client: KubernetesClient) {
    super(client, 'Secret');
  }

  /**
   * Create a new Secret
   */
  async create(secret: k8s.V1Secret, options?: ResourceOperationOptions): Promise<k8s.V1Secret> {
    try {
      const namespace = options?.namespace || secret.metadata?.namespace || 'default';
      const response = await this.client.core.createNamespacedSecret({
        namespace,
        body: secret,
      });
      this.logger?.info(`Created Secret '${secret.metadata?.name}' in namespace '${namespace}'`);
      return response;
    } catch (error) {
      this.handleApiError(error, 'Create', secret.metadata?.name);
    }
  }

  /**
   * Get a Secret by name
   */
  async get(name: string, options?: ResourceOperationOptions): Promise<k8s.V1Secret> {
    try {
      const namespace = options?.namespace || 'default';
      const response = await this.client.core.readNamespacedSecret({
        name,
        namespace,
      });
      return response;
    } catch (error) {
      this.handleApiError(error, 'Get', name);
    }
  }

  /**
   * Update a Secret
   */
  async update(secret: k8s.V1Secret, options?: ResourceOperationOptions): Promise<k8s.V1Secret> {
    try {
      const namespace = options?.namespace || secret.metadata?.namespace || 'default';
      const name = secret.metadata?.name;
      if (!name) {
        throw new Error('Secret name is required for update');
      }
      const response = await this.client.core.replaceNamespacedSecret({
        name,
        namespace,
        body: secret,
      });
      this.logger?.info(`Updated Secret '${name}' in namespace '${namespace}'`);
      return response;
    } catch (error) {
      this.handleApiError(error, 'Update', secret.metadata?.name);
    }
  }

  /**
   * Patch a Secret
   */
  async patch(name: string, patch: any, options?: ResourceOperationOptions): Promise<k8s.V1Secret> {
    try {
      const namespace = options?.namespace || 'default';
      const response = await this.client.core.patchNamespacedSecret({
        name,
        namespace,
        body: patch,
      });
      this.logger?.info(`Patched Secret '${name}' in namespace '${namespace}'`);
      return response;
    } catch (error) {
      this.handleApiError(error, 'Patch', name);
    }
  }

  /**
   * Delete a Secret
   */
  async delete(name: string, options?: ResourceOperationOptions): Promise<void> {
    try {
      const namespace = options?.namespace || 'default';
      const deleteOptions = this.buildDeleteOptions(options);
      await this.client.core.deleteNamespacedSecret({
        name,
        namespace,
        body: deleteOptions,
      });
      this.logger?.info(`Deleted Secret '${name}' from namespace '${namespace}'`);
    } catch (error) {
      this.handleApiError(error, 'Delete', name);
    }
  }

  /**
   * List Secrets
   */
  async list(options?: ResourceOperationOptions): Promise<k8s.V1SecretList> {
    try {
      const namespace = options?.namespace;
      const listOptions = this.buildListOptions(options);

      let response;
      if (namespace) {
        response = await this.client.core.listNamespacedSecret({
          namespace,
          pretty: listOptions.pretty,
          allowWatchBookmarks: listOptions.allowWatchBookmarks,
          _continue: listOptions.continue,
          fieldSelector: listOptions.fieldSelector,
          labelSelector: listOptions.labelSelector,
          limit: listOptions.limit,
          resourceVersion: listOptions.resourceVersion,
          resourceVersionMatch: listOptions.resourceVersionMatch,
          sendInitialEvents: listOptions.sendInitialEvents,
          timeoutSeconds: listOptions.timeoutSeconds,
          watch: listOptions.watch,
        });
      } else {
        response = await this.client.core.listSecretForAllNamespaces({
          allowWatchBookmarks: listOptions.allowWatchBookmarks,
          _continue: listOptions.continue,
          fieldSelector: listOptions.fieldSelector,
          labelSelector: listOptions.labelSelector,
          limit: listOptions.limit,
          pretty: listOptions.pretty,
          resourceVersion: listOptions.resourceVersion,
          resourceVersionMatch: listOptions.resourceVersionMatch,
          sendInitialEvents: listOptions.sendInitialEvents,
          timeoutSeconds: listOptions.timeoutSeconds,
          watch: listOptions.watch,
        });
      }

      return response;
    } catch (error) {
      this.handleApiError(error, 'List');
    }
  }

  /**
   * Watch Secrets for changes
   */
  watch(callback: WatchCallback<k8s.V1Secret>, options?: ResourceOperationOptions): () => void {
    const namespace = options?.namespace;
    const watch = new k8s.Watch(this.client.kubeConfig);
    let aborted = false;

    const startWatch = async () => {
      try {
        const req = await watch.watch(
          `/api/v1/${namespace ? `namespaces/${namespace}/` : ''}secrets`,
          this.buildListOptions(options),
          (type: string, obj: k8s.V1Secret) => {
            if (!aborted) {
              callback({
                type: type as WatchEventType,
                object: obj,
              });
            }
          },
          (err: any) => {
            if (!aborted) {
              this.logger?.error(`Watch error for Secrets: ${err}`);
              callback({
                type: WatchEventType.ERROR,
                object: err,
              });
            }
          },
        );

        return req;
      } catch (error) {
        this.logger?.error(`Failed to start watch for Secrets: ${error}`);
        throw error;
      }
    };

    let request: any;
    startWatch().then((req) => {
      request = req;
    });

    return () => {
      aborted = true;
      if (request) {
        request.abort();
      }
    };
  }

  /**
   * Create an Opaque Secret from string data
   */
  async createOpaque(
    name: string,
    stringData: { [key: string]: string },
    options?: ResourceOperationOptions & { labels?: { [key: string]: string } },
  ): Promise<k8s.V1Secret> {
    const namespace = options?.namespace || 'default';

    const secret: k8s.V1Secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name,
        namespace,
        labels: options?.labels,
      },
      type: SecretType.OPAQUE,
      stringData,
    };

    return this.create(secret, options);
  }

  /**
   * Create a TLS Secret
   */
  async createTLS(
    name: string,
    tlsCert: string,
    tlsKey: string,
    options?: ResourceOperationOptions & { labels?: { [key: string]: string } },
  ): Promise<k8s.V1Secret> {
    const namespace = options?.namespace || 'default';

    const secret: k8s.V1Secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name,
        namespace,
        labels: options?.labels,
      },
      type: SecretType.TLS,
      stringData: {
        'tls.crt': tlsCert,
        'tls.key': tlsKey,
      },
    };

    return this.create(secret, options);
  }

  /**
   * Create a Docker Registry Secret
   */
  async createDockerRegistry(
    name: string,
    server: string,
    username: string,
    password: string,
    email?: string,
    options?: ResourceOperationOptions & { labels?: { [key: string]: string } },
  ): Promise<k8s.V1Secret> {
    const namespace = options?.namespace || 'default';

    const dockerConfig = {
      auths: {
        [server]: {
          username,
          password,
          email: email || '',
          auth: Buffer.from(`${username}:${password}`).toString('base64'),
        },
      },
    };

    const secret: k8s.V1Secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name,
        namespace,
        labels: options?.labels,
      },
      type: SecretType.DOCKER_CONFIG_JSON,
      stringData: {
        '.dockerconfigjson': JSON.stringify(dockerConfig),
      },
    };

    return this.create(secret, options);
  }

  /**
   * Create a Basic Auth Secret
   */
  async createBasicAuth(
    name: string,
    username: string,
    password: string,
    options?: ResourceOperationOptions & { labels?: { [key: string]: string } },
  ): Promise<k8s.V1Secret> {
    const namespace = options?.namespace || 'default';

    const secret: k8s.V1Secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name,
        namespace,
        labels: options?.labels,
      },
      type: SecretType.BASIC_AUTH,
      stringData: {
        username,
        password,
      },
    };

    return this.create(secret, options);
  }

  /**
   * Create an SSH Auth Secret
   */
  async createSSHAuth(
    name: string,
    privateKey: string,
    options?: ResourceOperationOptions & { labels?: { [key: string]: string } },
  ): Promise<k8s.V1Secret> {
    const namespace = options?.namespace || 'default';

    const secret: k8s.V1Secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name,
        namespace,
        labels: options?.labels,
      },
      type: SecretType.SSH_AUTH,
      stringData: {
        'ssh-privatekey': privateKey,
      },
    };

    return this.create(secret, options);
  }

  /**
   * Get decoded Secret data
   */
  async getDecodedData(
    name: string,
    options?: ResourceOperationOptions,
  ): Promise<{ [key: string]: string } | undefined> {
    try {
      const secret = await this.get(name, options);

      if (!secret.data) {
        return secret.stringData || undefined;
      }

      const decodedData: { [key: string]: string } = {};

      for (const [key, value] of Object.entries(secret.data)) {
        decodedData[key] = Buffer.from(value, 'base64').toString('utf-8');
      }

      return decodedData;
    } catch (error) {
      this.handleApiError(error, 'GetDecodedData', name);
    }
  }

  /**
   * Get a specific decoded value from a Secret
   */
  async getDecodedValue(
    name: string,
    key: string,
    options?: ResourceOperationOptions,
  ): Promise<string | undefined> {
    try {
      const decodedData = await this.getDecodedData(name, options);
      return decodedData?.[key];
    } catch (error) {
      this.handleApiError(error, 'GetDecodedValue', name);
    }
  }

  /**
   * Update or add a key-value pair in a Secret
   */
  async setKey(
    name: string,
    key: string,
    value: string,
    options?: ResourceOperationOptions,
  ): Promise<k8s.V1Secret> {
    try {
      const secret = await this.get(name, options);

      // Convert existing data to stringData for easier manipulation
      const decodedData = (await this.getDecodedData(name, options)) || {};
      decodedData[key] = value;

      // Clear data and use stringData for the update
      secret.data = undefined;
      secret.stringData = decodedData;

      return this.update(secret, options);
    } catch (error) {
      this.handleApiError(error, 'SetKey', name);
    }
  }

  /**
   * Remove a key from a Secret
   */
  async removeKey(
    name: string,
    key: string,
    options?: ResourceOperationOptions,
  ): Promise<k8s.V1Secret> {
    try {
      const secret = await this.get(name, options);

      // Convert existing data to stringData for easier manipulation
      const decodedData = (await this.getDecodedData(name, options)) || {};
      delete decodedData[key];

      // Clear data and use stringData for the update
      secret.data = undefined;
      secret.stringData = decodedData;

      return this.update(secret, options);
    } catch (error) {
      this.handleApiError(error, 'RemoveKey', name);
    }
  }
}

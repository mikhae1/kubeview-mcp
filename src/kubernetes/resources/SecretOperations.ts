import * as k8s from '@kubernetes/client-node';
import {
  BaseResourceOperations,
  ResourceOperationOptions,
  WatchCallback,
  WatchEventType,
} from '../BaseResourceOperations.js';
import { KubernetesClient } from '../KubernetesClient.js';

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
  async create(_secret: k8s.V1Secret, _options?: ResourceOperationOptions): Promise<k8s.V1Secret> {
    throw new Error('Create operation is not supported in read-only mode');
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
  async update(_secret: k8s.V1Secret, _options?: ResourceOperationOptions): Promise<k8s.V1Secret> {
    throw new Error('Update operation is not supported in read-only mode');
  }

  /**
   * Patch a Secret
   */
  async patch(
    _name: string,
    _patch: unknown,
    _options?: ResourceOperationOptions,
  ): Promise<k8s.V1Secret> {
    throw new Error('Patch operation is not supported in read-only mode');
  }

  /**
   * Delete a Secret
   */
  async delete(_name: string, _options?: ResourceOperationOptions): Promise<void> {
    throw new Error('Delete operation is not supported in read-only mode');
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

      // The skipSanitize parameter is accepted for API compatibility but doesn't affect output yet
      if (!options?.skipSanitize) {
        // For now, just sanitize the data field by removing the actual secret values
        // to prevent accidental exposure of sensitive data
        response.items = response.items.map((secret: k8s.V1Secret) => ({
          ...secret,
          data: secret.data
            ? Object.keys(secret.data).reduce((acc: { [key: string]: string }, key: string) => {
                acc[key] = '*** FILTERED ***';
                return acc;
              }, {})
            : undefined,
        }));
      }

      response.items = response.items.map((item) => ({
        ...item,
        name: item.metadata?.name,
        namespace: item.metadata?.namespace,
        metadata: {
          labels: item.metadata?.labels,
          annotations: item.metadata?.annotations,
          creationTimestamp: item.metadata?.creationTimestamp,
        },
      }));

      // Remove data from response if namespace is not provided
      if (!namespace) {
        response.items = response.items.map((item) => ({
          ...item,
          data: undefined,
          binaryData: undefined,
          metadata: undefined,
        }));
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
    let stopWatching = false;
    let request: unknown = null;

    const startWatch = async (): Promise<void> => {
      try {
        const namespace = options?.namespace;
        const listOptions = this.buildListOptions(options);

        const watch = new k8s.Watch(this.client.kubeConfig);
        request = await watch.watch(
          `/api/v1/${namespace ? `namespaces/${namespace}/` : ''}secrets`,
          listOptions,
          (type: string, obj: k8s.V1Secret) => {
            if (!stopWatching) {
              callback({
                type: type as WatchEventType,
                object: obj,
              });
            }
          },
          (err: unknown) => {
            if (!stopWatching) {
              this.logger?.error(`Watch error for Secrets: ${err}`);
              // For error events, we need to create a valid V1Secret-like object
              const errorObj = {
                apiVersion: 'v1',
                kind: 'Secret',
                metadata: { name: 'watch-error' },
                data: { error: Buffer.from(String(err)).toString('base64') },
              } as k8s.V1Secret;

              callback({
                type: WatchEventType.ERROR,
                object: errorObj,
              });
            }
          },
        );
      } catch (error) {
        this.logger?.error(`Failed to start watch for Secrets: ${error}`);
        throw error;
      }
    };

    startWatch().catch((error) => {
      this.logger?.error(`Failed to start Secret watch: ${error}`);
    });

    return () => {
      stopWatching = true;
      if (request && typeof request === 'object' && request !== null && 'abort' in request) {
        (request as { abort: () => void }).abort();
      }
    };
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
   * Get a secret with MCP tool-friendly formatting
   */
  async getFormatted(
    name: string,
    options?: ResourceOperationOptions,
  ): Promise<{
    resourceType: string;
    metadata: any;
    type: string;
    dataKeys: string[];
    stringDataKeys: string[];
  }> {
    try {
      const secret = await this.get(name, options);

      // Note: Secret data is base64 encoded, we'll return keys only for security
      return {
        resourceType: 'secret',
        metadata: this.formatResourceMetadata(secret),
        type: secret.type || 'Opaque',
        dataKeys: secret.data ? Object.keys(secret.data) : [],
        stringDataKeys: secret.stringData ? Object.keys(secret.stringData) : [],
      };
    } catch (error) {
      this.handleApiError(error, 'GetFormatted', name);
    }
  }

  private formatResourceMetadata(resource: any): any {
    return {
      name: resource.metadata?.name,
      namespace: resource.metadata?.namespace,
      uid: resource.metadata?.uid,
      resourceVersion: resource.metadata?.resourceVersion,
      generation: resource.metadata?.generation,
      creationTimestamp: resource.metadata?.creationTimestamp,
      labels: resource.metadata?.labels || {},
      annotations: resource.metadata?.annotations || {},
    };
  }
}

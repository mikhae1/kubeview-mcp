import { V1ConfigMap, V1ConfigMapList, Watch } from '@kubernetes/client-node';
import {
  BaseResourceOperations,
  ResourceOperationOptions,
  WatchCallback,
  WatchEventType,
} from '../ResourceOperations';
import { KubernetesClient } from '../KubernetesClient';

/**
 * ConfigMap operations implementation
 */
export class ConfigMapOperations extends BaseResourceOperations<V1ConfigMap> {
  constructor(client: KubernetesClient) {
    super(client, 'ConfigMap');
  }

  /**
   * Create a new ConfigMap
   */
  async create(configMap: V1ConfigMap, options?: ResourceOperationOptions): Promise<V1ConfigMap> {
    try {
      const namespace = options?.namespace || configMap.metadata?.namespace || 'default';
      const response = await this.client.core.createNamespacedConfigMap({
        namespace,
        body: configMap,
      });
      this.logger?.info(
        `Created ConfigMap '${configMap.metadata?.name}' in namespace '${namespace}'`,
      );
      return response;
    } catch (error) {
      this.handleApiError(error, 'Create', configMap.metadata?.name);
    }
  }

  /**
   * Get a ConfigMap by name
   */
  async get(name: string, options?: ResourceOperationOptions): Promise<V1ConfigMap> {
    try {
      const namespace = options?.namespace || 'default';
      const response = await this.client.core.readNamespacedConfigMap({
        name,
        namespace,
      });
      return response;
    } catch (error) {
      this.handleApiError(error, 'Get', name);
    }
  }

  /**
   * Update a ConfigMap
   */
  async update(configMap: V1ConfigMap, options?: ResourceOperationOptions): Promise<V1ConfigMap> {
    try {
      const namespace = options?.namespace || configMap.metadata?.namespace || 'default';
      const name = configMap.metadata?.name;
      if (!name) {
        throw new Error('ConfigMap name is required for update');
      }
      const response = await this.client.core.replaceNamespacedConfigMap({
        name,
        namespace,
        body: configMap,
      });
      this.logger?.info(`Updated ConfigMap '${name}' in namespace '${namespace}'`);
      return response;
    } catch (error) {
      this.handleApiError(error, 'Update', configMap.metadata?.name);
    }
  }

  /**
   * Patch a ConfigMap
   */
  async patch(name: string, patch: any, options?: ResourceOperationOptions): Promise<V1ConfigMap> {
    try {
      const namespace = options?.namespace || 'default';
      const response = await this.client.core.patchNamespacedConfigMap({
        name,
        namespace,
        body: patch,
      });
      this.logger?.info(`Patched ConfigMap '${name}' in namespace '${namespace}'`);
      return response;
    } catch (error) {
      this.handleApiError(error, 'Patch', name);
    }
  }

  /**
   * Delete a ConfigMap
   */
  async delete(name: string, options?: ResourceOperationOptions): Promise<void> {
    try {
      const namespace = options?.namespace || 'default';
      const deleteOptions = this.buildDeleteOptions(options);
      await this.client.core.deleteNamespacedConfigMap({
        name,
        namespace,
        body: deleteOptions,
      });
      this.logger?.info(`Deleted ConfigMap '${name}' from namespace '${namespace}'`);
    } catch (error) {
      this.handleApiError(error, 'Delete', name);
    }
  }

  /**
   * List ConfigMaps
   */
  async list(options?: ResourceOperationOptions): Promise<V1ConfigMapList> {
    try {
      const namespace = options?.namespace;
      const listOptions = this.buildListOptions(options);

      let response;
      if (namespace) {
        response = await this.client.core.listNamespacedConfigMap({
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
        response = await this.client.core.listConfigMapForAllNamespaces({
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
   * Watch ConfigMaps for changes
   */
  watch(callback: WatchCallback<V1ConfigMap>, options?: ResourceOperationOptions): () => void {
    const namespace = options?.namespace;
    const watch = new Watch(this.client.kubeConfig);
    let aborted = false;

    const startWatch = async () => {
      try {
        const req = await watch.watch(
          `/api/v1/${namespace ? `namespaces/${namespace}/` : ''}configmaps`,
          this.buildListOptions(options),
          (type: string, obj: V1ConfigMap) => {
            if (!aborted) {
              callback({
                type: type as WatchEventType,
                object: obj,
              });
            }
          },
          (err: any) => {
            if (!aborted) {
              this.logger?.error(`Watch error for ConfigMaps: ${err}`);
              callback({
                type: WatchEventType.ERROR,
                object: err,
              });
            }
          },
        );

        return req;
      } catch (error) {
        this.logger?.error(`Failed to start watch for ConfigMaps: ${error}`);
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
   * Create a ConfigMap from key-value pairs
   */
  async createFromData(
    name: string,
    data: { [key: string]: string },
    options?: ResourceOperationOptions & { labels?: { [key: string]: string } },
  ): Promise<V1ConfigMap> {
    const namespace = options?.namespace || 'default';

    const configMap: V1ConfigMap = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name,
        namespace,
        labels: options?.labels,
      },
      data,
    };

    return this.create(configMap, options);
  }

  /**
   * Create a ConfigMap from files (binary data)
   */
  async createFromBinaryData(
    name: string,
    binaryData: { [key: string]: string },
    options?: ResourceOperationOptions & { labels?: { [key: string]: string } },
  ): Promise<V1ConfigMap> {
    const namespace = options?.namespace || 'default';

    const configMap: V1ConfigMap = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name,
        namespace,
        labels: options?.labels,
      },
      binaryData,
    };

    return this.create(configMap, options);
  }

  /**
   * Add or update a key in a ConfigMap
   */
  async setKey(
    name: string,
    key: string,
    value: string,
    options?: ResourceOperationOptions,
  ): Promise<V1ConfigMap> {
    try {
      const configMap = await this.get(name, options);

      if (!configMap.data) {
        configMap.data = {};
      }

      configMap.data[key] = value;

      return this.update(configMap, options);
    } catch (error) {
      this.handleApiError(error, 'SetKey', name);
    }
  }

  /**
   * Remove a key from a ConfigMap
   */
  async removeKey(
    name: string,
    key: string,
    options?: ResourceOperationOptions,
  ): Promise<V1ConfigMap> {
    try {
      const configMap = await this.get(name, options);

      if (configMap.data && configMap.data[key]) {
        delete configMap.data[key];
      }

      if (configMap.binaryData && configMap.binaryData[key]) {
        delete configMap.binaryData[key];
      }

      return this.update(configMap, options);
    } catch (error) {
      this.handleApiError(error, 'RemoveKey', name);
    }
  }

  /**
   * Get value of a specific key from a ConfigMap
   */
  async getValue(
    name: string,
    key: string,
    options?: ResourceOperationOptions,
  ): Promise<string | undefined> {
    try {
      const configMap = await this.get(name, options);

      if (configMap.data && configMap.data[key]) {
        return configMap.data[key];
      }

      if (configMap.binaryData && configMap.binaryData[key]) {
        return configMap.binaryData[key];
      }

      return undefined;
    } catch (error) {
      this.handleApiError(error, 'GetValue', name);
    }
  }
}

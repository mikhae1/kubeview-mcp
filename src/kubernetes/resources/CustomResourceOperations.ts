import {
  KubernetesObject,
  Watch,
  CustomObjectsApi,
  ApiextensionsV1Api,
  KubernetesListObject,
} from '@kubernetes/client-node';
import {
  BaseResourceOperations,
  ResourceOperationOptions,
  WatchCallback,
  WatchEventType,
} from '../ResourceOperations';
import { KubernetesClient } from '../KubernetesClient';

/**
 * Custom Resource operations implementation
 */
export class CustomResourceOperations<
  T extends KubernetesObject,
> extends BaseResourceOperations<T> {
  private customObjectsApi: CustomObjectsApi;

  constructor(
    client: KubernetesClient,
    private group: string,
    private version: string,
    private plural: string,
    private namespaced: boolean = true,
  ) {
    super(client, plural);
    this.customObjectsApi = client.kubeConfig.makeApiClient(CustomObjectsApi);
  }

  /**
   * Create a new custom resource
   */
  async create(resource: T, options?: ResourceOperationOptions): Promise<T> {
    try {
      const namespace = options?.namespace || resource.metadata?.namespace || 'default';

      let response;
      if (this.namespaced) {
        response = await this.customObjectsApi.createNamespacedCustomObject({
          group: this.group,
          version: this.version,
          namespace,
          plural: this.plural,
          body: resource,
        });
      } else {
        response = await this.customObjectsApi.createClusterCustomObject({
          group: this.group,
          version: this.version,
          plural: this.plural,
          body: resource,
        });
      }

      this.logger?.info(
        `Created custom resource '${resource.metadata?.name}' of type '${this.plural}'`,
      );
      return response as T;
    } catch (error) {
      this.handleApiError(error, 'Create', resource.metadata?.name);
    }
  }

  /**
   * Get a custom resource by name
   */
  async get(name: string, options?: ResourceOperationOptions): Promise<T> {
    try {
      const namespace = options?.namespace || 'default';

      let response;
      if (this.namespaced) {
        response = await this.customObjectsApi.getNamespacedCustomObject({
          group: this.group,
          version: this.version,
          namespace,
          plural: this.plural,
          name,
        });
      } else {
        response = await this.customObjectsApi.getClusterCustomObject({
          group: this.group,
          version: this.version,
          plural: this.plural,
          name,
        });
      }

      return response as T;
    } catch (error) {
      this.handleApiError(error, 'Get', name);
    }
  }

  /**
   * Update a custom resource
   */
  async update(resource: T, options?: ResourceOperationOptions): Promise<T> {
    try {
      const namespace = options?.namespace || resource.metadata?.namespace || 'default';
      const name = resource.metadata?.name;
      if (!name) {
        throw new Error('Resource name is required for update');
      }

      let response;
      if (this.namespaced) {
        response = await this.customObjectsApi.replaceNamespacedCustomObject({
          group: this.group,
          version: this.version,
          namespace,
          plural: this.plural,
          name,
          body: resource,
        });
      } else {
        response = await this.customObjectsApi.replaceClusterCustomObject({
          group: this.group,
          version: this.version,
          plural: this.plural,
          name,
          body: resource,
        });
      }

      this.logger?.info(`Updated custom resource '${name}' of type '${this.plural}'`);
      return response as T;
    } catch (error) {
      this.handleApiError(error, 'Update', resource.metadata?.name);
    }
  }

  /**
   * Patch a custom resource
   */
  async patch(name: string, patch: any, options?: ResourceOperationOptions): Promise<T> {
    try {
      const namespace = options?.namespace || 'default';

      let response;
      if (this.namespaced) {
        response = await this.customObjectsApi.patchNamespacedCustomObject({
          group: this.group,
          version: this.version,
          namespace,
          plural: this.plural,
          name,
          body: patch,
        });
      } else {
        response = await this.customObjectsApi.patchClusterCustomObject({
          group: this.group,
          version: this.version,
          plural: this.plural,
          name,
          body: patch,
        });
      }

      this.logger?.info(`Patched custom resource '${name}' of type '${this.plural}'`);
      return response as T;
    } catch (error) {
      this.handleApiError(error, 'Patch', name);
    }
  }

  /**
   * Delete a custom resource
   */
  async delete(name: string, options?: ResourceOperationOptions): Promise<void> {
    try {
      const namespace = options?.namespace || 'default';
      const deleteOptions = this.buildDeleteOptions(options);

      if (this.namespaced) {
        await this.customObjectsApi.deleteNamespacedCustomObject({
          group: this.group,
          version: this.version,
          namespace,
          plural: this.plural,
          name,
          body: deleteOptions,
        });
      } else {
        await this.customObjectsApi.deleteClusterCustomObject({
          group: this.group,
          version: this.version,
          plural: this.plural,
          name,
          body: deleteOptions,
        });
      }

      this.logger?.info(`Deleted custom resource '${name}' of type '${this.plural}'`);
    } catch (error) {
      this.handleApiError(error, 'Delete', name);
    }
  }

  /**
   * List custom resources
   */
  async list(options?: ResourceOperationOptions): Promise<KubernetesListObject<T>> {
    try {
      const namespace = options?.namespace;
      const listOptions = this.buildListOptions(options);

      let response;
      if (this.namespaced && namespace) {
        response = await this.customObjectsApi.listNamespacedCustomObject({
          group: this.group,
          version: this.version,
          namespace,
          plural: this.plural,
          pretty: listOptions.pretty,
          allowWatchBookmarks: listOptions.allowWatchBookmarks,
          _continue: listOptions.continue,
          fieldSelector: listOptions.fieldSelector,
          labelSelector: listOptions.labelSelector,
          limit: listOptions.limit,
          resourceVersion: listOptions.resourceVersion,
          resourceVersionMatch: listOptions.resourceVersionMatch,
          timeoutSeconds: listOptions.timeoutSeconds,
          watch: listOptions.watch,
        });
      } else {
        response = await this.customObjectsApi.listClusterCustomObject({
          group: this.group,
          version: this.version,
          plural: this.plural,
          pretty: listOptions.pretty,
          allowWatchBookmarks: listOptions.allowWatchBookmarks,
          _continue: listOptions.continue,
          fieldSelector: listOptions.fieldSelector,
          labelSelector: listOptions.labelSelector,
          limit: listOptions.limit,
          resourceVersion: listOptions.resourceVersion,
          resourceVersionMatch: listOptions.resourceVersionMatch,
          timeoutSeconds: listOptions.timeoutSeconds,
          watch: listOptions.watch,
        });
      }

      return response as KubernetesListObject<T>;
    } catch (error) {
      this.handleApiError(error, 'List');
    }
  }

  /**
   * Watch custom resources for changes
   */
  watch(callback: WatchCallback<T>, options?: ResourceOperationOptions): () => void {
    const namespace = options?.namespace;
    const watch = new Watch(this.client.kubeConfig);
    let aborted = false;

    const startWatch = async () => {
      try {
        const path =
          this.namespaced && namespace
            ? `/apis/${this.group}/${this.version}/namespaces/${namespace}/${this.plural}`
            : `/apis/${this.group}/${this.version}/${this.plural}`;

        const req = await watch.watch(
          path,
          this.buildListOptions(options),
          (type: string, obj: T) => {
            if (!aborted) {
              callback({
                type: type as WatchEventType,
                object: obj,
              });
            }
          },
          (err: any) => {
            if (!aborted) {
              this.logger?.error(`Watch error for custom resources (${this.plural}): ${err}`);
              callback({
                type: WatchEventType.ERROR,
                object: err,
              });
            }
          },
        );

        return req;
      } catch (error) {
        this.logger?.error(`Failed to start watch for custom resources (${this.plural}): ${error}`);
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
   * Get the custom resource's status subresource
   */
  async getStatus(name: string, options?: ResourceOperationOptions): Promise<any> {
    try {
      const namespace = options?.namespace || 'default';

      let response;
      if (this.namespaced) {
        response = await this.customObjectsApi.getNamespacedCustomObjectStatus({
          group: this.group,
          version: this.version,
          namespace,
          plural: this.plural,
          name,
        });
      } else {
        response = await this.customObjectsApi.getClusterCustomObjectStatus({
          group: this.group,
          version: this.version,
          plural: this.plural,
          name,
        });
      }

      return response;
    } catch (error) {
      this.handleApiError(error, 'GetStatus', name);
    }
  }

  /**
   * Update the custom resource's status subresource
   */
  async updateStatus(name: string, status: any, options?: ResourceOperationOptions): Promise<T> {
    try {
      const namespace = options?.namespace || 'default';
      const resource = await this.get(name, options);
      (resource as any).status = status;

      let response;
      if (this.namespaced) {
        response = await this.customObjectsApi.replaceNamespacedCustomObjectStatus({
          group: this.group,
          version: this.version,
          namespace,
          plural: this.plural,
          name,
          body: resource,
        });
      } else {
        response = await this.customObjectsApi.replaceClusterCustomObjectStatus({
          group: this.group,
          version: this.version,
          plural: this.plural,
          name,
          body: resource,
        });
      }

      this.logger?.info(`Updated status for custom resource '${name}' of type '${this.plural}'`);
      return response as T;
    } catch (error) {
      this.handleApiError(error, 'UpdateStatus', name);
    }
  }

  /**
   * Check if a Custom Resource Definition exists
   */
  async crdExists(): Promise<boolean> {
    try {
      const apiExtensions = this.client.kubeConfig.makeApiClient(ApiextensionsV1Api);
      const crdName = `${this.plural}.${this.group}`;

      await apiExtensions.readCustomResourceDefinition({
        name: crdName,
      });
      return true;
    } catch (error) {
      if ((error as any).response?.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }
}

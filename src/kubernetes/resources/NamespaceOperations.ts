import * as k8s from '@kubernetes/client-node';
import {
  BaseResourceOperations,
  ResourceOperationOptions,
  WatchCallback,
  WatchEventType,
} from '../BaseResourceOperations.js';
import { KubernetesClient } from '../KubernetesClient.js';

/**
 * Namespace operations implementation - Read-only operations
 */
export class NamespaceOperations extends BaseResourceOperations<k8s.V1Namespace> {
  constructor(client: KubernetesClient) {
    super(client, 'Namespace');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async create(
    _namespace: k8s.V1Namespace,
    _options?: ResourceOperationOptions,
  ): Promise<k8s.V1Namespace> {
    throw new Error('Create operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async update(
    _namespace: k8s.V1Namespace,
    _options?: ResourceOperationOptions,
  ): Promise<k8s.V1Namespace> {
    throw new Error('Update operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async patch(
    _name: string,
    _patch: any,
    _options?: ResourceOperationOptions,
  ): Promise<k8s.V1Namespace> {
    throw new Error('Patch operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async delete(_name: string, _options?: ResourceOperationOptions): Promise<void> {
    throw new Error('Delete operation is not supported in read-only mode');
  }

  /**
   * Get a Namespace by name
   */
  async get(name: string, _options?: ResourceOperationOptions): Promise<k8s.V1Namespace> {
    try {
      const response = await this.client.core.readNamespace({ name });
      return response;
    } catch (error) {
      this.handleApiError(error, 'Get', name);
    }
  }

  /**
   * List Namespaces
   */
  async list(_options?: ResourceOperationOptions): Promise<k8s.V1NamespaceList> {
    try {
      const response = await this.client.core.listNamespace();
      return response;
    } catch (error) {
      this.handleApiError(error, 'List');
    }
  }

  /**
   * Watch Namespaces for changes
   */
  watch(callback: WatchCallback<k8s.V1Namespace>, options?: ResourceOperationOptions): () => void {
    const watch = new k8s.Watch(this.client.kubeConfig);
    let aborted = false;

    const startWatch = async () => {
      try {
        const req = await watch.watch(
          `/api/v1/namespaces`,
          this.buildListOptions(options),
          (type: string, obj: k8s.V1Namespace) => {
            if (!aborted) {
              callback({
                type: type as WatchEventType,
                object: obj,
              });
            }
          },
          (err: any) => {
            if (!aborted) {
              this.logger?.error(`Watch error for Namespaces: ${err}`);
              callback({
                type: WatchEventType.ERROR,
                object: err,
              });
            }
          },
        );
        return req;
      } catch (error) {
        this.logger?.error(`Failed to start watch for Namespaces: ${error}`);
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
}

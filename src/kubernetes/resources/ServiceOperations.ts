import * as k8s from '@kubernetes/client-node';
import {
  BaseResourceOperations,
  ResourceOperationOptions,
  WatchCallback,
  WatchEventType,
} from '../ResourceOperations';
import { KubernetesClient } from '../KubernetesClient';

/**
 * Service operations implementation
 */
export class ServiceOperations extends BaseResourceOperations<k8s.V1Service> {
  constructor(client: KubernetesClient) {
    super(client, 'Service');
  }

  /**
   * Create a new service
   */
  async create(service: k8s.V1Service, options?: ResourceOperationOptions): Promise<k8s.V1Service> {
    try {
      const namespace = options?.namespace || service.metadata?.namespace || 'default';
      const response = await this.client.core.createNamespacedService({
        namespace,
        body: service,
      });
      this.logger?.info(`Created service '${service.metadata?.name}' in namespace '${namespace}'`);
      return response;
    } catch (error) {
      this.handleApiError(error, 'Create', service.metadata?.name);
    }
  }

  /**
   * Get a service by name
   */
  async get(name: string, options?: ResourceOperationOptions): Promise<k8s.V1Service> {
    try {
      const namespace = options?.namespace || 'default';
      const response = await this.client.core.readNamespacedService({
        name,
        namespace,
      });
      return response;
    } catch (error) {
      this.handleApiError(error, 'Get', name);
    }
  }

  /**
   * Update a service
   */
  async update(service: k8s.V1Service, options?: ResourceOperationOptions): Promise<k8s.V1Service> {
    try {
      const namespace = options?.namespace || service.metadata?.namespace || 'default';
      const name = service.metadata?.name;
      if (!name) {
        throw new Error('Service name is required for update');
      }
      const response = await this.client.core.replaceNamespacedService({
        name,
        namespace,
        body: service,
      });
      this.logger?.info(`Updated service '${name}' in namespace '${namespace}'`);
      return response;
    } catch (error) {
      this.handleApiError(error, 'Update', service.metadata?.name);
    }
  }

  /**
   * Patch a service
   */
  async patch(
    name: string,
    patch: any,
    options?: ResourceOperationOptions,
  ): Promise<k8s.V1Service> {
    try {
      const namespace = options?.namespace || 'default';
      const response = await this.client.core.patchNamespacedService({
        name,
        namespace,
        body: patch,
      });
      this.logger?.info(`Patched service '${name}' in namespace '${namespace}'`);
      return response;
    } catch (error) {
      this.handleApiError(error, 'Patch', name);
    }
  }

  /**
   * Delete a service
   */
  async delete(name: string, options?: ResourceOperationOptions): Promise<void> {
    try {
      const namespace = options?.namespace || 'default';
      const deleteOptions = this.buildDeleteOptions(options);
      await this.client.core.deleteNamespacedService({
        name,
        namespace,
        body: deleteOptions,
      });
      this.logger?.info(`Deleted service '${name}' from namespace '${namespace}'`);
    } catch (error) {
      this.handleApiError(error, 'Delete', name);
    }
  }

  /**
   * List services
   */
  async list(options?: ResourceOperationOptions): Promise<k8s.V1ServiceList> {
    try {
      const namespace = options?.namespace;
      const listOptions = this.buildListOptions(options);

      let response;
      if (namespace) {
        response = await this.client.core.listNamespacedService({
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
        response = await this.client.core.listServiceForAllNamespaces({
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
   * Watch services for changes
   */
  watch(callback: WatchCallback<k8s.V1Service>, options?: ResourceOperationOptions): () => void {
    const namespace = options?.namespace;
    const watch = new k8s.Watch(this.client.kubeConfig);
    let aborted = false;

    const startWatch = async () => {
      try {
        const req = await watch.watch(
          `/api/v1/${namespace ? `namespaces/${namespace}/` : ''}services`,
          this.buildListOptions(options),
          (type: string, obj: k8s.V1Service) => {
            if (!aborted) {
              callback({
                type: type as WatchEventType,
                object: obj,
              });
            }
          },
          (err: any) => {
            if (!aborted) {
              this.logger?.error(`Watch error for services: ${err}`);
              callback({
                type: WatchEventType.ERROR,
                object: err,
              });
            }
          },
        );

        return req;
      } catch (error) {
        this.logger?.error(`Failed to start watch for services: ${error}`);
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
   * Get service endpoints
   */
  async getEndpoints(name: string, options?: ResourceOperationOptions): Promise<k8s.V1Endpoints> {
    try {
      const namespace = options?.namespace || 'default';
      const response = await this.client.core.readNamespacedEndpoints({
        name,
        namespace,
      });
      return response;
    } catch (error) {
      this.handleApiError(error, 'GetEndpoints', name);
    }
  }

  /**
   * Update service status
   */
  async updateStatus(
    name: string,
    status: k8s.V1ServiceStatus,
    options?: ResourceOperationOptions,
  ): Promise<k8s.V1Service> {
    try {
      const namespace = options?.namespace || 'default';
      const service = await this.get(name, options);
      service.status = status;

      const response = await this.client.core.patchNamespacedServiceStatus({
        name,
        namespace,
        body: service,
      });

      this.logger?.info(`Updated status for service '${name}' in namespace '${namespace}'`);
      return response;
    } catch (error) {
      this.handleApiError(error, 'UpdateStatus', name);
    }
  }

  /**
   * Create a service from a pod template
   */
  async createFromPod(
    pod: k8s.V1Pod,
    port: number,
    options?: ResourceOperationOptions & { serviceName?: string; serviceType?: string },
  ): Promise<k8s.V1Service> {
    const namespace = options?.namespace || pod.metadata?.namespace || 'default';
    const podName = pod.metadata?.name || 'unknown';
    const serviceName = options?.serviceName || `${podName}-service`;

    const service: k8s.V1Service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: serviceName,
        namespace,
        labels: pod.metadata?.labels,
      },
      spec: {
        selector: pod.metadata?.labels || {},
        ports: [
          {
            protocol: 'TCP',
            port: port,
            targetPort: port,
          },
        ],
        type: (options?.serviceType as any) || 'ClusterIP',
      },
    };

    return this.create(service, options);
  }
}

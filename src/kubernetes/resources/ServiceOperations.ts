import * as k8s from '@kubernetes/client-node';
import {
  BaseResourceOperations,
  ResourceOperationOptions,
  WatchCallback,
  WatchEventType,
} from '../BaseResourceOperations.js';
import { KubernetesClient } from '../KubernetesClient.js';

/**
 * Service operations implementation - Read-only operations
 */
export class ServiceOperations extends BaseResourceOperations<k8s.V1Service> {
  constructor(client: KubernetesClient) {
    super(client, 'Service');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async create(
    _service: k8s.V1Service,
    _options?: ResourceOperationOptions,
  ): Promise<k8s.V1Service> {
    throw new Error('Create operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async update(
    _service: k8s.V1Service,
    _options?: ResourceOperationOptions,
  ): Promise<k8s.V1Service> {
    throw new Error('Update operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async patch(
    _name: string,
    _patch: any,
    _options?: ResourceOperationOptions,
  ): Promise<k8s.V1Service> {
    throw new Error('Patch operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async delete(_name: string, _options?: ResourceOperationOptions): Promise<void> {
    throw new Error('Delete operation is not supported in read-only mode');
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
   * List services with MCP tool-friendly formatting
   */
  async listFormatted(options?: ResourceOperationOptions): Promise<{
    total: number;
    namespace: string;
    services: Array<{
      metadata: any;
      spec: any;
      status: any;
    }>;
  }> {
    try {
      const result = await this.list(options);
      const namespace = options?.namespace || 'all';

      const services = result.items.map((service: any) => ({
        metadata: this.formatResourceMetadata(service),
        spec: {
          type: service.spec?.type,
          clusterIP: service.spec?.clusterIP,
          externalIPs: service.spec?.externalIPs || [],
          ports:
            service.spec?.ports?.map((port: any) => ({
              name: port.name,
              protocol: port.protocol,
              port: port.port,
              targetPort: port.targetPort,
              nodePort: port.nodePort,
            })) || [],
          selector: service.spec?.selector || {},
          sessionAffinity: service.spec?.sessionAffinity,
          loadBalancerIP: service.spec?.loadBalancerIP,
          externalName: service.spec?.externalName,
        },
        status: {
          loadBalancer: service.status?.loadBalancer,
        },
      }));

      return {
        total: services.length,
        namespace,
        services,
      };
    } catch (error) {
      this.handleApiError(error, 'ListFormatted');
    }
  }

  /**
   * Get a service with MCP tool-friendly formatting
   */
  async getFormatted(
    name: string,
    options?: ResourceOperationOptions,
  ): Promise<{
    resourceType: string;
    metadata: any;
    spec: any;
    status: any;
  }> {
    try {
      const service = await this.get(name, options);

      return {
        resourceType: 'service',
        metadata: this.formatResourceMetadata(service),
        spec: {
          type: service.spec?.type,
          clusterIP: service.spec?.clusterIP,
          externalIPs: service.spec?.externalIPs || [],
          ports: service.spec?.ports || [],
          selector: service.spec?.selector || {},
          sessionAffinity: service.spec?.sessionAffinity,
          loadBalancerIP: service.spec?.loadBalancerIP,
          externalName: service.spec?.externalName,
        },
        status: service.status || {},
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

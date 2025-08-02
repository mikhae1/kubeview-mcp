import * as k8s from '@kubernetes/client-node';
import {
  BaseResourceOperations,
  ResourceOperationOptions,
  WatchCallback,
  WatchEventType,
} from '../BaseResourceOperations.js';
import { KubernetesClient } from '../KubernetesClient.js';

/**
 * Ingress operations implementation - Read-only operations
 */
export class IngressOperations extends BaseResourceOperations<k8s.V1Ingress> {
  constructor(client: KubernetesClient) {
    super(client, 'Ingress');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async create(
    _ingress: k8s.V1Ingress,
    _options?: ResourceOperationOptions,
  ): Promise<k8s.V1Ingress> {
    throw new Error('Create operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async update(
    _ingress: k8s.V1Ingress,
    _options?: ResourceOperationOptions,
  ): Promise<k8s.V1Ingress> {
    throw new Error('Update operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async patch(
    _name: string,
    _patch: any,
    _options?: ResourceOperationOptions,
  ): Promise<k8s.V1Ingress> {
    throw new Error('Patch operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async delete(_name: string, _options?: ResourceOperationOptions): Promise<void> {
    throw new Error('Delete operation is not supported in read-only mode');
  }

  /**
   * Get an ingress by name
   */
  async get(name: string, options?: ResourceOperationOptions): Promise<k8s.V1Ingress> {
    try {
      const namespace = options?.namespace || 'default';
      const response = await this.client.networking.readNamespacedIngress({
        name,
        namespace,
      });
      return response;
    } catch (error) {
      this.handleApiError(error, 'Get', name);
    }
  }

  /**
   * List ingresses
   */
  async list(options?: ResourceOperationOptions): Promise<k8s.V1IngressList> {
    try {
      const namespace = options?.namespace;
      const listOptions = this.buildListOptions(options);

      let response;
      if (namespace) {
        response = await this.client.networking.listNamespacedIngress({
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
        response = await this.client.networking.listIngressForAllNamespaces({
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
   * Watch ingresses for changes
   */
  watch(callback: WatchCallback<k8s.V1Ingress>, options?: ResourceOperationOptions): () => void {
    const namespace = options?.namespace;
    const watch = new k8s.Watch(this.client.kubeConfig);
    let aborted = false;

    const startWatch = async () => {
      try {
        const req = await watch.watch(
          `/apis/networking.k8s.io/v1/${namespace ? `namespaces/${namespace}/` : ''}ingresses`,
          this.buildListOptions(options),
          (type: string, obj: k8s.V1Ingress) => {
            if (!aborted) {
              callback({
                type: type as WatchEventType,
                object: obj,
              });
            }
          },
          (err: any) => {
            if (!aborted) {
              this.logger?.error(`Watch error for ingresses: ${err}`);
              callback({
                type: WatchEventType.ERROR,
                object: err,
              });
            }
          },
        );

        return req;
      } catch (error) {
        this.logger?.error(`Failed to start watch for ingresses: ${error}`);
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
   * List ingresses with MCP tool-friendly formatting
   */
  async listFormatted(options?: ResourceOperationOptions): Promise<{
    total: number;
    namespace: string;
    ingresses: Array<{
      metadata: any;
      spec: any;
      status: any;
    }>;
  }> {
    try {
      const result = await this.list(options);
      const namespace = options?.namespace || 'all';

      const ingresses = result.items.map((ingress: any) => ({
        metadata: this.formatResourceMetadata(ingress),
        spec: {
          ingressClassName: ingress.spec?.ingressClassName,
          defaultBackend: ingress.spec?.defaultBackend,
          tls:
            ingress.spec?.tls?.map((tls: any) => ({
              hosts: tls.hosts || [],
              secretName: tls.secretName,
            })) || [],
          rules:
            ingress.spec?.rules?.map((rule: any) => ({
              host: rule.host,
              http: rule.http
                ? {
                    paths:
                      rule.http.paths?.map((path: any) => ({
                        path: path.path,
                        pathType: path.pathType,
                        backend: {
                          service: path.backend?.service
                            ? {
                                name: path.backend.service.name,
                                port: path.backend.service.port,
                              }
                            : undefined,
                          resource: path.backend?.resource,
                        },
                      })) || [],
                  }
                : undefined,
            })) || [],
        },
        status: {
          loadBalancer: ingress.status?.loadBalancer,
        },
      }));

      return {
        total: ingresses.length,
        namespace,
        ingresses,
      };
    } catch (error) {
      this.handleApiError(error, 'ListFormatted');
    }
  }

  /**
   * Get an ingress with MCP tool-friendly formatting
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
      const ingress = await this.get(name, options);

      return {
        resourceType: 'ingress',
        metadata: this.formatResourceMetadata(ingress),
        spec: {
          ingressClassName: ingress.spec?.ingressClassName,
          defaultBackend: ingress.spec?.defaultBackend,
          tls: ingress.spec?.tls || [],
          rules: ingress.spec?.rules || [],
        },
        status: ingress.status || {},
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

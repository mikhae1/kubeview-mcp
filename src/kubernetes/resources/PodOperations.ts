import * as k8s from '@kubernetes/client-node';
import { V1Pod } from '@kubernetes/client-node';
import {
  BaseResourceOperations,
  ResourceOperationOptions,
  WatchCallback,
  WatchEventType,
} from '../BaseResourceOperations.js';
import { KubernetesClient } from '../KubernetesClient.js';

/**
 * Pod-specific operation options
 */
export interface PodOperationOptions extends ResourceOperationOptions {
  /**
   * Container name for log operations
   */
  container?: string;

  /**
   * Follow logs in real-time
   */
  follow?: boolean;

  /**
   * Number of lines to tail from logs
   */
  tailLines?: number;

  /**
   * Get previous container logs
   */
  previous?: boolean;

  /**
   * Timestamps in log output
   */
  timestamps?: boolean;
}

/**
 * Pod operations implementation - Read-only operations
 */
export class PodOperations extends BaseResourceOperations<V1Pod> {
  constructor(client: KubernetesClient) {
    super(client, 'Pod');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async create(_pod: V1Pod, _options?: ResourceOperationOptions): Promise<V1Pod> {
    throw new Error('Create operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async update(_pod: V1Pod, _options?: ResourceOperationOptions): Promise<V1Pod> {
    throw new Error('Update operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async patch(_name: string, _patch: any, _options?: ResourceOperationOptions): Promise<V1Pod> {
    throw new Error('Patch operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async delete(_name: string, _options?: ResourceOperationOptions): Promise<void> {
    throw new Error('Delete operation is not supported in read-only mode');
  }

  /**
   * Get a pod by name
   */
  async get(name: string, options?: ResourceOperationOptions): Promise<k8s.V1Pod> {
    try {
      const namespace = options?.namespace || 'default';
      const response = await this.client.core.readNamespacedPod({
        name,
        namespace,
      });
      return response;
    } catch (error) {
      this.handleApiError(error, 'Get', name);
    }
  }

  /**
   * List pods
   */
  async list(options?: ResourceOperationOptions): Promise<k8s.V1PodList> {
    try {
      const namespace = options?.namespace;
      const listOptions = this.buildListOptions(options);

      let response;
      if (namespace) {
        response = await this.client.core.listNamespacedPod({
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
        response = await this.client.core.listPodForAllNamespaces({
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
   * Watch pods for changes
   */
  watch(callback: WatchCallback<k8s.V1Pod>, options?: ResourceOperationOptions): () => void {
    const namespace = options?.namespace;

    const watch = new k8s.Watch(this.client.kubeConfig);
    let aborted = false;

    const startWatch = async () => {
      try {
        const req = await watch.watch(
          `/api/v1/${namespace ? `namespaces/${namespace}/` : ''}pods`,
          this.buildListOptions(options),
          (type: string, obj: k8s.V1Pod) => {
            if (!aborted) {
              callback({
                type: type as WatchEventType,
                object: obj,
              });
            }
          },
          (err: any) => {
            if (!aborted) {
              this.logger?.error(`Watch error for pods: ${err}`);
              callback({
                type: WatchEventType.ERROR,
                object: err,
              });
            }
          },
        );

        // Store the request for cleanup
        return req;
      } catch (error) {
        this.logger?.error(`Failed to start watch for pods: ${error}`);
        throw error;
      }
    };

    // Start the watch
    let request: any;
    startWatch().then((req) => {
      request = req;
    });

    // Return cleanup function
    return () => {
      aborted = true;
      if (request) {
        request.abort();
      }
    };
  }

  /**
   * Get pod logs
   */
  async getLogs(name: string, options?: PodOperationOptions): Promise<string> {
    try {
      const namespace = options?.namespace || 'default';
      const response = await this.client.core.readNamespacedPodLog({
        name,
        namespace,
        container: options?.container,
        follow: options?.follow,
        tailLines: options?.tailLines,
        previous: options?.previous,
        timestamps: options?.timestamps,
      });
      return response as unknown as string;
    } catch (error) {
      this.handleApiError(error, 'GetLogs', name);
    }
  }

  /**
   * Stream pod logs
   */
  streamLogs(
    name: string,
    onData: (data: string) => void,
    options?: PodOperationOptions,
  ): () => void {
    const namespace = options?.namespace || 'default';
    let aborted = false;

    const startStream = async () => {
      try {
        const stream = await this.client.core.readNamespacedPodLog({
          name,
          namespace,
          container: options?.container,
          follow: options?.follow,
          tailLines: options?.tailLines,
          previous: options?.previous,
          timestamps: options?.timestamps,
        });

        const pollLogs = async () => {
          if (aborted) return;

          try {
            const logs = await this.getLogs(name, {
              ...options,
              follow: false,
            });
            onData(logs);
          } catch (error) {
            this.logger?.error(`Error polling logs for pod '${name}': ${error}`);
          }

          if (!aborted) {
            setTimeout(pollLogs, 5000); // Poll every 5 seconds
          }
        };

        if (options?.follow) {
          pollLogs();
        } else {
          onData(stream as unknown as string);
        }
      } catch (error) {
        this.logger?.error(`Failed to start log stream for pod '${name}': ${error}`);
        throw error;
      }
    };

    startStream();

    return () => {
      aborted = true;
    };
  }

  /**
   * Get pod metrics
   */
  async getMetrics(name: string, options?: ResourceOperationOptions): Promise<any> {
    try {
      const namespace = options?.namespace || 'default';
      const customObjectsApi = this.client.kubeConfig.makeApiClient(k8s.CustomObjectsApi);
      const response = await customObjectsApi.getNamespacedCustomObject({
        group: 'metrics.k8s.io',
        version: 'v1beta1',
        namespace,
        plural: 'pods',
        name,
      });
      return response;
    } catch (error) {
      this.handleApiError(error, 'GetMetrics', name);
    }
  }

  /**
   * List pods with MCP tool-friendly formatting
   */
  async listFormatted(options?: ResourceOperationOptions): Promise<{
    total: number;
    namespace: string;
    pods: Array<{
      metadata: any;
      status: any;
      spec: any;
    }>;
  }> {
    try {
      const result = await this.list(options);
      const namespace = options?.namespace || 'all';

      const pods = result.items.map((pod: any) => ({
        metadata: this.formatResourceMetadata(pod),
        status: {
          ...this.formatResourceStatus(pod),
          phase: pod.status?.phase,
          podIP: pod.status?.podIP,
          hostIP: pod.status?.hostIP,
          startTime: pod.status?.startTime,
          containerStatuses:
            pod.status?.containerStatuses?.map((cs: any) => ({
              name: cs.name,
              image: cs.image,
              ready: cs.ready,
              restartCount: cs.restartCount,
              state: cs.state,
            })) || [],
        },
        spec: {
          nodeName: pod.spec?.nodeName,
          containers:
            pod.spec?.containers?.map((c: any) => ({
              name: c.name,
              image: c.image,
              ports: c.ports || [],
              resources: c.resources || {},
            })) || [],
        },
      }));

      return {
        total: pods.length,
        namespace,
        pods,
      };
    } catch (error) {
      this.handleApiError(error, 'ListFormatted');
    }
  }

  /**
   * Get a pod with MCP tool-friendly formatting
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
      const pod = await this.get(name, options);

      return {
        resourceType: 'pod',
        metadata: this.formatResourceMetadata(pod),
        spec: {
          nodeName: pod.spec?.nodeName,
          serviceAccountName: pod.spec?.serviceAccountName,
          restartPolicy: pod.spec?.restartPolicy,
          containers:
            pod.spec?.containers?.map((c: any) => ({
              name: c.name,
              image: c.image,
              command: c.command,
              args: c.args,
              ports: c.ports || [],
              env: c.env || [],
              resources: c.resources || {},
              volumeMounts: c.volumeMounts || [],
            })) || [],
          volumes: pod.spec?.volumes || [],
        },
        status: {
          ...this.formatResourceStatus(pod),
          phase: pod.status?.phase,
          podIP: pod.status?.podIP,
          hostIP: pod.status?.hostIP,
          startTime: pod.status?.startTime,
          containerStatuses: pod.status?.containerStatuses || [],
        },
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

  private formatResourceStatus(resource: any): any {
    return {
      conditions: resource.status?.conditions || [],
    };
  }
}

import * as k8s from '@kubernetes/client-node';
import { V1Pod } from '@kubernetes/client-node';
import {
  BaseResourceOperations,
  ResourceOperationOptions,
  WatchCallback,
  WatchEventType,
} from '../ResourceOperations';
import { KubernetesClient } from '../KubernetesClient';

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
 * Pod operations implementation
 */
export class PodOperations extends BaseResourceOperations<V1Pod> {
  constructor(client: KubernetesClient) {
    super(client, 'Pod');
  }

  /**
   * Create a new pod
   */
  async create(pod: V1Pod, options?: ResourceOperationOptions): Promise<V1Pod> {
    try {
      const namespace = options?.namespace || pod.metadata?.namespace || 'default';
      const response = await this.client.core.createNamespacedPod({
        namespace,
        body: pod,
      });
      this.logger?.info(`Created pod '${pod.metadata?.name}' in namespace '${namespace}'`);
      return response;
    } catch (error) {
      this.handleApiError(error, 'Create', pod.metadata?.name);
    }
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
   * Update a pod
   */
  async update(pod: k8s.V1Pod, options?: ResourceOperationOptions): Promise<k8s.V1Pod> {
    try {
      const namespace = options?.namespace || pod.metadata?.namespace || 'default';
      const name = pod.metadata?.name;
      if (!name) {
        throw new Error('Pod name is required for update');
      }
      const response = await this.client.core.replaceNamespacedPod({
        name,
        namespace,
        body: pod,
      });
      this.logger?.info(`Updated pod '${name}' in namespace '${namespace}'`);
      return response;
    } catch (error) {
      this.handleApiError(error, 'Update', pod.metadata?.name);
    }
  }

  /**
   * Patch a pod
   */
  async patch(name: string, patch: any, options?: ResourceOperationOptions): Promise<k8s.V1Pod> {
    try {
      const namespace = options?.namespace || 'default';
      const response = await this.client.core.patchNamespacedPod({
        name,
        namespace,
        body: patch,
      });
      this.logger?.info(`Patched pod '${name}' in namespace '${namespace}'`);
      return response;
    } catch (error) {
      this.handleApiError(error, 'Patch', name);
    }
  }

  /**
   * Delete a pod
   */
  async delete(name: string, options?: ResourceOperationOptions): Promise<void> {
    try {
      const namespace = options?.namespace || 'default';
      const deleteOptions = this.buildDeleteOptions(options);
      await this.client.core.deleteNamespacedPod({
        name,
        namespace,
        body: deleteOptions,
      });
      this.logger?.info(`Deleted pod '${name}' from namespace '${namespace}'`);
    } catch (error) {
      this.handleApiError(error, 'Delete', name);
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
        insecureSkipTLSVerifyBackend: false,
        limitBytes: undefined,
        previous: options?.previous,
        pretty: undefined,
        sinceSeconds: undefined,
        tailLines: options?.tailLines,
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
    let intervalId: NodeJS.Timeout | null = null;

    const startStream = async () => {
      try {
        // Use periodic polling instead of streaming for simplicity
        let lastResourceVersion: string | undefined;

        const pollLogs = async () => {
          if (aborted) return;

          try {
            const logs = await this.getLogs(name, {
              ...options,
              namespace,
              follow: false,
              tailLines: options?.tailLines || 100,
            });

            if (logs && logs !== lastResourceVersion) {
              onData(logs);
              lastResourceVersion = logs;
            }
          } catch (error) {
            if (!aborted) {
              this.logger?.error(`Failed to poll logs for pod '${name}': ${error}`);
            }
          }
        };

        // Initial poll
        await pollLogs();

        // Set up periodic polling
        if (options?.follow) {
          intervalId = setInterval(pollLogs, 2000); // Poll every 2 seconds
        }
      } catch (error) {
        this.logger?.error(`Failed to start log stream for pod '${name}': ${error}`);
        throw error;
      }
    };

    // Start the stream
    startStream();

    // Return cleanup function
    return () => {
      aborted = true;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }

  /**
   * Execute command in a pod
   */
  async exec(
    name: string,
    command: string[],
    options?: PodOperationOptions & { stdin?: string },
  ): Promise<{ stdout: string; stderr: string }> {
    const namespace = options?.namespace || 'default';
    const exec = new k8s.Exec(this.client.kubeConfig);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const stdoutStream = new (require('stream').Writable)({
        write(chunk: any, _encoding: any, callback: any) {
          stdout += chunk.toString();
          callback();
        },
      });

      const stderrStream = new (require('stream').Writable)({
        write(chunk: any, _encoding: any, callback: any) {
          stderr += chunk.toString();
          callback();
        },
      });

      const stdinStream = options?.stdin
        ? new (require('stream').Readable)({
            read() {
              this.push(options.stdin);
              this.push(null);
            },
          })
        : null;

      exec
        .exec(
          namespace,
          name,
          options?.container || '',
          command,
          stdoutStream,
          stderrStream,
          stdinStream,
          false,
          (status: k8s.V1Status) => {
            if (status.status === 'Success') {
              resolve({ stdout, stderr });
            } else {
              reject(new Error(`Exec failed: ${status.message}`));
            }
          },
        )
        .catch(reject);
    });
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
}

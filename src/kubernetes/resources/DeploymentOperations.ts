import * as k8s from '@kubernetes/client-node';
import {
  BaseResourceOperations,
  ResourceOperationOptions,
  WatchCallback,
  WatchEventType,
} from '../BaseResourceOperations.js';
import { KubernetesClient } from '../KubernetesClient.js';

/**
 * Deployment-specific operation options
 */
export interface DeploymentOperationOptions extends ResourceOperationOptions {
  /**
   * Number of seconds to wait for deployment to be ready
   */
  timeoutSeconds?: number;
}

/**
 * Deployment operations implementation - Read-only operations
 */
export class DeploymentOperations extends BaseResourceOperations<k8s.V1Deployment> {
  constructor(client: KubernetesClient) {
    super(client, 'Deployment');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async create(
    _deployment: k8s.V1Deployment,
    _options?: ResourceOperationOptions,
  ): Promise<k8s.V1Deployment> {
    throw new Error('Create operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async update(
    _deployment: k8s.V1Deployment,
    _options?: ResourceOperationOptions,
  ): Promise<k8s.V1Deployment> {
    throw new Error('Update operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async patch(
    _name: string,
    _patch: any,
    _options?: ResourceOperationOptions,
  ): Promise<k8s.V1Deployment> {
    throw new Error('Patch operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async delete(_name: string, _options?: ResourceOperationOptions): Promise<void> {
    throw new Error('Delete operation is not supported in read-only mode');
  }

  /**
   * Get a deployment by name
   */
  async get(name: string, options?: ResourceOperationOptions): Promise<k8s.V1Deployment> {
    try {
      const namespace = options?.namespace || 'default';
      const response = await this.client.apps.readNamespacedDeployment({
        name,
        namespace,
      });
      return response;
    } catch (error) {
      this.handleApiError(error, 'Get', name);
    }
  }

  /**
   * List deployments
   */
  async list(options?: ResourceOperationOptions): Promise<k8s.V1DeploymentList> {
    try {
      const namespace = options?.namespace;
      const listOptions = this.buildListOptions(options);

      let response;
      if (namespace) {
        response = await this.client.apps.listNamespacedDeployment({
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
        response = await this.client.apps.listDeploymentForAllNamespaces({
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
   * Watch deployments for changes
   */
  watch(callback: WatchCallback<k8s.V1Deployment>, options?: ResourceOperationOptions): () => void {
    const namespace = options?.namespace;
    const watch = new k8s.Watch(this.client.kubeConfig);
    let aborted = false;

    const startWatch = async () => {
      try {
        const req = await watch.watch(
          `/apis/apps/v1/${namespace ? `namespaces/${namespace}/` : ''}deployments`,
          this.buildListOptions(options),
          (type: string, obj: k8s.V1Deployment) => {
            if (!aborted) {
              callback({
                type: type as WatchEventType,
                object: obj,
              });
            }
          },
          (err: any) => {
            if (!aborted) {
              this.logger?.error(`Watch error for deployments: ${err}`);
              callback({
                type: WatchEventType.ERROR,
                object: err,
              });
            }
          },
        );

        return req;
      } catch (error) {
        this.logger?.error(`Failed to start watch for deployments: ${error}`);
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
   * Get deployment status
   */
  async getStatus(
    name: string,
    options?: ResourceOperationOptions,
  ): Promise<k8s.V1DeploymentStatus | undefined> {
    try {
      const namespace = options?.namespace || 'default';
      const response = await this.client.apps.readNamespacedDeploymentStatus({
        name,
        namespace,
      });
      return response.status;
    } catch (error) {
      this.handleApiError(error, 'GetStatus', name);
    }
  }

  /**
   * Wait for deployment to be ready
   */
  async waitForReady(name: string, options?: DeploymentOperationOptions): Promise<boolean> {
    const timeoutSeconds = options?.timeoutSeconds || 300;
    const startTime = Date.now();
    const timeoutTime = startTime + timeoutSeconds * 1000;

    while (Date.now() < timeoutTime) {
      try {
        const namespace = options?.namespace || 'default';
        const response = await this.client.apps.readNamespacedDeploymentStatus({
          name,
          namespace,
        });
        const status = response.status;

        if (
          status?.availableReplicas === status?.replicas &&
          status?.updatedReplicas === status?.replicas &&
          status?.readyReplicas === status?.replicas
        ) {
          return true;
        }

        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds before checking again
      } catch (error) {
        this.logger?.error(`Error waiting for deployment '${name}' to be ready: ${error}`);
        throw error;
      }
    }

    return false;
  }

  /**
   * Get a deployment with MCP tool-friendly formatting
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
      const deployment = await this.get(name, options);

      return {
        resourceType: 'deployment',
        metadata: this.formatResourceMetadata(deployment),
        spec: {
          replicas: deployment.spec?.replicas,
          selector: deployment.spec?.selector,
          template: deployment.spec?.template,
          strategy: deployment.spec?.strategy,
          minReadySeconds: deployment.spec?.minReadySeconds,
          revisionHistoryLimit: deployment.spec?.revisionHistoryLimit,
          progressDeadlineSeconds: deployment.spec?.progressDeadlineSeconds,
        },
        status: {
          ...this.formatResourceStatus(deployment),
          replicas: deployment.status?.replicas,
          updatedReplicas: deployment.status?.updatedReplicas,
          readyReplicas: deployment.status?.readyReplicas,
          availableReplicas: deployment.status?.availableReplicas,
          unavailableReplicas: deployment.status?.unavailableReplicas,
          observedGeneration: deployment.status?.observedGeneration,
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

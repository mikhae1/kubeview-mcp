import { V1Deployment, V1DeploymentList, V1DeploymentStatus, Watch } from '@kubernetes/client-node';
import {
  BaseResourceOperations,
  ResourceOperationOptions,
  WatchCallback,
  WatchEventType,
} from '../ResourceOperations';
import { KubernetesClient } from '../KubernetesClient';

/**
 * Deployment-specific operation options
 */
export interface DeploymentOperationOptions extends ResourceOperationOptions {
  /**
   * Number of replicas to scale to
   */
  replicas?: number;

  /**
   * Strategy for rolling updates
   */
  strategy?: 'RollingUpdate' | 'Recreate';

  /**
   * Maximum number of pods that can be unavailable during update
   */
  maxUnavailable?: number | string;

  /**
   * Maximum number of pods that can be created above the desired replica count
   */
  maxSurge?: number | string;
}

/**
 * Deployment operations implementation
 */
export class DeploymentOperations extends BaseResourceOperations<V1Deployment> {
  constructor(client: KubernetesClient) {
    super(client, 'Deployment');
  }

  /**
   * Create a new deployment
   */
  async create(
    deployment: V1Deployment,
    options?: ResourceOperationOptions,
  ): Promise<V1Deployment> {
    try {
      const namespace = options?.namespace || deployment.metadata?.namespace || 'default';
      const response = await this.client.apps.createNamespacedDeployment({
        namespace,
        body: deployment,
      });
      this.logger?.info(
        `Created deployment '${deployment.metadata?.name}' in namespace '${namespace}'`,
      );
      return response;
    } catch (error) {
      this.handleApiError(error, 'Create', deployment.metadata?.name);
    }
  }

  /**
   * Get a deployment by name
   */
  async get(name: string, options?: ResourceOperationOptions): Promise<V1Deployment> {
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
   * Update a deployment
   */
  async update(
    deployment: V1Deployment,
    options?: ResourceOperationOptions,
  ): Promise<V1Deployment> {
    try {
      const namespace = options?.namespace || deployment.metadata?.namespace || 'default';
      const name = deployment.metadata?.name;
      if (!name) {
        throw new Error('Deployment name is required for update');
      }
      const response = await this.client.apps.replaceNamespacedDeployment({
        name,
        namespace,
        body: deployment,
      });
      this.logger?.info(`Updated deployment '${name}' in namespace '${namespace}'`);
      return response;
    } catch (error) {
      this.handleApiError(error, 'Update', deployment.metadata?.name);
    }
  }

  /**
   * Patch a deployment
   */
  async patch(name: string, patch: any, options?: ResourceOperationOptions): Promise<V1Deployment> {
    try {
      const namespace = options?.namespace || 'default';
      const response = await this.client.apps.patchNamespacedDeployment({
        name,
        namespace,
        body: patch,
      });
      this.logger?.info(`Patched deployment '${name}' in namespace '${namespace}'`);
      return response;
    } catch (error) {
      this.handleApiError(error, 'Patch', name);
    }
  }

  /**
   * Delete a deployment
   */
  async delete(name: string, options?: ResourceOperationOptions): Promise<void> {
    try {
      const namespace = options?.namespace || 'default';
      const deleteOptions = this.buildDeleteOptions(options);
      await this.client.apps.deleteNamespacedDeployment({
        name,
        namespace,
        body: deleteOptions,
      });
      this.logger?.info(`Deleted deployment '${name}' from namespace '${namespace}'`);
    } catch (error) {
      this.handleApiError(error, 'Delete', name);
    }
  }

  /**
   * List deployments
   */
  async list(options?: ResourceOperationOptions): Promise<V1DeploymentList> {
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
  watch(callback: WatchCallback<V1Deployment>, options?: ResourceOperationOptions): () => void {
    const namespace = options?.namespace;
    const watch = new Watch(this.client.kubeConfig);
    let aborted = false;

    const startWatch = async () => {
      try {
        const req = await watch.watch(
          `/apis/apps/v1/${namespace ? `namespaces/${namespace}/` : ''}deployments`,
          this.buildListOptions(options),
          (type: string, obj: V1Deployment) => {
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
   * Scale a deployment
   */
  async scale(
    name: string,
    replicas: number,
    options?: ResourceOperationOptions,
  ): Promise<V1Deployment> {
    try {
      const namespace = options?.namespace || 'default';
      const scalePatch = {
        spec: {
          replicas: replicas,
        },
      };

      const response = await this.patch(name, scalePatch, options);
      this.logger?.info(
        `Scaled deployment '${name}' to ${replicas} replicas in namespace '${namespace}'`,
      );
      return response;
    } catch (error) {
      this.handleApiError(error, 'Scale', name);
    }
  }

  /**
   * Restart a deployment by updating its template annotations
   */
  async restart(name: string, options?: ResourceOperationOptions): Promise<V1Deployment> {
    try {
      const namespace = options?.namespace || 'default';
      const restartPatch = {
        spec: {
          template: {
            metadata: {
              annotations: {
                'kubectl.kubernetes.io/restartedAt': new Date().toISOString(),
              },
            },
          },
        },
      };

      const response = await this.patch(name, restartPatch, options);
      this.logger?.info(`Restarted deployment '${name}' in namespace '${namespace}'`);
      return response;
    } catch (error) {
      this.handleApiError(error, 'Restart', name);
    }
  }

  /**
   * Get deployment status
   */
  async getStatus(
    name: string,
    options?: ResourceOperationOptions,
  ): Promise<V1DeploymentStatus | undefined> {
    try {
      const deployment = await this.get(name, options);
      return deployment.status;
    } catch (error) {
      this.handleApiError(error, 'GetStatus', name);
    }
  }

  /**
   * Update deployment image
   */
  async updateImage(
    name: string,
    containerName: string,
    newImage: string,
    options?: ResourceOperationOptions,
  ): Promise<V1Deployment> {
    try {
      const deployment = await this.get(name, options);

      if (!deployment.spec?.template?.spec?.containers) {
        throw new Error(`No containers found in deployment '${name}'`);
      }

      const container = deployment.spec.template.spec.containers.find(
        (c) => c.name === containerName,
      );
      if (!container) {
        throw new Error(`Container '${containerName}' not found in deployment '${name}'`);
      }

      container.image = newImage;

      const response = await this.update(deployment, options);
      this.logger?.info(
        `Updated image for container '${containerName}' in deployment '${name}' to '${newImage}'`,
      );
      return response;
    } catch (error) {
      this.handleApiError(error, 'UpdateImage', name);
    }
  }

  /**
   * Rollback deployment to previous version
   */
  async rollback(
    name: string,
    options?: ResourceOperationOptions & { revision?: number },
  ): Promise<V1Deployment> {
    try {
      // Get the deployment's ReplicaSets to find previous versions
      const replicaSets = await this.client.apps.listNamespacedReplicaSet({
        namespace: options?.namespace || 'default',
        labelSelector: `app=${name}`,
      });

      if (!replicaSets.items || replicaSets.items.length < 2) {
        throw new Error(`No previous versions found for deployment '${name}'`);
      }

      // Sort by creation timestamp to find the previous version
      const sortedRS = replicaSets.items.sort((a, b) => {
        const timeA = new Date(a.metadata?.creationTimestamp || 0).getTime();
        const timeB = new Date(b.metadata?.creationTimestamp || 0).getTime();
        return timeB - timeA;
      });

      // Get the previous ReplicaSet's pod template
      const previousRS = sortedRS[1];
      const deployment = await this.get(name, options);

      if (previousRS.spec?.template) {
        deployment.spec!.template = previousRS.spec.template;
      }

      const response = await this.update(deployment, options);
      this.logger?.info(
        `Rolled back deployment '${name}' in namespace '${options?.namespace || 'default'}'`,
      );
      return response;
    } catch (error) {
      this.handleApiError(error, 'Rollback', name);
    }
  }

  /**
   * Wait for deployment to be ready
   */
  async waitForReady(
    name: string,
    options?: ResourceOperationOptions & { timeoutSeconds?: number },
  ): Promise<boolean> {
    const namespace = options?.namespace || 'default';
    const timeout = (options?.timeoutSeconds || 300) * 1000; // Convert to milliseconds
    const startTime = Date.now();
    const pollInterval = 2000; // 2 seconds

    while (Date.now() - startTime < timeout) {
      try {
        const deployment = await this.get(name, options);
        const status = deployment.status;

        if (
          status?.readyReplicas === deployment.spec?.replicas &&
          status?.updatedReplicas === deployment.spec?.replicas &&
          status?.availableReplicas === deployment.spec?.replicas
        ) {
          this.logger?.info(`Deployment '${name}' is ready in namespace '${namespace}'`);
          return true;
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } catch (error) {
        // Continue polling if there's an error
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
    }

    this.logger?.warn(
      `Timeout waiting for deployment '${name}' to be ready in namespace '${namespace}'`,
    );
    return false;
  }
}

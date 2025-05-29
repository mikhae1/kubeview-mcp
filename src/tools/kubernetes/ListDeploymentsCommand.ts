import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  BaseCommand,
  CommonSchemas,
  formatResourceMetadata,
  formatResourceStatus,
} from './BaseCommand.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

/**
 * List deployments in a Kubernetes cluster
 */
export class ListDeploymentsCommand implements BaseCommand {
  tool: Tool = {
    name: 'list_deployments',
    description: 'List deployments in the Kubernetes cluster',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: CommonSchemas.namespace,
        labelSelector: CommonSchemas.labelSelector,
        fieldSelector: CommonSchemas.fieldSelector,
      },
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    try {
      const { namespace, labelSelector, fieldSelector } = params || {};

      let result;
      if (namespace) {
        // List deployments in specific namespace
        result = await client.apps.listNamespacedDeployment({
          namespace,
          labelSelector,
          fieldSelector,
        });
      } else {
        // List deployments in all namespaces
        result = await client.apps.listDeploymentForAllNamespaces({
          labelSelector,
          fieldSelector,
        });
      }

      const deployments = result.items.map((deployment: any) => ({
        metadata: formatResourceMetadata(deployment),
        spec: {
          replicas: deployment.spec?.replicas,
          selector: deployment.spec?.selector,
          template: {
            metadata: {
              labels: deployment.spec?.template?.metadata?.labels || {},
            },
            spec: {
              containers:
                deployment.spec?.template?.spec?.containers?.map((c: any) => ({
                  name: c.name,
                  image: c.image,
                  ports: c.ports || [],
                  resources: c.resources || {},
                })) || [],
            },
          },
          strategy: deployment.spec?.strategy,
          revisionHistoryLimit: deployment.spec?.revisionHistoryLimit,
          progressDeadlineSeconds: deployment.spec?.progressDeadlineSeconds,
        },
        status: {
          ...formatResourceStatus(deployment),
          replicas: deployment.status?.replicas,
          updatedReplicas: deployment.status?.updatedReplicas,
          readyReplicas: deployment.status?.readyReplicas,
          availableReplicas: deployment.status?.availableReplicas,
          unavailableReplicas: deployment.status?.unavailableReplicas,
          observedGeneration: deployment.status?.observedGeneration,
        },
      }));

      return {
        total: deployments.length,
        namespace: namespace || 'all',
        deployments,
      };
    } catch (error: any) {
      const errorMessage = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list deployments: ${errorMessage}`);
    }
  }
}

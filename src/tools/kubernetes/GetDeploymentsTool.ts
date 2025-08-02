import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { DeploymentOperations } from '../../kubernetes/resources/DeploymentOperations.js';

/**
 * List deployments in a Kubernetes cluster
 */
export class GetDeploymentsTool implements BaseTool {
  tool: Tool = {
    name: 'get_deployments',
    description:
      'List all Deployment resources in the current Kubernetes cluster (similar to `kubectl get deployments`)',
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
    const deploymentOperations = new DeploymentOperations(client);
    try {
      const deployments = await deploymentOperations.list(params);
      return deployments;
    } catch (error: any) {
      throw new Error(`Failed to get deployments: ${error.message}`);
    }
  }
}

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { PodOperations } from '../../kubernetes/resources/PodOperations.js';

/**
 * List pods in a Kubernetes cluster
 */
export class GetPodsTool implements BaseTool {
  tool: Tool = {
    name: 'get_pods',
    description:
      'List Pod resources in the current Kubernetes cluster (similar to `kubectl get pods`)',
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
      const podOperations = new PodOperations(client);

      return await podOperations.listFormatted({
        namespace,
        labelSelector,
        fieldSelector,
      });
    } catch (error: any) {
      const errorMessage = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list pods: ${errorMessage}`);
    }
  }
}

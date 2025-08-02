import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { ServiceOperations } from '../../kubernetes/resources/ServiceOperations.js';

/**
 * List services in a Kubernetes cluster
 */
export class GetServicesTool implements BaseTool {
  tool: Tool = {
    name: 'get_services',
    description:
      'List Service resources in the current Kubernetes cluster (similar to `kubectl get svc`)',
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
      const serviceOperations = new ServiceOperations(client);

      return await serviceOperations.listFormatted({
        namespace,
        labelSelector,
        fieldSelector,
      });
    } catch (error: any) {
      const errorMessage = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list services: ${errorMessage}`);
    }
  }
}

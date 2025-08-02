import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { IngressOperations } from '../../kubernetes/resources/IngressOperations.js';

/**
 * List ingresses in a Kubernetes cluster
 */
export class GetIngressTool implements BaseTool {
  tool: Tool = {
    name: 'get_ingresses',
    description:
      'List Ingress resources in the current Kubernetes cluster (similar to `kubectl get ingress`)',
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
      const ingressOperations = new IngressOperations(client);

      return await ingressOperations.listFormatted({
        namespace,
        labelSelector,
        fieldSelector,
      });
    } catch (error: any) {
      const errorMessage = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list ingresses: ${errorMessage}`);
    }
  }
}

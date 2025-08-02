import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, formatResourceMetadata, formatResourceStatus } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

/**
 * List namespaces in a Kubernetes cluster
 */
export class GetNamespacesTool implements BaseTool {
  tool: Tool = {
    name: 'get_namespaces',
    description:
      'List all Namespace resources in the current Kubernetes cluster (similar to `kubectl get namespaces`)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };

  async execute(_params: any, client: KubernetesClient): Promise<any> {
    try {
      const result = await client.resources.namespace.list();
      const namespaces = result.items.map((ns: any) => ({
        metadata: formatResourceMetadata(ns),
        status: formatResourceStatus(ns),
      }));
      return {
        total: namespaces.length,
        namespaces,
        cluster: client.getCurrentCluster ? client.getCurrentCluster() : undefined,
      };
    } catch (error: any) {
      const errorMessage = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list namespaces: ${errorMessage}`);
    }
  }
}

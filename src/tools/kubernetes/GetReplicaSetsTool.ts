import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas, formatResourceMetadata } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

export class GetReplicaSetsTool implements BaseTool {
  tool: Tool = {
    name: 'get_replicasets',
    description: 'List ReplicaSet resources with status and rollout health',
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
    const { namespace, labelSelector, fieldSelector } = params || {};
    try {
      const res = await client.apps.listNamespacedReplicaSet({
        namespace: namespace || 'default',
        fieldSelector,
        labelSelector,
      });
      const items = res.items || [];
      return items.map((rs: any) => {
        const m = formatResourceMetadata(rs as any);
        const specReplicas = rs.spec?.replicas ?? 0;
        const readyReplicas = rs.status?.readyReplicas ?? 0;
        const availableReplicas = rs.status?.availableReplicas ?? 0;
        const fullyAvailable = specReplicas > 0 ? availableReplicas === specReplicas : true;
        return {
          ...m,
          selector: rs.spec?.selector,
          replicas: specReplicas,
          readyReplicas,
          availableReplicas,
          observedGeneration: rs.status?.observedGeneration,
          conditions: rs.status?.conditions ?? [],
          rolloutHealthy: fullyAvailable,
          ownerReferences: rs.metadata?.ownerReferences || [],
        };
      });
    } catch (error: any) {
      const message = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list replicasets: ${message}`);
    }
  }
}

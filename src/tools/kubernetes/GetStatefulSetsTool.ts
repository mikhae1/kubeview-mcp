import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas, formatResourceMetadata } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

export class GetStatefulSetsTool implements BaseTool {
  tool: Tool = {
    name: 'get_statefulsets',
    description: 'List StatefulSet resources with status and rollout health',
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
      const res = await client.apps.listNamespacedStatefulSet({
        namespace: namespace || 'default',
        fieldSelector,
        labelSelector,
      });
      const items = res.items || [];
      return items.map((ss: any) => {
        const m = formatResourceMetadata(ss as any);
        const specReplicas = ss.spec?.replicas ?? 0;
        const readyReplicas = ss.status?.readyReplicas ?? 0;
        const updatedReplicas = ss.status?.updatedReplicas ?? 0;
        const currentReplicas = ss.status?.currentReplicas ?? 0;
        const fullyUpdated = specReplicas > 0 ? updatedReplicas === specReplicas : true;
        const fullyReady = specReplicas > 0 ? readyReplicas === specReplicas : true;
        return {
          ...m,
          serviceName: ss.spec?.serviceName,
          selector: ss.spec?.selector,
          replicas: specReplicas,
          readyReplicas,
          updatedReplicas,
          currentReplicas,
          collisionCount: ss.status?.collisionCount,
          conditions: ss.status?.conditions ?? [],
          rolloutHealthy: fullyUpdated && fullyReady,
          ownerReferences: ss.metadata?.ownerReferences || [],
        };
      });
    } catch (error: any) {
      const message = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list statefulsets: ${message}`);
    }
  }
}

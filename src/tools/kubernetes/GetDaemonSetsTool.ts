import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas, formatResourceMetadata } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

export class GetDaemonSetsTool implements BaseTool {
  tool: Tool = {
    name: 'get_daemonsets',
    description: 'List DaemonSet resources with status and rollout health',
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
      const res = await client.apps.listNamespacedDaemonSet({
        namespace: namespace || 'default',
        fieldSelector,
        labelSelector,
      });
      const items = res.items || [];
      return items.map((ds: any) => {
        const m = formatResourceMetadata(ds as any);
        const desired = ds.status?.desiredNumberScheduled ?? 0;
        const ready = ds.status?.numberReady ?? 0;
        const updated = ds.status?.updatedNumberScheduled ?? 0;
        const available = ds.status?.numberAvailable ?? 0;
        const rolloutHealthy = desired > 0 ? updated === desired && available === desired : true;
        return {
          ...m,
          selector: ds.spec?.selector,
          desiredNumberScheduled: desired,
          currentNumberScheduled: ds.status?.currentNumberScheduled ?? 0,
          numberReady: ready,
          updatedNumberScheduled: updated,
          numberAvailable: available,
          numberUnavailable: ds.status?.numberUnavailable ?? 0,
          collisionCount: ds.status?.collisionCount,
          conditions: ds.status?.conditions ?? [],
          rolloutHealthy,
          ownerReferences: ds.metadata?.ownerReferences || [],
        };
      });
    } catch (error: any) {
      const message = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list daemonsets: ${message}`);
    }
  }
}

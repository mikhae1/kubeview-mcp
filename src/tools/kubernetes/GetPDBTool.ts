import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas, formatResourceMetadata } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

export class GetPDBTool implements BaseTool {
  tool: Tool = {
    name: 'get_pdb',
    description: 'List PodDisruptionBudgets with status and disruptions allowed',
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
      const res = await client.policy.listNamespacedPodDisruptionBudget({
        namespace: namespace || 'default',
        fieldSelector,
        labelSelector,
      });
      const items = res.items || [];
      return items.map((pdb) => {
        const m = formatResourceMetadata(pdb as any);
        return {
          ...m,
          selector: pdb.spec?.selector,
          minAvailable: pdb.spec?.minAvailable,
          maxUnavailable: pdb.spec?.maxUnavailable,
          currentHealthy: pdb.status?.currentHealthy,
          desiredHealthy: pdb.status?.desiredHealthy,
          disruptionsAllowed: pdb.status?.disruptionsAllowed,
          expectedPods: pdb.status?.expectedPods,
          observedGeneration: pdb.status?.observedGeneration,
          conditions: pdb.status?.conditions ?? [],
        };
      });
    } catch (error: any) {
      const message = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list PDBs: ${message}`);
    }
  }
}

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas, formatResourceMetadata } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

export class GetResourceQuotaTool implements BaseTool {
  tool: Tool = {
    name: 'get_resourcequotas',
    description: 'List ResourceQuotas with current usage and hard limits',
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
      const res = await client.core.listNamespacedResourceQuota({
        namespace: namespace || 'default',
        fieldSelector,
        labelSelector,
      });
      const items = res.items || [];
      return items.map((rq: any) => {
        const m = formatResourceMetadata(rq as any);
        const hard = rq.status?.hard || rq.spec?.hard || {};
        const used = rq.status?.used || {};
        // Compute headroom when units align; otherwise return as strings
        const headroom: Record<string, string> = {};
        for (const key of Object.keys(hard)) {
          const hardVal = (hard as any)[key];
          const usedVal = (used as any)[key];
          if (typeof hardVal === 'string' && typeof usedVal === 'string') {
            headroom[key] = `${hardVal} - ${usedVal}`;
          }
        }
        return {
          ...m,
          hard,
          used,
          scopes: rq.spec?.scopes || [],
          scopeSelector: rq.spec?.scopeSelector,
          headroom,
        };
      });
    } catch (error: any) {
      const message = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list resourcequotas: ${message}`);
    }
  }
}

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas, formatResourceMetadata } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

export class GetLimitRangesTool implements BaseTool {
  tool: Tool = {
    name: 'get_limitranges',
    description: 'List LimitRanges with default requests/limits and max/min values',
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
      const res = await client.core.listNamespacedLimitRange({
        namespace: namespace || 'default',
        fieldSelector,
        labelSelector,
      });
      const items = res.items || [];
      return items.map((lr: any) => {
        const m = formatResourceMetadata(lr as any);
        return {
          ...m,
          limits: lr.spec?.limits || [],
        };
      });
    } catch (error: any) {
      const message = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list limitranges: ${message}`);
    }
  }
}

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas, formatResourceMetadata } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

export class GetEndpointsTool implements BaseTool {
  tool: Tool = {
    name: 'get_endpoints',
    description: 'List Endpoints with ready vs not-ready addresses for Service backends',
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
      const res = await client.core.listNamespacedEndpoints({
        namespace: namespace || 'default',
        fieldSelector,
        labelSelector,
      });
      const items = res.items || [];
      return items.map((ep) => {
        const m = formatResourceMetadata(ep as any);
        const subsets = ep.subsets || [];
        const ready: any[] = [];
        const notReady: any[] = [];
        for (const s of subsets) {
          for (const addr of s.addresses || []) ready.push(addr);
          for (const addr of s.notReadyAddresses || []) notReady.push(addr);
        }
        return {
          ...m,
          subsets: subsets.map((s) => ({
            ports: s.ports || [],
            addresses: s.addresses || [],
            notReadyAddresses: s.notReadyAddresses || [],
          })),
          readyAddresses: ready,
          notReadyAddresses: notReady,
        };
      });
    } catch (error: any) {
      const message = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list endpoints: ${message}`);
    }
  }
}

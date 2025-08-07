import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas, formatResourceMetadata } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

export class GetNodesTool implements BaseTool {
  tool: Tool = {
    name: 'get_nodes',
    description:
      'List Node resources with conditions, capacity/allocatable, taints, and pressure flags',
    inputSchema: {
      type: 'object',
      properties: {
        labelSelector: CommonSchemas.labelSelector,
        fieldSelector: CommonSchemas.fieldSelector,
      },
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    const { labelSelector, fieldSelector } = params || {};
    try {
      const res = await client.core.listNode({
        fieldSelector,
        labelSelector,
      });
      const items = res.items || [];
      return items.map((node: any) => {
        const metadata = formatResourceMetadata(node as any);
        const conditions = node.status?.conditions ?? [];
        const conditionMap: Record<string, string> = {};
        for (const c of conditions) {
          if (c.type && c.status) conditionMap[c.type] = c.status;
        }
        const pressure = {
          memoryPressure: conditionMap['MemoryPressure'] === 'True',
          diskPressure: conditionMap['DiskPressure'] === 'True',
          pidPressure: conditionMap['PIDPressure'] === 'True',
          ready: conditionMap['Ready'] === 'True',
        };
        return {
          ...metadata,
          capacity: node.status?.capacity || {},
          allocatable: node.status?.allocatable || {},
          taints: node.spec?.taints || [],
          conditions: conditions,
          pressure,
          nodeInfo: node.status?.nodeInfo,
        };
      });
    } catch (error: any) {
      const message = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list nodes: ${message}`);
    }
  }
}

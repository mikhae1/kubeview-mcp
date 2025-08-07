import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas, formatResourceMetadata } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

export class GetEndpointSlicesTool implements BaseTool {
  tool: Tool = {
    name: 'get_endpointslices',
    description: 'List EndpointSlices showing ready vs not-ready endpoints and topology',
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
      const res = await client.discovery.listNamespacedEndpointSlice({
        namespace: namespace || 'default',
        fieldSelector,
        labelSelector,
      });
      const items = res.items || [];
      return items.map((es) => {
        const m = formatResourceMetadata(es as any);
        const ready = [] as any[];
        const notReady = [] as any[];
        for (const ep of es.endpoints || []) {
          const info: any = {
            addresses: ep.addresses || [],
            conditions: ep.conditions,
            nodeName: ep.nodeName,
            zone: ep.zone,
            targetRef: ep.targetRef,
          };
          if (ep.conditions?.ready === true) ready.push(info);
          else notReady.push(info);
        }
        return {
          ...m,
          addressType: es.addressType,
          ports: es.ports || [],
          endpoints: es.endpoints || [],
          readyEndpoints: ready,
          notReadyEndpoints: notReady,
        };
      });
    } catch (error: any) {
      const message = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list endpointslices: ${message}`);
    }
  }
}

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas, formatResourceMetadata } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

export class GetHPATool implements BaseTool {
  tool: Tool = {
    name: 'get_hpa',
    description:
      'List HorizontalPodAutoscalers with targets, current/desired replicas, and metrics',
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
      const res = await client.autoscaling.listNamespacedHorizontalPodAutoscaler({
        namespace: namespace || 'default',
        fieldSelector,
        labelSelector,
      });
      const items = res.items || [];
      return items.map((hpa) => {
        const m = formatResourceMetadata(hpa as any);
        return {
          ...m,
          scaleTargetRef: hpa.spec?.scaleTargetRef,
          minReplicas: hpa.spec?.minReplicas,
          maxReplicas: hpa.spec?.maxReplicas,
          desiredReplicas: hpa.status?.desiredReplicas,
          currentReplicas: hpa.status?.currentReplicas,
          currentMetrics: hpa.status?.currentMetrics,
          conditions: hpa.status?.conditions ?? [],
          metrics: hpa.spec?.metrics ?? [],
        };
      });
    } catch (error: any) {
      const message = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list HPA: ${message}`);
    }
  }
}

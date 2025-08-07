import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas, formatResourceMetadata } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

export class GetCronJobsTool implements BaseTool {
  tool: Tool = {
    name: 'get_cronjobs',
    description: 'List CronJob resources with status, last run, schedule, and failures',
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
      const res = await client.batch.listNamespacedCronJob({
        namespace: namespace || 'default',
        fieldSelector,
        labelSelector,
      });
      const items = res.items || [];
      return items.map((cj: any) => {
        const m = formatResourceMetadata(cj as any);
        return {
          ...m,
          schedule: cj.spec?.schedule,
          suspend: cj.spec?.suspend ?? false,
          concurrencyPolicy: cj.spec?.concurrencyPolicy,
          successfulJobsHistoryLimit: cj.spec?.successfulJobsHistoryLimit,
          failedJobsHistoryLimit: cj.spec?.failedJobsHistoryLimit,
          lastScheduleTime: cj.status?.lastScheduleTime,
          lastSuccessfulTime: cj.status?.lastSuccessfulTime,
          active: cj.status?.active?.map((r: any) => r.name) ?? [],
        };
      });
    } catch (error: any) {
      const message = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list cronjobs: ${message}`);
    }
  }
}

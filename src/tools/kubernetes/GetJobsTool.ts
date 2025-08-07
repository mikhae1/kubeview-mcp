import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas, formatResourceMetadata } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

export class GetJobsTool implements BaseTool {
  tool: Tool = {
    name: 'get_jobs',
    description: 'List Job resources with status, last run, failures, backoff reasons',
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
      const res = await client.batch.listNamespacedJob({
        namespace: namespace || 'default',
        fieldSelector,
        labelSelector,
      });
      const items = res.items || [];
      return items.map((job: any) => {
        const m = formatResourceMetadata(job as any);
        const conditions = job.status?.conditions ?? [];
        const failed = job.status?.failed ?? 0;
        const succeeded = job.status?.succeeded ?? 0;
        const active = job.status?.active ?? 0;
        const lastCondition = conditions[conditions.length - 1];
        return {
          ...m,
          parallelism: job.spec?.parallelism,
          completions: job.spec?.completions,
          backoffLimit: job.spec?.backoffLimit,
          active,
          succeeded,
          failed,
          startTime: job.status?.startTime,
          completionTime: job.status?.completionTime,
          lastCondition,
          conditions,
        };
      });
    } catch (error: any) {
      const message = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list jobs: ${message}`);
    }
  }
}

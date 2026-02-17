import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { HelmBaseTool, HelmCommonSchemas, executeHelmCommand } from './BaseTool.js';

/**
 * Get history of a Helm release
 */
export class HelmHistoryTool implements HelmBaseTool {
  tool: Tool = {
    name: 'helm_history',
    description: 'Fetch release history for a given release (similar to `helm history`)',
    inputSchema: {
      type: 'object',
      properties: {
        releaseName: HelmCommonSchemas.releaseName,
        namespace: HelmCommonSchemas.namespace,
        outputFormat: {
          ...HelmCommonSchemas.outputFormat,
          default: 'json',
        },
        maxRevisions: {
          type: 'number',
          description: 'Maximum number of revisions to return (default: 256)',
          optional: true,
        },
      },
      required: ['releaseName'],
    },
  };

  async execute(params: any, _client?: KubernetesClient): Promise<any> {
    try {
      const args = ['history', params.releaseName];

      // Add namespace parameter
      if (params.namespace) {
        args.push('--namespace', params.namespace);
      }

      // Add output format
      const outputFormat = params.outputFormat || 'json';
      args.push('--output', outputFormat);

      // Add max revisions
      if (params.maxRevisions) {
        args.push('--max', params.maxRevisions.toString());
      }

      const result = await executeHelmCommand(args);
      return result;
    } catch (error: any) {
      throw new Error(
        `Failed to get history for Helm release '${params.releaseName}': ${error.message}`,
      );
    }
  }
}

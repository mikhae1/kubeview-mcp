import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { HelmBaseTool, HelmCommonSchemas, executeHelmCommand } from './BaseTool.js';

/**
 * Get status of a Helm release
 */
export class HelmStatusTool implements HelmBaseTool {
  tool: Tool = {
    name: 'helm_status',
    description: 'Display the status of the named release (similar to `helm status`)',
    inputSchema: {
      type: 'object',
      properties: {
        releaseName: HelmCommonSchemas.releaseName,
        namespace: HelmCommonSchemas.namespace,
        revision: HelmCommonSchemas.revision,
        outputFormat: {
          ...HelmCommonSchemas.outputFormat,
          default: 'json',
        },
        showResources: {
          type: 'boolean',
          description: 'Show the resources this release created',
          optional: true,
        },
      },
      required: ['releaseName'],
    },
  };

  async execute(params: any, _client?: KubernetesClient): Promise<any> {
    try {
      const args = ['status', params.releaseName];

      // Add namespace parameter
      if (params.namespace) {
        args.push('--namespace', params.namespace);
      }

      // Add revision parameter
      if (params.revision) {
        args.push('--revision', params.revision.toString());
      }

      // Add output format
      const outputFormat = params.outputFormat || 'json';
      args.push('--output', outputFormat);

      // Add show resources flag
      if (params.showResources) {
        args.push('--show-resources');
      }

      const result = await executeHelmCommand(args);
      return result;
    } catch (error: any) {
      throw new Error(
        `Failed to get status for Helm release '${params.releaseName}': ${error.message}`,
      );
    }
  }
}

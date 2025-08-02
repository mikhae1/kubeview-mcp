import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { HelmBaseTool, HelmCommonSchemas, executeHelmCommand } from './BaseTool.js';

/**
 * Get values for a Helm release
 */
export class HelmGetValuesTool implements HelmBaseTool {
  tool: Tool = {
    name: 'helm_get_values',
    description: 'Get the values file for a named release (similar to `helm get values`)',
    inputSchema: {
      type: 'object',
      properties: {
        releaseName: HelmCommonSchemas.releaseName,
        namespace: HelmCommonSchemas.namespace,
        revision: HelmCommonSchemas.revision,
        outputFormat: {
          ...HelmCommonSchemas.outputFormat,
          default: 'yaml',
        },
        allValues: {
          type: 'boolean',
          description: 'Dump all (computed) values, not just the values provided to the chart',
          optional: true,
        },
      },
      required: ['releaseName'],
    },
  };

  async execute(params: any): Promise<any> {
    try {
      const args = ['get', 'values', params.releaseName];

      // Add namespace parameter
      if (params.namespace) {
        args.push('--namespace', params.namespace);
      }

      // Add revision parameter
      if (params.revision) {
        args.push('--revision', params.revision.toString());
      }

      // Add output format
      const outputFormat = params.outputFormat || 'yaml';
      args.push('--output', outputFormat);

      // Add all values flag
      if (params.allValues) {
        args.push('--all');
      }

      const result = await executeHelmCommand(args);
      return result;
    } catch (error: any) {
      throw new Error(
        `Failed to get values for Helm release '${params.releaseName}': ${error.message}`,
      );
    }
  }
}

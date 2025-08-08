import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { HelmBaseTool, HelmCommonSchemas, executeHelmCommand } from './BaseTool.js';

/**
 * List Helm releases
 */
export class HelmListTool implements HelmBaseTool {
  tool: Tool = {
    name: 'helm_list',
    description: 'List Helm releases in the cluster.',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: HelmCommonSchemas.namespace,
        allNamespaces: {
          type: 'boolean',
          description: 'List releases across all namespaces',
          optional: true,
        },
        outputFormat: {
          ...HelmCommonSchemas.outputFormat,
          default: 'json',
        },
        selector: {
          type: 'string',
          description: 'Selector (label query) to filter on, supports =, ==, and !=',
          optional: true,
        },
        maxReleases: {
          type: 'number',
          description: 'Maximum number of releases to return (default: 256)',
          optional: true,
        },
        deployed: {
          type: 'boolean',
          description: 'Show deployed releases only',
          optional: true,
        },
        failed: {
          type: 'boolean',
          description: 'Show failed releases only',
          optional: true,
        },
        pending: {
          type: 'boolean',
          description: 'Show pending releases only',
          optional: true,
        },
        superseded: {
          type: 'boolean',
          description: 'Show superseded releases only',
          optional: true,
        },
        uninstalled: {
          type: 'boolean',
          description: 'Show uninstalled releases only',
          optional: true,
        },
        uninstalling: {
          type: 'boolean',
          description: 'Show releases that are currently being uninstalled only',
          optional: true,
        },
      },
    },
  };

  async execute(params: any): Promise<any> {
    try {
      const args = ['list'];

      // Add namespace parameter
      if (params.namespace) {
        args.push('--namespace', params.namespace);
      } else if (params.allNamespaces) {
        args.push('--all-namespaces');
      }

      // Add output format
      const outputFormat = params.outputFormat || 'json';
      args.push('--output', outputFormat);

      // Add selector
      if (params.selector) {
        args.push('--selector', params.selector);
      }

      // Add max releases
      if (params.maxReleases) {
        args.push('--max', params.maxReleases.toString());
      }

      // Add status filters
      if (params.deployed) args.push('--deployed');
      if (params.failed) args.push('--failed');
      if (params.pending) args.push('--pending');
      if (params.superseded) args.push('--superseded');
      if (params.uninstalled) args.push('--uninstalled');
      if (params.uninstalling) args.push('--uninstalling');

      const result = await executeHelmCommand(args);
      return result;
    } catch (error: any) {
      throw new Error(`Failed to list Helm releases: ${error.message}`);
    }
  }
}

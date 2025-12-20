import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ArgoBaseTool, ArgoCommonSchemas, executeArgoCommand } from './BaseTool.js';

/**
 * List Argo cron workflows
 */
export class ArgoCronListTool implements ArgoBaseTool {
  tool: Tool = {
    name: 'argo_cron_list',
    description: 'List Argo cron workflows in the cluster (similar to `argo cron list`)',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: ArgoCommonSchemas.namespace,
        allNamespaces: ArgoCommonSchemas.allNamespaces,
        outputFormat: {
          type: 'string',
          description: 'Output format for cron workflows. Supports: wide, name',
          enum: ['wide', 'name'],
          optional: true,
          default: 'wide',
        },
        labelSelector: ArgoCommonSchemas.labelSelector,
        selector: ArgoCommonSchemas.selector,
        maxCronWorkflows: {
          type: 'number',
          description: 'Maximum number of cron workflows to return',
          optional: true,
        },
        showScheduled: {
          type: 'boolean',
          description: 'Show scheduled workflows as well',
          optional: true,
        },
      },
      required: [],
    },
  };

  async execute(params: any): Promise<any> {
    const args = ['cron', 'list'];

    const labelSelector = params?.labelSelector || params?.selector;

    // Add namespace specification
    if (params.allNamespaces) {
      args.push('--all-namespaces');
    } else if (params.namespace) {
      args.push('-n', params.namespace);
    }

    // Add output format
    if (params.outputFormat) {
      args.push('-o', params.outputFormat);
    }

    // Add selector
    if (labelSelector) {
      args.push('-l', labelSelector);
    }

    // Add max cron workflows limit
    if (params.maxCronWorkflows) {
      args.push('--limit', params.maxCronWorkflows.toString());
    }

    // Add show scheduled option
    if (params.showScheduled) {
      args.push('--show-scheduled');
    }

    try {
      const result = await executeArgoCommand(args);
      return result;
    } catch (error) {
      throw new Error(
        `Failed to list Argo cron workflows: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ArgoBaseTool, ArgoCommonSchemas, executeArgoCommand } from './BaseTool.js';

/**
 * List Argo workflows
 */
export class ArgoListTool implements ArgoBaseTool {
  tool: Tool = {
    name: 'argo_list',
    description:
      'List Argo Workflows (similar to `argo list`). Supports filters: namespace/all-namespaces, selector, status (running|succeeded|failed|pending|completed), since, and limits.',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: ArgoCommonSchemas.namespace,
        allNamespaces: ArgoCommonSchemas.allNamespaces,
        outputFormat: {
          type: 'string',
          description: 'Output format for workflows. Supports: wide, name, json, yaml',
          enum: ['wide', 'name', 'json', 'yaml'],
          optional: true,
          default: 'json',
        },
        selector: ArgoCommonSchemas.selector,
        maxWorkflows: {
          type: 'number',
          description: 'Maximum number of workflows to return',
          optional: true,
        },
        running: {
          type: 'boolean',
          description: 'Show running workflows only',
          optional: true,
        },
        succeeded: {
          type: 'boolean',
          description: 'Show succeeded workflows only',
          optional: true,
        },
        failed: {
          type: 'boolean',
          description: 'Show failed workflows only',
          optional: true,
        },
        pending: {
          type: 'boolean',
          description: 'Show pending workflows only',
          optional: true,
        },
        status: {
          type: 'string',
          description: 'Filter by workflow status (Running, Succeeded, Failed, Error, Pending)',
          enum: ['Running', 'Succeeded', 'Failed', 'Error', 'Pending'],
          optional: true,
        },
        completed: {
          type: 'boolean',
          description: 'Show completed workflows only',
          optional: true,
        },
        since: {
          type: 'string',
          description: 'Show workflows newer than this duration (e.g., 1h, 30m)',
          optional: true,
        },
        chunked: {
          type: 'boolean',
          description: 'Return large lists in chunks',
          optional: true,
        },
      },
      required: [],
    },
  };

  async execute(params: any): Promise<any> {
    const args = ['list'];

    // Add namespace specification
    if (params.allNamespaces) {
      args.push('--all-namespaces');
    } else if (params.namespace) {
      args.push('-n', params.namespace);
    }

    // Add output format
    if (params.outputFormat) {
      args.push('-o', params.outputFormat);
    } else {
      args.push('-o', 'json');
    }

    // Add selector
    if (params.selector) {
      args.push('-l', params.selector);
    }

    // Add status filters
    if (params.running) {
      args.push('--running');
    }
    if (params.succeeded) {
      args.push('--succeeded');
    }
    if (params.failed) {
      args.push('--failed');
    }
    if (params.pending) {
      args.push('--pending');
    }
    if (params.completed) {
      args.push('--completed');
    }

    // Add status filter
    if (params.status) {
      args.push('--status', params.status);
    }

    // Add since filter
    if (params.since) {
      args.push('--since', params.since);
    }

    // Add chunked option
    if (params.chunked) {
      args.push('--chunk-size', '500');
    }

    // Add max workflows limit
    if (params.maxWorkflows) {
      args.push('--limit', params.maxWorkflows.toString());
    }

    try {
      const result = await executeArgoCommand(args);
      return result;
    } catch (error) {
      throw new Error(
        `Failed to list Argo workflows: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

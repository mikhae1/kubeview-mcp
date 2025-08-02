import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ArgoBaseTool, ArgoCommonSchemas, executeArgoCommand } from './BaseTool.js';

/**
 * Get logs from Argo workflows
 */
export class ArgoLogsTool implements ArgoBaseTool {
  tool: Tool = {
    name: 'argo_logs',
    description: 'Get logs from Argo workflow pods (similar to `argo logs`)',
    inputSchema: {
      type: 'object',
      properties: {
        workflowName: {
          ...ArgoCommonSchemas.workflowName,
          description: 'Name of the workflow to get logs from',
        },
        namespace: ArgoCommonSchemas.namespace,
        container: {
          type: 'string',
          description: 'Container name to get logs from',
          optional: true,
        },
        follow: {
          type: 'boolean',
          description: 'Follow the logs stream (note: this may timeout in MCP context)',
          optional: true,
        },
        previous: {
          type: 'boolean',
          description: 'Get logs from previous container instance',
          optional: true,
        },
        since: {
          type: 'string',
          description: 'Show logs newer than this duration (e.g., 1h, 30m)',
          optional: true,
        },
        sinceTime: {
          type: 'string',
          description: 'Show logs after this timestamp (RFC3339)',
          optional: true,
        },
        tail: {
          type: 'number',
          description: 'Number of lines to show from the end of the logs',
          optional: true,
        },
        timestamps: {
          type: 'boolean',
          description: 'Include timestamps in the log output',
          optional: true,
        },
        grep: {
          type: 'string',
          description: 'Regular expression to filter log lines',
          optional: true,
        },
        noColor: {
          type: 'boolean',
          description: 'Disable colored output',
          optional: true,
        },
      },
      required: ['workflowName'],
    },
  };

  async execute(params: any): Promise<any> {
    const args = ['logs', params.workflowName];

    // Add namespace
    if (params.namespace) {
      args.push('-n', params.namespace);
    }

    // Add container specification
    if (params.container) {
      args.push('-c', params.container);
    }

    // Add follow option (with warning)
    if (params.follow) {
      args.push('-f');
    }

    // Add previous logs option
    if (params.previous) {
      args.push('--previous');
    }

    // Add since duration
    if (params.since) {
      args.push('--since', params.since);
    }

    // Add since time
    if (params.sinceTime) {
      args.push('--since-time', params.sinceTime);
    }

    // Add tail lines
    if (params.tail) {
      args.push('--tail', params.tail.toString());
    }

    // Add timestamps
    if (params.timestamps) {
      args.push('--timestamps');
    }

    // Add grep filter
    if (params.grep) {
      args.push('--grep', params.grep);
    }

    // Add no color option
    if (params.noColor) {
      args.push('--no-color');
    }

    try {
      const result = await executeArgoCommand(args);
      return result;
    } catch (error) {
      throw new Error(
        `Failed to get Argo workflow logs: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

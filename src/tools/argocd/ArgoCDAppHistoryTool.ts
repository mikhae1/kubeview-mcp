import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ArgoCDBaseTool, ArgoCDCommonSchemas, executeArgoCDCommand } from './BaseTool.js';

/**
 * Get history/revisions of an ArgoCD application
 */
export class ArgoCDAppHistoryTool implements ArgoCDBaseTool {
  tool: Tool = {
    name: 'argocd_app_history',
    description:
      'Get deployment history/revisions of an ArgoCD application (similar to `argocd app history <app-name>`)',
    inputSchema: {
      type: 'object',
      properties: {
        appName: {
          ...ArgoCDCommonSchemas.appName,
          optional: false,
        },
        outputFormat: {
          type: 'string',
          description: 'Output format for application history. Supports: json, yaml, wide, id',
          enum: ['json', 'yaml', 'wide', 'id'],
          optional: true,
          default: 'json',
        },
        revision: {
          type: 'string',
          description: 'Show details for a specific revision',
          optional: true,
        },
        maxHistory: {
          type: 'number',
          description: 'Maximum number of history entries to return',
          optional: true,
        },
        server: ArgoCDCommonSchemas.server,
        grpcWeb: ArgoCDCommonSchemas.grpcWeb,
        plaintext: ArgoCDCommonSchemas.plaintext,
        insecure: ArgoCDCommonSchemas.insecure,
      },
      required: ['appName'],
    },
  };

  async execute(params: any): Promise<any> {
    const args = ['app', 'history', params.appName];

    // Add output format
    if (params.outputFormat) {
      args.push('-o', params.outputFormat);
    } else {
      args.push('-o', 'json');
    }

    // Add specific revision
    if (params.revision) {
      args.push('--revision', params.revision);
    }

    // Add max history limit
    if (params.maxHistory) {
      args.push('--limit', params.maxHistory.toString());
    }

    // Add server configuration
    if (params.server) {
      args.push('--server', params.server);
    }

    if (params.grpcWeb) {
      args.push('--grpc-web');
    }

    if (params.plaintext) {
      args.push('--plaintext');
    }

    if (params.insecure) {
      args.push('--insecure');
    }

    try {
      const result = await executeArgoCDCommand(args);
      return result;
    } catch (error) {
      throw new Error(
        `Failed to get ArgoCD application history for "${params.appName}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

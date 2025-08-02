import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ArgoCDBaseTool, ArgoCDCommonSchemas, executeArgoCDCommand } from './BaseTool.js';

/**
 * Get details of an ArgoCD application
 */
export class ArgoCDAppGetTool implements ArgoCDBaseTool {
  tool: Tool = {
    name: 'argocd_app_get',
    description: 'Get details of an ArgoCD application (similar to `argocd app get <app-name>`)',
    inputSchema: {
      type: 'object',
      properties: {
        appName: {
          ...ArgoCDCommonSchemas.appName,
          optional: false,
        },
        outputFormat: {
          type: 'string',
          description: 'Output format for application details. Supports: json, yaml, wide',
          enum: ['json', 'yaml', 'wide'],
          optional: true,
          default: 'json',
        },
        showOperation: {
          type: 'boolean',
          description: 'Show application operation',
          optional: true,
        },
        showParams: {
          type: 'boolean',
          description: 'Show application parameters and overrides',
          optional: true,
        },
        server: ArgoCDCommonSchemas.server,
        grpcWeb: ArgoCDCommonSchemas.grpcWeb,
        plaintext: ArgoCDCommonSchemas.plaintext,
        insecure: ArgoCDCommonSchemas.insecure,
        refresh: {
          type: 'boolean',
          description: 'Refresh application data when retrieving',
          optional: true,
        },
        hardRefresh: {
          type: 'boolean',
          description: 'Refresh application data and ignore cache',
          optional: true,
        },
      },
      required: ['appName'],
    },
  };

  async execute(params: any): Promise<any> {
    const args = ['app', 'get', params.appName];

    // Add output format
    if (params.outputFormat) {
      args.push('-o', params.outputFormat);
    } else {
      args.push('-o', 'json');
    }

    // Add show operation option
    if (params.showOperation) {
      args.push('--show-operation');
    }

    // Add show params option
    if (params.showParams) {
      args.push('--show-params');
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

    // Add refresh options
    if (params.refresh) {
      args.push('--refresh');
    }

    if (params.hardRefresh) {
      args.push('--hard-refresh');
    }

    try {
      const result = await executeArgoCDCommand(args);
      return result;
    } catch (error) {
      throw new Error(
        `Failed to get ArgoCD application "${params.appName}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

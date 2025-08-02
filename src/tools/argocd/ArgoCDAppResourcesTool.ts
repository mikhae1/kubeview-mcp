import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ArgoCDBaseTool, ArgoCDCommonSchemas, executeArgoCDCommand } from './BaseTool.js';

/**
 * List resources of an ArgoCD application
 */
export class ArgoCDAppResourcesTool implements ArgoCDBaseTool {
  tool: Tool = {
    name: 'argocd_app_resources',
    description:
      'List resources of an ArgoCD application (similar to `argocd app resources <app-name>`)',
    inputSchema: {
      type: 'object',
      properties: {
        appName: {
          ...ArgoCDCommonSchemas.appName,
          optional: false,
        },
        outputFormat: {
          type: 'string',
          description: 'Output format for application resources. Supports: json, yaml, wide, tree',
          enum: ['json', 'yaml', 'wide', 'tree'],
          optional: true,
          default: 'json',
        },
        orphaned: {
          type: 'boolean',
          description: 'Show orphaned resources only',
          optional: true,
        },
        group: {
          type: 'string',
          description: 'Filter by resource group',
          optional: true,
        },
        kind: {
          type: 'string',
          description: 'Filter by resource kind (e.g., Pod, Deployment, Service)',
          optional: true,
        },
        name: {
          type: 'string',
          description: 'Filter by resource name',
          optional: true,
        },
        namespace: {
          type: 'string',
          description: 'Filter by resource namespace',
          optional: true,
        },
        health: {
          type: 'string',
          description: 'Filter by health status',
          enum: ['Healthy', 'Progressing', 'Degraded', 'Suspended', 'Missing', 'Unknown'],
          optional: true,
        },
        syncStatus: {
          type: 'string',
          description: 'Filter by sync status',
          enum: ['Synced', 'OutOfSync', 'Unknown'],
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
    const args = ['app', 'resources', params.appName];

    // Add output format
    if (params.outputFormat) {
      args.push('-o', params.outputFormat);
    } else {
      args.push('-o', 'json');
    }

    // Add orphaned resources filter
    if (params.orphaned) {
      args.push('--orphaned');
    }

    // Add resource filters
    if (params.group) {
      args.push('--group', params.group);
    }

    if (params.kind) {
      args.push('--kind', params.kind);
    }

    if (params.name) {
      args.push('--name', params.name);
    }

    if (params.namespace) {
      args.push('--namespace', params.namespace);
    }

    // Add status filters
    if (params.health) {
      args.push('--health', params.health);
    }

    if (params.syncStatus) {
      args.push('--sync-status', params.syncStatus);
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
        `Failed to get ArgoCD application resources for "${params.appName}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

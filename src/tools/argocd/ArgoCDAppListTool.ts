import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ArgoCDBaseTool, ArgoCDCommonSchemas, executeArgoCDCommand } from './BaseTool.js';

/**
 * List ArgoCD applications
 */
export class ArgoCDAppListTool implements ArgoCDBaseTool {
  tool: Tool = {
    name: 'argocd_app_list',
    description: 'List ArgoCD applications in the cluster (similar to `argocd app list`)',
    inputSchema: {
      type: 'object',
      properties: {
        outputFormat: {
          type: 'string',
          description: 'Output format for applications. Supports: wide, name, json, yaml',
          enum: ['wide', 'name', 'json', 'yaml'],
          optional: true,
          default: 'json',
        },
        selector: ArgoCDCommonSchemas.selector,
        project: {
          type: 'string',
          description: 'Filter by project name',
          optional: true,
        },
        cluster: {
          type: 'string',
          description: 'Filter by cluster name',
          optional: true,
        },
        namespace: {
          type: 'string',
          description: 'Filter by target namespace',
          optional: true,
        },
        repo: {
          type: 'string',
          description: 'Filter by repository URL',
          optional: true,
        },
        health: {
          type: 'string',
          description: 'Filter by health status',
          enum: ['Healthy', 'Progressing', 'Degraded', 'Suspended', 'Missing', 'Unknown'],
          optional: true,
        },
        sync: {
          type: 'string',
          description: 'Filter by sync status',
          enum: ['Synced', 'OutOfSync', 'Unknown'],
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
      },
      required: [],
    },
  };

  async execute(params: any): Promise<any> {
    const args = ['app', 'list'];

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

    // Add project filter
    if (params.project) {
      args.push('--project', params.project);
    }

    // Add cluster filter
    if (params.cluster) {
      args.push('--cluster', params.cluster);
    }

    // Add namespace filter
    if (params.namespace) {
      args.push('--namespace', params.namespace);
    }

    // Add repository filter
    if (params.repo) {
      args.push('--repo', params.repo);
    }

    // Add health status filter
    if (params.health) {
      args.push('--health', params.health);
    }

    // Add sync status filter
    if (params.sync) {
      args.push('--sync', params.sync);
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

    // Add refresh option
    if (params.refresh) {
      args.push('--refresh');
    }

    try {
      const result = await executeArgoCDCommand(args);
      return result;
    } catch (error) {
      throw new Error(
        `Failed to list ArgoCD applications: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ArgoCDBaseTool, ArgoCDCommonSchemas, executeArgoCDCommand } from './BaseTool.js';

/**
 * Get logs of an ArgoCD application
 */
export class ArgoCDAppLogsTool implements ArgoCDBaseTool {
  tool: Tool = {
    name: 'argocd_app_logs',
    description: 'Get logs of an ArgoCD application (similar to `argocd app logs <app-name>`)',
    inputSchema: {
      type: 'object',
      properties: {
        appName: {
          ...ArgoCDCommonSchemas.appName,
          optional: false,
        },
        container: {
          type: 'string',
          description: 'Container name to get logs from',
          optional: true,
        },
        follow: {
          type: 'boolean',
          description: 'Follow log output (stream logs)',
          optional: true,
        },
        group: {
          type: 'string',
          description: 'Resource group',
          optional: true,
        },
        kind: {
          type: 'string',
          description: 'Resource kind (e.g., Pod, Deployment)',
          optional: true,
        },
        name: {
          type: 'string',
          description: 'Resource name',
          optional: true,
        },
        namespace: {
          type: 'string',
          description: 'Resource namespace',
          optional: true,
        },
        previous: {
          type: 'boolean',
          description: 'Get logs from previous instance',
          optional: true,
        },
        since: {
          type: 'string',
          description: 'Show logs since duration (e.g., 1h, 30m, 10s)',
          optional: true,
        },
        sinceTime: {
          type: 'string',
          description: 'Show logs since timestamp (RFC3339)',
          optional: true,
        },
        tail: {
          type: 'number',
          description: 'Number of lines to show from the end of the logs',
          optional: true,
        },
        timestamps: {
          type: 'boolean',
          description: 'Include timestamps in log output',
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
    const args = ['app', 'logs', params.appName];

    // Add container specification
    if (params.container) {
      args.push('--container', params.container);
    }

    // Add follow option
    if (params.follow) {
      args.push('--follow');
    }

    // Add resource specification
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

    // Add previous logs option
    if (params.previous) {
      args.push('--previous');
    }

    // Add time-based filters
    if (params.since) {
      args.push('--since', params.since);
    }

    if (params.sinceTime) {
      args.push('--since-time', params.sinceTime);
    }

    // Add tail option
    if (params.tail) {
      args.push('--tail', params.tail.toString());
    }

    // Add timestamps option
    if (params.timestamps) {
      args.push('--timestamps');
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
        `Failed to get ArgoCD application logs for "${params.appName}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

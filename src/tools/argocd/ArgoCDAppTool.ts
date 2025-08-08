import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ArgoCDBaseTool, ArgoCDCommonSchemas, executeArgoCDCommand } from './BaseTool.js';

/**
 * ArgoCD app tool: list, get, resources, logs, history, status
 */
export class ArgoCDAppTool implements ArgoCDBaseTool {
  tool: Tool = {
    name: 'argocd_app',
    description:
      'Get Argo CD applications data (similar to `argocd app`): list|get|resources|logs|history|status.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['list', 'get', 'resources', 'logs', 'history', 'status'],
        },
        appName: { ...ArgoCDCommonSchemas.appName, optional: true },
        outputFormat: {
          type: 'string',
          enum: ['json', 'yaml', 'wide', 'tree', 'name'],
          optional: true,
          default: 'json',
        },
        // list filters
        selector: ArgoCDCommonSchemas.selector,
        project: { type: 'string', optional: true },
        cluster: { type: 'string', optional: true },
        namespace: { type: 'string', optional: true },
        repo: { type: 'string', optional: true },
        health: {
          type: 'string',
          enum: ['Healthy', 'Progressing', 'Degraded', 'Suspended', 'Missing', 'Unknown'],
          optional: true,
        },
        sync: { type: 'string', enum: ['Synced', 'OutOfSync', 'Unknown'], optional: true },
        // flags
        server: ArgoCDCommonSchemas.server,
        grpcWeb: ArgoCDCommonSchemas.grpcWeb,
        plaintext: ArgoCDCommonSchemas.plaintext,
        insecure: ArgoCDCommonSchemas.insecure,
        refresh: { type: 'boolean', optional: true },
        hardRefresh: { type: 'boolean', optional: true },
        // resources filters
        group: { type: 'string', optional: true },
        kind: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        // logs options
        container: { type: 'string', optional: true },
        follow: { type: 'boolean', optional: true },
        previous: { type: 'boolean', optional: true },
        since: { type: 'string', optional: true },
        sinceTime: { type: 'string', optional: true },
        tail: { type: 'number', optional: true },
        timestamps: { type: 'boolean', optional: true },
      },
      required: ['operation'],
    },
  };

  async execute(params: any): Promise<any> {
    const {
      operation,
      appName,
      outputFormat,
      selector,
      project,
      cluster,
      namespace,
      repo,
      health,
      sync,
      server,
      grpcWeb,
      plaintext,
      insecure,
      refresh,
      hardRefresh,
      group,
      kind,
      name,
      container,
      follow,
      previous,
      since,
      sinceTime,
      tail,
      timestamps,
    } = params || {};

    const addServerFlags = (args: string[]) => {
      if (server) args.push('--server', server);
      if (grpcWeb) args.push('--grpc-web');
      if (plaintext) args.push('--plaintext');
      if (insecure) args.push('--insecure');
    };

    switch (operation) {
      case 'list': {
        const args = ['app', 'list'];
        args.push('-o', outputFormat || 'json');
        if (selector) args.push('-l', selector);
        if (project) args.push('--project', project);
        if (cluster) args.push('--cluster', cluster);
        if (namespace) args.push('--namespace', namespace);
        if (repo) args.push('--repo', repo);
        if (health) args.push('--health', health);
        if (sync) args.push('--sync', sync);
        addServerFlags(args);
        if (refresh) args.push('--refresh');
        return executeArgoCDCommand(args);
      }
      case 'get': {
        if (!appName) throw new Error('appName is required for operation=get');
        const args = ['app', 'get', appName];
        if (outputFormat) args.push('-o', outputFormat);
        if (refresh) args.push('--refresh');
        if (hardRefresh) args.push('--hard-refresh');
        addServerFlags(args);
        return executeArgoCDCommand(args);
      }
      case 'resources': {
        if (!appName) throw new Error('appName is required for operation=resources');
        const args = ['app', 'resources', appName];
        if (outputFormat) args.push('-o', outputFormat);
        if (group) args.push('--group', group);
        if (kind) args.push('--kind', kind);
        if (name) args.push('--name', name);
        if (namespace) args.push('--namespace', namespace);
        if (health) args.push('--health', health);
        if (sync) args.push('--sync', sync);
        addServerFlags(args);
        return executeArgoCDCommand(args);
      }
      case 'history': {
        if (!appName) throw new Error('appName is required for operation=history');
        const args = ['app', 'history', appName];
        if (outputFormat) args.push('-o', outputFormat);
        addServerFlags(args);
        return executeArgoCDCommand(args);
      }
      case 'status': {
        if (!appName) throw new Error('appName is required for operation=status');
        const args = ['app', 'status', appName];
        if (outputFormat) args.push('-o', outputFormat);
        addServerFlags(args);
        return executeArgoCDCommand(args);
      }
      case 'logs': {
        if (!appName) throw new Error('appName is required for operation=logs');
        const args = ['app', 'logs', appName];
        if (container) args.push('--container', container);
        if (follow) args.push('--follow');
        if (group) args.push('--group', group);
        if (kind) args.push('--kind', kind);
        if (name) args.push('--name', name);
        if (namespace) args.push('--namespace', namespace);
        if (previous) args.push('--previous');
        if (since) args.push('--since', since);
        if (sinceTime) args.push('--since-time', sinceTime);
        if (typeof tail === 'number') args.push('--tail', String(tail));
        if (timestamps) args.push('--timestamps');
        addServerFlags(args);
        return executeArgoCDCommand(args);
      }
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
  }
}

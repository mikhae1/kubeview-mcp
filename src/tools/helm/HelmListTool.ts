import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { HelmReleaseOperations } from '../../kubernetes/resources/HelmReleaseOperations.js';
import {
  HelmBaseTool,
  HelmCommonSchemas,
  executeHelmCommand,
  validateHelmCLI,
} from './BaseTool.js';

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

  async execute(params: any, client?: KubernetesClient): Promise<any> {
    const outputFormat = params.outputFormat || 'json';
    let apiError: Error | undefined;

    if (client && outputFormat === 'json') {
      try {
        await client.refreshCurrentContext();
        const resolvedNamespace =
          params.namespace || (params.allNamespaces ? undefined : client.getCurrentNamespace());
        const helmOps = new HelmReleaseOperations(client);
        return await helmOps.listReleases({
          namespace: resolvedNamespace,
          selector: params.selector,
          statuses: this.buildStatusFilters(params),
          maxReleases: params.maxReleases,
        });
      } catch (error) {
        apiError = error instanceof Error ? error : new Error(String(error));
      }
    }

    try {
      const args = ['list'];

      if (params.namespace) {
        args.push('--namespace', params.namespace);
      } else if (params.allNamespaces) {
        args.push('--all-namespaces');
      }

      args.push('--output', outputFormat);

      if (params.selector) {
        args.push('--selector', params.selector);
      }

      if (params.maxReleases) {
        args.push('--max', params.maxReleases.toString());
      }

      if (params.deployed) args.push('--deployed');
      if (params.failed) args.push('--failed');
      if (params.pending) args.push('--pending');
      if (params.superseded) args.push('--superseded');
      if (params.uninstalled) args.push('--uninstalled');
      if (params.uninstalling) args.push('--uninstalling');

      await validateHelmCLI();
      return await executeHelmCommand(args);
    } catch (error: any) {
      if (apiError) {
        throw new Error(
          `Failed to list Helm releases via Kubernetes API (${apiError.message}) and CLI fallback (${error.message})`,
        );
      }
      throw new Error(`Failed to list Helm releases: ${error.message}`);
    }
  }

  private buildStatusFilters(params: any): string[] {
    const statuses: string[] = [];
    if (params.deployed) statuses.push('deployed');
    if (params.failed) statuses.push('failed');
    if (params.pending) statuses.push('pending');
    if (params.superseded) statuses.push('superseded');
    if (params.uninstalled) statuses.push('uninstalled');
    if (params.uninstalling) statuses.push('uninstalling');
    return statuses;
  }
}

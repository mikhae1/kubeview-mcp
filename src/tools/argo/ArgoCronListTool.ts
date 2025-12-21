import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { toMcpToolResult } from '../../utils/McpToolResult.js';
import {
  ArgoBaseTool,
  ArgoCommonSchemas,
  executeArgoCommand,
  isRecoverableK8sError,
  markTransport,
} from './BaseTool.js';

async function listCronWorkflowsViaK8s(params: any, client: KubernetesClient): Promise<any> {
  await client.refreshCurrentContext();

  const group = 'argoproj.io';
  const version = 'v1alpha1';
  const plural = 'cronworkflows';
  const labelSelector = params?.labelSelector || params?.selector;

  const allNamespaces = Boolean(params?.allNamespaces);
  const namespace = params?.namespace || 'argo';

  const resp = allNamespaces
    ? ((await client.customObjects.listClusterCustomObject({
        group,
        version,
        plural,
        labelSelector,
      })) as any)
    : ((await client.customObjects.listNamespacedCustomObject({
        group,
        version,
        namespace,
        plural,
        labelSelector,
      })) as any);

  const body = (resp?.body ?? resp) as any;
  const items = Array.isArray(body?.items) ? body.items : [];
  let filtered = items;

  if (typeof params?.maxCronWorkflows === 'number' && Number.isFinite(params.maxCronWorkflows)) {
    filtered = filtered.slice(0, Math.max(0, params.maxCronWorkflows));
  }

  return { ...body, items: filtered };
}

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

  async execute(params: any, client?: KubernetesClient): Promise<any> {
    // Try Kubernetes API first if client is available
    const outputFormat = params?.outputFormat || 'wide';
    if ((outputFormat === 'wide' || outputFormat === 'name') && client) {
      try {
        const result = await listCronWorkflowsViaK8s(params, client);
        return toMcpToolResult(markTransport(result, 'k8s'));
      } catch (error: any) {
        if (!isRecoverableK8sError(error)) {
          // Non-recoverable error, fallback to CLI
        }
        // Recoverable error (404, 403, etc.), fallback to CLI
      }
    }

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
      return toMcpToolResult(markTransport(result, 'cli'));
    } catch (error) {
      throw new Error(
        `Failed to list Argo cron workflows: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

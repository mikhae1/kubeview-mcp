import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { toMcpToolResult } from '../../utils/McpToolResult.js';
import {
  ArgoBaseTool,
  ArgoCommonSchemas,
  executeArgoCommand,
  validateArgoCLI,
  isRecoverableK8sError,
  markTransport,
} from './BaseTool.js';

function parseDurationToMs(input: string): number | null {
  const m = String(input)
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)(ms|s|m|h|d)$/i);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(value)) return null;
  switch (unit) {
    case 'ms':
      return value;
    case 's':
      return value * 1000;
    case 'm':
      return value * 60_000;
    case 'h':
      return value * 3_600_000;
    case 'd':
      return value * 86_400_000;
    default:
      return null;
  }
}

async function listWorkflowsViaK8s(params: any, client: KubernetesClient): Promise<any> {
  await client.refreshCurrentContext();

  const group = 'argoproj.io';
  const version = 'v1alpha1';
  const plural = 'workflows';
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

  const status = params?.status;
  const phasesFromFlags: string[] = [];
  if (params?.running) phasesFromFlags.push('Running');
  if (params?.succeeded) phasesFromFlags.push('Succeeded');
  if (params?.pending) phasesFromFlags.push('Pending');
  if (params?.failed) phasesFromFlags.push('Failed', 'Error');

  if (typeof status === 'string' && status.length > 0) {
    filtered = filtered.filter((w: any) => String(w?.status?.phase || '') === status);
  } else if (phasesFromFlags.length > 0) {
    const allowed = new Set(phasesFromFlags);
    filtered = filtered.filter((w: any) => allowed.has(String(w?.status?.phase || '')));
  }

  if (params?.completed) {
    filtered = filtered.filter((w: any) => Boolean(w?.status?.finishedAt));
  }

  if (params?.since) {
    const ms = parseDurationToMs(params.since);
    if (ms) {
      const cutoff = Date.now() - ms;
      filtered = filtered.filter((w: any) => {
        const ts = w?.status?.startedAt || w?.metadata?.creationTimestamp;
        const t = ts ? Date.parse(ts) : NaN;
        return Number.isFinite(t) && t >= cutoff;
      });
    }
  }

  if (typeof params?.maxWorkflows === 'number' && Number.isFinite(params.maxWorkflows)) {
    filtered = filtered.slice(0, Math.max(0, params.maxWorkflows));
  }

  return { ...body, items: filtered };
}

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
        labelSelector: ArgoCommonSchemas.labelSelector,
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

  async execute(params: any, client?: KubernetesClient): Promise<any> {
    const outputFormat = params?.outputFormat || 'json';
    if (outputFormat === 'json' && client) {
      // Try Kubernetes API first if client is available
      try {
        const result = await listWorkflowsViaK8s(params, client);
        return toMcpToolResult(markTransport(result, 'k8s'));
      } catch (error: any) {
        if (!isRecoverableK8sError(error)) {
          // Non-recoverable error, fallback to CLI
        }
        // Recoverable error (404, 403, etc.), fallback to CLI
      }
    }

    const args = ['list'];

    const labelSelector = params?.labelSelector || params?.selector;

    // Add namespace specification
    if (params.allNamespaces) {
      args.push('--all-namespaces');
    } else if (params.namespace) {
      args.push('-n', params.namespace);
    }

    // Add output format
    if (outputFormat) {
      args.push('-o', outputFormat);
    } else {
      args.push('-o', 'json');
    }

    // Add selector
    if (labelSelector) {
      args.push('-l', labelSelector);
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
      await validateArgoCLI();
      const result = await executeArgoCommand(args);
      return toMcpToolResult(markTransport(result, 'cli'));
    } catch (error) {
      throw new Error(
        `Failed to list Argo workflows: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

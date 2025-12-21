import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { PodOperations } from '../../kubernetes/resources/PodOperations.js';
import { toMcpToolResult } from '../../utils/McpToolResult.js';
import {
  ArgoBaseTool,
  ArgoCommonSchemas,
  executeArgoCommand,
  validateArgoCLI,
  isRecoverableK8sError,
  markTransport,
} from './BaseTool.js';

function parseDurationToSeconds(duration: string): number {
  const match = String(duration)
    .trim()
    .match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use format like "5m", "1h", "30s"`);
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 3600;
    case 'd':
      return value * 86400;
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

async function fetchLogsViaK8s(params: any, client: KubernetesClient): Promise<string> {
  await client.refreshCurrentContext();
  const podOps = new PodOperations(client);

  const namespace = params?.namespace || 'argo';
  const workflowName = params?.workflowName;

  // Find pods associated with the workflow
  // Argo workflows label pods with workflow name
  const labelSelector = `workflows.argoproj.io/workflow=${workflowName}`;
  const listOptions = {
    namespace,
    labelSelector,
  };

  const res = await podOps.list(listOptions);
  const pods = res.items;

  if (pods.length === 0) {
    throw new Error(
      `No pods found for workflow "${workflowName}" via Kubernetes API (label selector: ${labelSelector})`,
    );
  }

  // Fetch logs
  const logPromises = pods.map(async (pod: any) => {
    const name = pod.metadata?.name;
    const ns = pod.metadata?.namespace;
    if (!name || !ns) return '';

    let sinceSeconds: number | undefined;
    try {
      if (params.since) {
        sinceSeconds = parseDurationToSeconds(params.since);
      }
    } catch {
      // ignore invalid duration
    }

    try {
      const logContent = await podOps.getLogs(name, {
        namespace: ns,
        container: params.container || undefined,
        follow: params.follow || false,
        tailLines: params.tail || params.tailLines,
        sinceSeconds: sinceSeconds,
        previous: params.previous,
        timestamps: params.timestamps,
      });

      if (pods.length > 1) {
        return `Pod: ${name}\n${logContent}\n-------------------\n`;
      }
      return logContent;
    } catch (error: any) {
      const msg = error?.response?.body?.message || error.message || String(error);
      return `Failed to fetch logs for pod ${name}: ${msg}\n`;
    }
  });

  const logs = await Promise.all(logPromises);
  return logs.join('\n');
}

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
        tailLines: {
          type: 'number',
          description: 'Alias for tail',
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

  async execute(params: any, client?: KubernetesClient): Promise<any> {
    const tailLines = params?.tailLines ?? params?.tail;

    // 1. Try Kubernetes API first if client is available
    if (client) {
      try {
        const text = await fetchLogsViaK8s({ ...params, tail: tailLines }, client);
        const logLines = String(text)
          .split('\n')
          .map((l) => l.trimEnd())
          .filter((l) => l.length > 0);
        return toMcpToolResult(
          markTransport(
            {
              workflowName: params.workflowName,
              namespace: params.namespace || 'argo',
              container: params.container,
              lineCount: logLines.length,
              logs: logLines,
              options: {
                follow: Boolean(params.follow),
                previous: Boolean(params.previous),
                since: params.since,
                sinceTime: params.sinceTime,
                tailLines,
                timestamps: Boolean(params.timestamps),
                grep: params.grep,
                noColor: Boolean(params.noColor),
              },
              transport: 'k8s',
            },
            'k8s',
          ),
        );
      } catch (error: any) {
        if (!isRecoverableK8sError(error)) {
          // Non-recoverable error, fallback to CLI
        }
        // Recoverable error (404, 403, etc.), fallback to CLI
      }
    }

    // 2. Fallback to CLI
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
    if (typeof tailLines === 'number') {
      args.push('--tail', tailLines.toString());
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
      await validateArgoCLI();
      const result = await executeArgoCommand(args);
      const text =
        typeof result === 'object' && result !== null && 'output' in result
          ? String((result as any).output || '')
          : typeof result === 'string'
            ? result
            : JSON.stringify(result);
      const logLines = text.split('\n').filter((line) => line.trim().length > 0);
      return toMcpToolResult(
        markTransport(
          {
            workflowName: params.workflowName,
            namespace: params.namespace || 'argo',
            container: params.container,
            lineCount: logLines.length,
            logs: logLines,
            options: {
              follow: Boolean(params.follow),
              previous: Boolean(params.previous),
              since: params.since,
              sinceTime: params.sinceTime,
              tailLines,
              timestamps: Boolean(params.timestamps),
              grep: params.grep,
              noColor: Boolean(params.noColor),
            },
            transport: 'cli',
          },
          'cli',
        ),
      );
    } catch (error) {
      throw new Error(
        `Failed to get Argo workflow logs: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

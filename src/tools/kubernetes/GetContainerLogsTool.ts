import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

/**
 * Fetch logs from a container in a Kubernetes pod
 */
export class GetContainerLogsTool implements BaseTool {
  tool: Tool = {
    name: 'pod_logs',
    description:
      'Return stdout / stderr logs for a specified container in a pod in the current cluster (similar to `kubectl logs`)',
    inputSchema: {
      type: 'object',
      properties: {
        podName: {
          type: 'string',
          description: 'Name of the pod',
        },
        namespace: {
          ...CommonSchemas.namespace,
          description: 'Kubernetes namespace (defaults to "default")',
        },
        container: {
          type: 'string',
          description: 'Container name (optional, defaults to first container)',
          optional: true,
        },
        tailLines: {
          type: 'number',
          description: 'Number of lines from the end of the logs to show (optional)',
          optional: true,
        },
        since: {
          type: 'string',
          description: 'Show logs since this duration (e.g., "5m", "1h") (optional)',
          optional: true,
        },
        previous: {
          type: 'boolean',
          description: 'Return logs from previous instance of the container (optional)',
          optional: true,
        },
        timestamps: {
          type: 'boolean',
          description: 'Include timestamps in log output (optional)',
          optional: true,
        },
      },
      required: ['podName'],
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    try {
      const {
        podName,
        namespace = 'default',
        container,
        tailLines,
        since,
        previous = false,
        timestamps = false,
      } = params;

      // Convert duration string to seconds if provided
      let sinceSeconds: number | undefined;
      if (since) {
        sinceSeconds = this.parseDuration(since);
      }

      // Fetch the logs
      const logs = await client.core.readNamespacedPodLog({
        name: podName,
        namespace,
        container,
        tailLines,
        sinceSeconds,
        previous,
        timestamps,
      });

      // logs is returned as a string, split into lines for better formatting
      const logLines = (logs as unknown as string).split('\n').filter((line) => line.trim());

      return {
        podName,
        namespace,
        container: container || 'default',
        lineCount: logLines.length,
        logs: logLines,
        options: {
          tailLines,
          since,
          previous,
          timestamps,
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.body?.message || error.message || 'Unknown error';

      // Provide more helpful error messages for common cases
      if (errorMessage.includes('container') && errorMessage.includes('not found')) {
        throw new Error(`Container '${params.container}' not found in pod '${params.podName}'`);
      } else if (errorMessage.includes('not found')) {
        throw new Error(
          `Pod '${params.podName}' not found in namespace '${params.namespace || 'default'}'`,
        );
      }

      throw new Error(`Failed to fetch container logs: ${errorMessage}`);
    }
  }

  /**
   * Parse duration string (e.g., "5m", "1h", "30s") to seconds
   */
  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) {
      throw new Error(`Invalid duration format: ${duration}. Use format like "5m", "1h", "30s"`);
    }

    const value = parseInt(match[1], 10);
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
}

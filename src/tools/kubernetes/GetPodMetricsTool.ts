import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { MetricOperations } from '../../kubernetes/resources/MetricOperations.js';

/**
 * Get pod metrics from Kubernetes metrics API
 */
export class GetPodMetricsTool implements BaseTool {
  tool: Tool = {
    name: 'get_pod_metrics',
    description:
      'Fetch CPU and memory metrics for pods in the current Kubernetes cluster (similar to `kubectl top pods`)',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: {
          ...CommonSchemas.namespace,
          description:
            'Kubernetes namespace to fetch pod metrics from. If not specified, fetches metrics from all namespaces.',
        },
        podName: {
          type: 'string',
          description:
            'Optional specific pod name to fetch metrics for. If provided, namespace is required.',
        },
      },
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    try {
      const { namespace, podName } = params || {};
      const metricOperations = new MetricOperations(client);

      // If a specific pod name is requested, fetch metrics for that pod only
      if (podName) {
        if (!namespace) {
          throw new Error('Namespace is required when fetching metrics for a specific pod');
        }

        const podMetrics = await metricOperations.getPodMetricsByName(podName, namespace);

        if (!podMetrics) {
          return {
            message: `No metrics found for pod '${podName}' in namespace '${namespace}'`,
            pod: null,
          };
        }

        return {
          pod: {
            name: podMetrics.metadata.name,
            namespace: podMetrics.metadata.namespace,
            timestamp: podMetrics.timestamp,
            window: podMetrics.window,
            containers: podMetrics.containers.map((container) => ({
              name: container.name,
              cpu: container.usage.cpu,
              memory: container.usage.memory,
            })),
          },
        };
      }

      // Otherwise, fetch metrics for all pods in the specified namespace (or all namespaces)
      const podMetricsList = await metricOperations.getPodMetrics(namespace);

      if (!podMetricsList || !podMetricsList.items || podMetricsList.items.length === 0) {
        return {
          total: 0,
          namespace: namespace || 'all',
          message: 'No pod metrics found',
          pods: [],
        };
      }

      const pods = podMetricsList.items.map((podMetrics) => ({
        name: podMetrics.metadata.name,
        namespace: podMetrics.metadata.namespace,
        timestamp: podMetrics.timestamp,
        window: podMetrics.window,
        containers: podMetrics.containers.map((container) => ({
          name: container.name,
          cpu: container.usage.cpu,
          memory: container.usage.memory,
        })),
        // Calculate total pod usage by summing container usage
        totalUsage: {
          cpu: podMetrics.containers.reduce((total, container) => {
            // Parse CPU values and sum them (handling different units like 'm', 'n')
            const cpuValue = metricOperations.parseCpuValueToNanocores(container.usage.cpu);
            return total + cpuValue;
          }, 0),
          memory: podMetrics.containers.reduce((total, container) => {
            // Parse memory values and sum them (handling different units like 'Ki', 'Mi', 'Gi')
            const memoryValue = metricOperations.parseMemoryValueToBytes(container.usage.memory);
            return total + memoryValue;
          }, 0),
        },
      }));

      return {
        total: pods.length,
        namespace: namespace || 'all',
        pods,
      };
    } catch (error: any) {
      const errorMessage = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to get pod metrics: ${errorMessage}`);
    }
  }
}

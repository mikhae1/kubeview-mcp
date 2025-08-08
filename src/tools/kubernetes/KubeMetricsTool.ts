import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import {
  MetricOperations,
  NormalizedPodMetric,
} from '../../kubernetes/resources/MetricOperations.js';

/**
 * Consolidated metrics tool for Kubernetes nodes and pods (and optional Prometheus enrichment)
 */
export class KubeMetricsTool implements BaseTool {
  tool: Tool = {
    name: 'kube_metrics',
    description:
      'Get live CPU/memory metrics for nodes or pods with optional Prometheus enrichment.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'Metric scope',
          enum: ['nodes', 'pods'],
          default: 'pods',
        },
        namespace: {
          ...CommonSchemas.namespace,
          description:
            'Optional namespace to restrict Prometheus discovery and pod metrics/spec fetching.',
        },
        podName: {
          type: 'string',
          description: 'Optional specific pod to fetch metrics for (requires namespace).',
          optional: true,
        },
        prometheusQueries: {
          type: 'array',
          items: { type: 'string' },
          description:
            'An array of PromQL queries to execute against discovered Prometheus targets.',
          default: [],
        },
        fetchPodSpecs: {
          type: 'boolean',
          description:
            'If true, fetch pod specs to enrich pod metrics (e.g., nodeName). Defaults to true.',
          default: true,
        },
      },
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    const {
      scope = 'pods',
      namespace,
      podName,
      prometheusQueries = [],
      fetchPodSpecs = true,
    } = params || {};

    const metrics = new MetricOperations(client);

    // Fast path: specific pod
    if (scope === 'pods' && podName && namespace) {
      const podMetric = await metrics.getPodMetricsByName(podName, namespace);
      if (!podMetric) return { normalizedPods: [], normalizedNodes: [], error: 'No metrics found' };
      const normalizedPod: NormalizedPodMetric = {
        name: podMetric.metadata.name,
        namespace: podMetric.metadata.namespace || namespace,
        uid: `${podMetric.metadata.namespace || 'default'}:${podMetric.metadata.name}`,
        nodeName: undefined,
        timestamp: podMetric.timestamp,
        window: podMetric.window,
        usage: {
          cpuCores:
            (podMetric.containers || [])
              .map((c) => metrics.parseCpuValueToNanocores(c.usage.cpu))
              .reduce((a, b) => a + (b || 0), 0) / 1e9,
          memoryBytes: (podMetric.containers || [])
            .map((c) => metrics.parseMemoryValueToBytes(c.usage.memory))
            .reduce((a, b) => a + (b || 0), 0),
        },
        containers: (podMetric.containers || []).map((c) => ({
          name: c.name,
          usage: {
            cpuCores: metrics.parseCpuValueToNanocores(c.usage.cpu) / 1e9,
            memoryBytes: metrics.parseMemoryValueToBytes(c.usage.memory),
          },
        })),
      };
      return { normalizedPods: [normalizedPod], normalizedNodes: [] };
    }

    // General path: combined metrics with optional Prometheus enrichment
    const result = await metrics.getAllNormalizedMetrics(
      Array.isArray(prometheusQueries) ? prometheusQueries : [],
      !!fetchPodSpecs,
      typeof namespace === 'string' ? namespace : undefined,
    );
    const safeResult = result || { nodesMetrics: [], podsMetrics: [], error: 'No data' };

    if (scope === 'nodes') {
      return {
        normalizedNodes: safeResult.nodesMetrics,
        normalizedPods: [],
        error: safeResult.error,
      };
    }

    return { normalizedPods: safeResult.podsMetrics, normalizedNodes: [], error: safeResult.error };
  }
}

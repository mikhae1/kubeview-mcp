import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { MetricOperations } from '../../kubernetes/resources/MetricOperations.js';

/**
 * Get various metrics for Kubernetes resources, optionally enriched with Prometheus data.
 */
export class GetMetricsTool implements BaseTool {
  tool: Tool = {
    name: 'get_metrics',
    description:
      'Fetch live CPU / memory metrics for all nodes and pods in the current cluster (similar to `kubectl top`), with optional enrichment from Prometheus data.',
    inputSchema: {
      type: 'object',
      properties: {
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
            'If true, fetches all pod specifications to enrich normalized pod metrics (e.g., with nodeName). Defaults to true.',
          default: true,
        },
        namespace: {
          ...CommonSchemas.namespace,
          description:
            'Optional namespace to restrict Prometheus discovery, pod metrics, and pod spec fetching. If not provided, operates cluster-wide where applicable.',
        },
      },
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    const metricOperations = new MetricOperations(client);

    // Use explicit defaults from the tool schema
    const namespace = params.namespace;
    const prometheusQueries = params.prometheusQueries ?? [];
    const fetchPodSpecs = params.fetchPodSpecs ?? true;

    const result = await metricOperations.getMetricsWithOptions(
      prometheusQueries,
      fetchPodSpecs,
      namespace,
    );

    // Provide an LLM-ready summary alongside the normalized data
    const summary = metricOperations.buildLLMSummary(
      result.normalizedNodes || [],
      result.normalizedPods || [],
    );

    return { ...result, summary };
  }
}

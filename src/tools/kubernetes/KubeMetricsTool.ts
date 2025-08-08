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
      'One-shot cluster metrics and diagnostics. By default returns node and workload (pods) CPU/memory plus a summary and detected problems. Supports optional focus on nodes or pods, namespace scoping, and Prometheus enrichment.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'Metric scope (default: all).',
          enum: ['all', 'nodes', 'pods'],
          default: 'all',
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
        diagnostics: {
          type: 'boolean',
          description:
            'If true, runs built-in checks (CrashLoopBackOff, OOMKilled, high restarts, Pending pods, node pressure/NotReady, high utilization, missing limits).',
          default: false,
        },
        includeSummary: {
          type: 'boolean',
          description: 'If true, include a compact top-N summary in the output.',
          default: false,
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
        topN: {
          type: 'number',
          description: 'Number of top pods/namespaces to include in summary.',
          default: 5,
        },
        cpuSaturationThreshold: {
          type: 'number',
          description: 'Node CPU saturation threshold (fraction of allocatable).',
          default: 0.9,
        },
        memorySaturationThreshold: {
          type: 'number',
          description: 'Node memory saturation threshold (fraction of allocatable).',
          default: 0.9,
        },
        podRestartThreshold: {
          type: 'number',
          description: 'Per-container restart count threshold for warnings.',
          default: 5,
        },
        podLimitPressureThreshold: {
          type: 'number',
          description: 'Pod usage/limit threshold to warn (fraction).',
          default: 0.8,
        },
      },
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    const {
      scope = 'all',
      namespace,
      podName,
      fetchPodSpecs = true,
      diagnostics = true,
      includeSummary = false,
      topN = 5,
      cpuSaturationThreshold = 0.9,
      memorySaturationThreshold = 0.9,
      podRestartThreshold = 5,
      podLimitPressureThreshold = 0.8,
    } = params || {};

    // Validate required args for specific pod fetch
    if (podName && !namespace && scope !== 'nodes') {
      return { normalizedPods: [], normalizedNodes: [], error: 'No data' };
    }

    // Do not auto-inject Prometheus queries by default to avoid network hangs
    // when running outside the cluster. Only use if provided explicitly.
    const prometheusQueries: string[] = Array.isArray(params?.prometheusQueries)
      ? (params.prometheusQueries as string[])
      : [];

    const metrics = new MetricOperations(client);

    // Fast path: specific pod
    if (scope !== 'nodes' && podName && namespace) {
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

    // General path: gather metrics with direct API first (fast), fallback internally
    // Default behavior: if no namespace provided and we are fetching pods, use current context namespace
    const effectiveNamespace =
      typeof namespace === 'string'
        ? namespace
        : scope === 'nodes'
          ? undefined
          : client.getCurrentNamespace();

    const result = await metrics.getMetricsWithOptions(
      Array.isArray(prometheusQueries) ? prometheusQueries : [],
      !!fetchPodSpecs,
      effectiveNamespace,
    );

    const safe = (result as any) || {};
    const normalizedNodes = (safe.normalizedNodes as any[]) ?? (safe.nodesMetrics as any[]) ?? [];
    const normalizedPods = (safe.normalizedPods as any[]) ?? (safe.podsMetrics as any[]) ?? [];

    // Build compact LLM-friendly summary
    const summary = includeSummary
      ? metrics.buildLLMSummary(
          scope === 'pods' ? [] : normalizedNodes,
          scope === 'nodes' ? [] : normalizedPods,
          topN,
        )
      : undefined;

    // Optional diagnostics
    let diagnosticsOut: any = undefined;
    if (diagnostics) {
      diagnosticsOut = await metrics.detectProblems(
        scope === 'pods' ? [] : normalizedNodes,
        scope === 'nodes' ? [] : normalizedPods,
        {
          namespace: effectiveNamespace,
          cpuSaturationThreshold,
          memorySaturationThreshold,
          podRestartThreshold,
          podLimitPressureThreshold,
          includeNodeFindings: false,
        },
      );
    }

    if (scope === 'nodes') {
      return {
        normalizedNodes,
        normalizedPods: [],
        summary,
        diagnostics: diagnosticsOut,
        error: result.error,
      };
    }
    if (scope === 'pods') {
      return {
        normalizedNodes: [],
        normalizedPods,
        summary,
        diagnostics: diagnosticsOut,
        error: result.error,
      };
    }
    // scope === 'all'
    return {
      normalizedNodes,
      normalizedPods,
      summary,
      diagnostics: diagnosticsOut,
      error: result.error,
    };
  }
}

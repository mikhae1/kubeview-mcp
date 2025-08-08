import { KubernetesClient } from '../KubernetesClient.js';
import { V1ServicePort, V1ServiceList, V1PodList, V1Pod, V1Node } from '@kubernetes/client-node';
import * as http from 'http'; // Import http module
import * as https from 'https'; // Import https module
import { URL } from 'url'; // Import URL for parsing
import { Logger } from 'winston';

// Based on metrics.k8s.io/v1beta1
interface K8sObjectMeta {
  name: string;
  namespace?: string;
  selfLink?: string;
  creationTimestamp?: string;
  // Add other metadata fields if needed
}

interface ResourceUsage {
  cpu: string; // e.g., "9559630n" (nanocores) or "0.5" (cores)
  memory: string; // e.g., "22244Ki" (kibibytes)
  // Add other resources like ephemeral-storage if needed
}

export interface ContainerMetrics {
  name: string;
  usage: ResourceUsage;
}

export interface PodMetrics {
  kind: 'PodMetrics';
  apiVersion: 'metrics.k8s.io/v1beta1';
  metadata: K8sObjectMeta;
  timestamp: string; // ISO 8601 timestamp
  window: string; // e.g., "30s"
  containers: ContainerMetrics[];
}

export interface NodeMetrics {
  kind: 'NodeMetrics';
  apiVersion: 'metrics.k8s.io/v1beta1';
  metadata: K8sObjectMeta;
  timestamp: string; // ISO 8601 timestamp
  window: string; // e.g., "30s"
  usage: ResourceUsage;
}

// For lists of metrics
export interface NodeMetricsList {
  kind: 'NodeMetricsList';
  apiVersion: 'metrics.k8s.io/v1beta1';
  metadata: { selfLink?: string; resourceVersion?: string };
  items: NodeMetrics[];
}

export interface PodMetricsList {
  kind: 'PodMetricsList';
  apiVersion: 'metrics.k8s.io/v1beta1';
  metadata: { selfLink?: string; resourceVersion?: string };
  items: PodMetrics[];
}

// Prometheus-related constants
const PROMETHEUS_ANNOTATION_SCRAPE = 'prometheus.io/scrape';
// Deprecated scrape hints for direct /metrics scraping; kept for reference but not used for query API
// const PROMETHEUS_ANNOTATION_PATH = 'prometheus.io/path';
// const PROMETHEUS_ANNOTATION_PORT = 'prometheus.io/port';

// Define an interface for a discovered Prometheus target
export interface PrometheusTarget {
  url: string; // Base URL, e.g., http://service-ip:port
  serviceName: string;
  namespace: string;
  port?: number;
  scheme?: 'http' | 'https';
  kind?: 'prometheus' | 'thanos' | 'victoriametrics' | 'unknown';
  // Potentially add more metadata here later, like scrape interval from annotations
}

// Normalized Metric Structures
export interface NormalizedResourceUsage {
  cpuCores?: number; // CPU in cores (e.g., 0.5 for half a core)
  memoryBytes?: number; // Memory in bytes
}

export interface NormalizedContainerMetric {
  name: string;
  usage: NormalizedResourceUsage;
}

export interface NormalizedPodMetric {
  name: string;
  namespace: string;
  uid?: string;
  nodeName?: string; // From Pod spec, not metrics directly
  timestamp: string;
  window: string;
  usage: NormalizedResourceUsage;
  containers: NormalizedContainerMetric[];
  // For merged Prometheus metrics
  customMetrics?: NormalizedCustomMetric[];
}

export interface NormalizedNodeMetric {
  name: string;
  uid?: string;
  timestamp: string;
  window: string;
  usage: NormalizedResourceUsage;
  // For merged Prometheus metrics
  customMetrics?: NormalizedCustomMetric[];
}

export interface NormalizedCustomMetric {
  name: string; // The PromQL metric name
  value: number;
  labels?: Record<string, string>; // Prometheus labels
  type?: 'gauge' | 'counter' | 'histogram' | 'summary' | 'untyped'; // Optional: Prometheus metric type
}

export class MetricOperations {
  private k8sClient: KubernetesClient;
  private logger?: Logger;
  private static readonly METRICS_API_GROUP = 'metrics.k8s.io';
  private static readonly METRICS_API_VERSION = 'v1beta1';
  private discoveredPrometheusTargets: PrometheusTarget[] = [];

  constructor(k8sClient: KubernetesClient, logger?: Logger) {
    this.k8sClient = k8sClient;
    this.logger = logger;
    this.logger?.debug?.('MetricOperations initialized');
  }

  /**
   * Fetches metrics for all nodes.
   * @returns A promise that resolves to a list of node metrics.
   */
  public async getNodeMetrics(): Promise<NodeMetricsList | null> {
    this.logger?.debug?.('Fetching node metrics using CustomObjectsApi');
    try {
      const response = await this.k8sClient.customObjects.listClusterCustomObject({
        group: MetricOperations.METRICS_API_GROUP,
        version: MetricOperations.METRICS_API_VERSION,
        plural: 'nodes',
      });
      // The k8s client returns { response, body }

      return (response as any).body as NodeMetricsList;
    } catch (error: any) {
      this.logger?.error('Error fetching node metrics:', error.message);
      if (error.body) {
        this.logger?.error('Error body:', JSON.stringify(error.body, null, 2));
      }
      return null;
    }
  }

  /**
   * Fetches metrics for a specific node.
   * @param nodeName The name of the node.
   * @returns A promise that resolves to the node's metrics.
   */
  public async getNodeMetricsByName(nodeName: string): Promise<NodeMetrics | null> {
    this.logger?.debug?.(`Fetching metrics for node: ${nodeName} using CustomObjectsApi`);
    try {
      const response = await this.k8sClient.customObjects.getClusterCustomObject({
        group: MetricOperations.METRICS_API_GROUP,
        version: MetricOperations.METRICS_API_VERSION,
        plural: 'nodes',
        name: nodeName,
      });

      return (response as any).body as NodeMetrics;
    } catch (error: any) {
      this.logger?.error(`Error fetching metrics for node ${nodeName}:`, error.message);
      if (error.body) {
        this.logger?.error('Error body:', JSON.stringify(error.body, null, 2));
      }
      return null;
    }
  }

  /**
   * Helper: List all node names in the cluster
   */
  private async listNodes(): Promise<string[]> {
    try {
      const nodes = await this.k8sClient.core.listNode();
      return (nodes.items as V1Node[])
        .map((n: V1Node) => n.metadata?.name)
        .filter(Boolean) as string[];
    } catch (e) {
      this.logger?.error('Failed to list nodes for kubelet summary fallback:', e);
      return [];
    }
  }

  /**
   * Helper: Convert kubelet summary pod stats to PodMetrics format
   */
  private convertSummaryPodToPodMetrics(pod: any): PodMetrics {
    // Kubelet summary pod object: https://github.com/kubernetes/kubernetes/blob/master/pkg/kubelet/apis/stats/v1alpha1/types.go
    // We'll map the fields as best as possible
    const containers: ContainerMetrics[] = (pod.containers || []).map((c: any) => ({
      name: c.name,
      usage: {
        cpu: c.cpu?.usageNanoCores ? `${c.cpu.usageNanoCores}n` : '0',
        memory: c.memory?.usageBytes ? `${c.memory.usageBytes}` : '0',
      },
    }));
    return {
      kind: 'PodMetrics',
      apiVersion: 'metrics.k8s.io/v1beta1',
      metadata: {
        name: pod.podRef.name,
        namespace: pod.podRef.namespace,
        // selfLink and creationTimestamp not available
      },
      timestamp: pod.startTime || new Date().toISOString(),
      window: '30s', // Not available in summary, use default
      containers,
    };
  }

  /**
   * Helper: Fetch pod metrics from kubelet summary API for all nodes
   */
  private async getPodMetricsFromKubeletSummary(namespace?: string): Promise<PodMetrics[]> {
    const nodeNames = await this.listNodes();
    const allPodMetrics: PodMetrics[] = [];
    for (const nodeName of nodeNames) {
      try {
        // Prefer CoreV1Api connect proxy which fully integrates auth
        let summary: any | null = null;
        try {
          const proxyResp: any = await (this.k8sClient.core as any).connectGetNodeProxyWithPath(
            nodeName,
            'stats/summary',
          );
          const body = proxyResp?.body ?? proxyResp;
          if (body) {
            summary = typeof body === 'string' ? JSON.parse(body) : body;
          }
        } catch {
          // Fallback to raw request if connect API is unavailable or fails
          summary = await this.k8sClient.getRaw<any>(
            `/api/v1/nodes/${nodeName}/proxy/stats/summary`,
          );
        }
        if (summary && summary.pods) {
          for (const pod of summary.pods) {
            if (!namespace || pod.podRef.namespace === namespace) {
              allPodMetrics.push(this.convertSummaryPodToPodMetrics(pod));
            }
          }
        }
      } catch (e) {
        this.logger?.warn(`Failed to fetch kubelet summary for node ${nodeName}: ${e}`);
      }
    }
    return allPodMetrics;
  }

  /**
   * Helper: Fetch pod metrics from metrics.k8s.io API (original implementation)
   */
  private async getPodMetricsFromMetricsApi(namespace?: string): Promise<PodMetricsList | null> {
    this.logger?.debug?.(
      `Fetching pod metrics for namespace: ${namespace || 'all'} using CustomObjectsApi`,
    );
    try {
      let response;
      if (namespace) {
        response = await this.k8sClient.customObjects.listNamespacedCustomObject({
          group: MetricOperations.METRICS_API_GROUP,
          version: MetricOperations.METRICS_API_VERSION,
          namespace: namespace,
          plural: 'pods',
        });
      } else {
        this.logger?.debug?.(
          'Fetching pod metrics for all namespaces using listClusterCustomObject.',
        );
        response = await this.k8sClient.customObjects.listClusterCustomObject({
          group: MetricOperations.METRICS_API_GROUP,
          version: MetricOperations.METRICS_API_VERSION,
          plural: 'pods',
        });
      }

      return (response as any).body as PodMetricsList;
    } catch (error: any) {
      this.logger?.error('Error fetching pod metrics from metrics.k8s.io:', error.message);
      if (error.body) {
        this.logger?.error('Error body:', JSON.stringify(error.body, null, 2));
      }
      return null;
    }
  }

  /**
   * Fetches metrics for all pods in a given namespace, or all namespaces if none is specified.
   * Always tries both metrics.k8s.io and kubelet summary API, merging results.
   * @param namespace Optional namespace to filter pods.
   * @returns A promise that resolves to a list of pod metrics.
   */
  public async getPodMetrics(namespace?: string): Promise<PodMetricsList | null> {
    // Attempt 1: metrics.k8s.io API
    const metricsApi = await this.getPodMetricsFromMetricsApi(namespace);
    if (metricsApi && metricsApi.items && metricsApi.items.length > 0) {
      // Primary source succeeded – return as‑is, no merging with kubelet
      return metricsApi;
    }

    // Attempt 2 (fallback): Kubelet summary API
    const kubeletMetrics = await this.getPodMetricsFromKubeletSummary(namespace);
    if (kubeletMetrics && kubeletMetrics.length > 0) {
      return {
        kind: 'PodMetricsList',
        apiVersion: 'metrics.k8s.io/v1beta1',
        metadata: {},
        items: kubeletMetrics,
      };
    }

    // No data from either source
    return null;
  }

  /**
   * Fetches metrics for a specific pod in a given namespace.
   * Uses the namespace-wide getPodMetrics method and filters for the specific pod.
   * This approach is more reliable than direct pod metric API calls.
   * @param podName The name of the pod.
   * @param namespace The namespace of the pod.
   * @returns A promise that resolves to the pod's metrics.
   */
  public async getPodMetricsByName(podName: string, namespace: string): Promise<PodMetrics | null> {
    this.logger?.debug?.(`Fetching metrics for pod: ${podName} in namespace ${namespace}`);

    try {
      // 0) Try direct metrics.k8s.io GET for the specific pod (fast path)
      try {
        const direct = (await this.k8sClient.customObjects.getNamespacedCustomObject({
          group: 'metrics.k8s.io',
          version: 'v1beta1',
          namespace,
          plural: 'pods',
          name: podName,
        })) as any;
        const body = direct?.body ?? direct;
        if (body && body.kind === 'PodMetrics' && body.metadata?.name === podName) {
          this.logger?.debug?.(`Direct metrics.k8s.io GET succeeded for ${namespace}/${podName}`);
          return body as PodMetrics;
        }
      } catch (e: any) {
        // Not fatal; continue with fallback strategies
        this.logger?.debug?.(
          `Direct metrics.k8s.io GET failed for ${namespace}/${podName}: ${e?.message || e}`,
        );
      }

      // Use the robust getPodMetrics method which handles all fallbacks
      const podMetricsList = await this.getPodMetrics(namespace);

      if (podMetricsList && podMetricsList.items && podMetricsList.items.length > 0) {
        // Find the specific pod in the list
        const foundPod = podMetricsList.items.find(
          (pod) =>
            pod.metadata.name === podName &&
            (pod.metadata.namespace === namespace || pod.metadata.namespace === undefined),
        );

        if (foundPod) {
          this.logger?.debug?.(
            `Successfully found metrics for pod ${podName} in namespace ${namespace}`,
          );
          return foundPod;
        } else {
          this.logger?.debug?.(
            `Pod ${podName} not found in metrics list for namespace ${namespace}`,
          );
          this.logger?.debug?.(
            `Available pods in namespace: ${podMetricsList.items.map((p) => p.metadata.name).join(', ')}`,
          );
        }
      } else {
        this.logger?.debug?.(`No pod metrics available in namespace ${namespace}`);
      }

      // 2) Final targeted fallback: use kubelet summary for the specific node hosting this pod
      try {
        const podResp: any = await this.k8sClient.core.readNamespacedPod({
          name: podName,
          namespace,
        });
        const nodeName: string | undefined = podResp?.spec?.nodeName;
        if (nodeName) {
          const summary = await this.k8sClient.getRaw<any>(
            `/api/v1/nodes/${nodeName}/proxy/stats/summary`,
          );
          const pods: any[] = summary?.pods || [];
          const target = pods.find(
            (p) => p?.podRef?.name === podName && p?.podRef?.namespace === namespace,
          );
          if (target) {
            this.logger?.debug?.(
              `Found ${namespace}/${podName} metrics via kubelet summary on node ${nodeName}`,
            );
            return this.convertSummaryPodToPodMetrics(target);
          }
        }
      } catch (e: any) {
        this.logger?.warn?.(
          `Kubelet summary targeted fetch failed for ${namespace}/${podName}: ${e?.message || e}`,
        );
      }
    } catch (error: any) {
      this.logger?.error(
        `Error fetching metrics for pod ${podName} in namespace ${namespace}: ${error.message}`,
      );
    }

    return null;
  }

  /**
   * Discovers Prometheus targets by scanning services for specific annotations.
   * @param namespace Optional namespace to scan. If not provided, scans all namespaces.
   */
  public async discoverPrometheusTargets(namespace?: string): Promise<PrometheusTarget[]> {
    this.logger?.debug?.(
      `Starting Prometheus-like target discovery in namespace: ${namespace || 'all'}`,
    );
    const newTargets: PrometheusTarget[] = [];

    const isPrometheusLikeService = (svcName?: string, labels?: Record<string, string>) => {
      const name = (svcName || '').toLowerCase();
      const labelPairs = labels || {};
      const labelVals = Object.values(labelPairs).map((v) => (v || '').toLowerCase());
      const labelKeys = Object.keys(labelPairs).map((k) => k.toLowerCase());

      const nameHints = [
        'prometheus',
        'kube-prometheus',
        'kube-prometheus-stack-prometheus',
        'prometheus-operated',
        'thanos',
        'thanos-query',
        'victoriametrics',
        'vmselect',
        'vmsingle',
      ];
      const labelHints = [
        'prometheus',
        'kube-prometheus',
        'prometheus-operator',
        'thanos',
        'victoriametrics',
        'vmselect',
      ];

      if (nameHints.some((h) => name.includes(h))) return true;
      if (labelVals.some((v) => labelHints.some((h) => v.includes(h)))) return true;
      if (labelPairs['app'] && labelHints.includes(labelPairs['app'].toLowerCase())) return true;
      if (
        labelPairs['app.kubernetes.io/name'] &&
        labelHints.some((h) => labelPairs['app.kubernetes.io/name'].toLowerCase().includes(h))
      )
        return true;
      if (
        labelKeys.some((k) =>
          ['prometheus', 'thanos', 'victoriametrics', 'vmselect'].some((h) => k.includes(h)),
        )
      )
        return true;
      return false;
    };

    try {
      let serviceList: V1ServiceList;
      if (namespace) {
        serviceList = await this.k8sClient.core.listNamespacedService({ namespace });
      } else {
        serviceList = await this.k8sClient.core.listServiceForAllNamespaces();
      }

      if (serviceList && serviceList.items) {
        for (const service of serviceList.items) {
          const metadata = service.metadata;
          const annotations = metadata?.annotations || ({} as Record<string, string>);
          const labels = metadata?.labels || ({} as Record<string, string>);

          const serviceName = metadata?.name;
          const serviceNamespace = metadata?.namespace;
          const clusterIP = service.spec?.clusterIP;

          if (!serviceName || !serviceNamespace) continue;

          // Identify only services that likely expose a query-compatible API
          if (!isPrometheusLikeService(serviceName, labels)) {
            // As a very last resort, allow explicit opt-in via annotation
            if (annotations[PROMETHEUS_ANNOTATION_SCRAPE] !== 'true') continue;
          }

          // Determine scheme and port
          const ports = service.spec?.ports || [];
          const preferredPortNames = [
            'web',
            'http',
            'prometheus',
            'http-web',
            'http-query',
            'query',
          ];
          let chosenPort: V1ServicePort | undefined =
            ports.find((p) => p.name && preferredPortNames.includes(p.name)) || ports[0];

          if (!chosenPort) {
            this.logger?.debug?.(
              `Skipping ${serviceNamespace}/${serviceName} - no ports available`,
            );
            continue;
          }

          const isHttpsAnnotation =
            (annotations['prometheus.io/scheme'] || '').toLowerCase() === 'https';
          const isHttpsByName = (chosenPort.name || '').toLowerCase().includes('https');
          const isHttpsByPort = chosenPort.port === 443 || chosenPort.port === 8443;
          const scheme: 'http' | 'https' =
            isHttpsAnnotation || isHttpsByName || isHttpsByPort ? 'https' : 'http';

          // Skip headless services with no ClusterIP
          if (!clusterIP || clusterIP === 'None') {
            this.logger?.debug?.(
              `Skipping ${serviceNamespace}/${serviceName} - headless or no ClusterIP`,
            );
            continue;
          }

          // Determine kind heuristic
          const lower = serviceName.toLowerCase();
          const kind: PrometheusTarget['kind'] = lower.includes('thanos')
            ? 'thanos'
            : lower.includes('victoria') || lower.includes('vm')
              ? 'victoriametrics'
              : 'prometheus';

          const baseUrl = `${scheme}://${clusterIP}:${chosenPort.port}`;
          const newTarget: PrometheusTarget = {
            url: baseUrl,
            serviceName,
            namespace: serviceNamespace,
            port: chosenPort.port,
            scheme,
            kind,
          };
          newTargets.push(newTarget);
          this.logger?.debug?.(
            `Discovered ${newTarget.kind} target: ${baseUrl} from service ${serviceNamespace}/${serviceName}`,
          );
        }
      }
    } catch (error: any) {
      this.logger?.error(`Error discovering Prometheus targets: ${error.message}`, error);
    }

    this.discoveredPrometheusTargets = newTargets;
    this.logger?.debug?.(
      `Prometheus target discovery finished. Found ${newTargets.length} targets.`,
    );
    return this.discoveredPrometheusTargets;
  }

  /**
   * Queries a single Prometheus target.
   * @param target The Prometheus target to query.
   * @param promqlQuery The PromQL query string.
   * @returns A promise that resolves to the parsed JSON response from Prometheus.
   */
  public async queryPrometheusTarget(
    target: PrometheusTarget,
    promqlQuery: string,
  ): Promise<any | null> {
    const rawQueryUrl = `${target.url.replace(/\/$/, '')}/api/v1/query?query=${encodeURIComponent(promqlQuery)}`;
    this.logger?.debug?.(`Querying Prometheus target: ${rawQueryUrl}`);

    return new Promise((resolve, _reject) => {
      const parsedUrl = new URL(rawQueryUrl);
      const options = {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        rejectUnauthorized: false,
      };

      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.request(parsedUrl, options, (res) => {
        let rawData = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          rawData += chunk;
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsedData = JSON.parse(rawData);
              this.logger?.debug?.(
                `Successfully queried Prometheus target ${target.url} for query: ${promqlQuery}`,
              );
              resolve(parsedData);
            } catch (parseError: any) {
              this.logger?.error(
                `Error parsing JSON response from ${target.url}: ${parseError.message}`,
                parseError,
              );
              resolve(null); // Or reject, depending on desired error handling for parsing issues
            }
          } else {
            this.logger?.error(
              `Error querying Prometheus target ${target.url}: ${res.statusCode} ${res.statusMessage}`,
            );
            this.logger?.error(`Prometheus error response body: ${rawData}`);
            resolve(null); // Or reject for HTTP errors
          }
        });
      });

      req.on('error', (error: any) => {
        this.logger?.error(
          `Exception querying Prometheus target ${target.url}: ${error.message}`,
          error,
        );
        resolve(null); // Or reject for request errors
      });

      req.end();
    });
  }

  /**
   * Fetches metrics from all discovered Prometheus targets for a given query.
   * This is a high-level method that would orchestrate discovery and querying.
   * @param promqlQuery The PromQL query to execute on all targets.
   * @returns A promise that resolves to an array of results from each target.
   */
  public async getPrometheusMetrics(promqlQuery: string): Promise<any[]> {
    if (this.discoveredPrometheusTargets.length === 0) {
      this.logger?.debug?.('No Prometheus targets discovered. Attempting discovery now.');
      await this.discoverPrometheusTargets(); // Discover if not already done
      if (this.discoveredPrometheusTargets.length === 0) {
        this.logger?.warn(
          'Still no Prometheus targets found after discovery. Cannot query metrics.',
        );
        return [];
      }
    }

    const allResults: any[] = [];
    for (const target of this.discoveredPrometheusTargets) {
      const result = await this.queryPrometheusTarget(target, promqlQuery);
      if (result) {
        // Push raw result to simplify downstream normalization logic
        allResults.push(result);
      }
    }
    return allResults;
  }

  // Helper function to parse K8s resource strings like "100m" or "128974848n" for CPU
  // and "64Mi" or "128974848" for memory into numerical values (cores and bytes).
  private parseK8sCpuString(cpuString?: string): number | undefined {
    if (!cpuString) return undefined;
    let value: number;
    if (cpuString.endsWith('n')) {
      // nanocores
      value = parseFloat(cpuString) / 1e9;
    } else if (cpuString.endsWith('u')) {
      // microcores
      value = parseFloat(cpuString) / 1e6;
    } else if (cpuString.endsWith('m')) {
      // millicores
      value = parseFloat(cpuString) / 1e3;
    } else {
      value = parseFloat(cpuString); // Assuming cores
    }
    return isNaN(value) ? undefined : value; // Return undefined if parsing failed
  }

  private parseK8sMemoryString(memoryString?: string): number | undefined {
    if (!memoryString) return undefined;
    const suffixes: Record<string, number> = {
      Ki: 1024,
      Mi: 1024 ** 2,
      Gi: 1024 ** 3,
      Ti: 1024 ** 4,
      Pi: 1024 ** 5,
      Ei: 1024 ** 6,
      K: 1000,
      M: 1000 ** 2,
      G: 1000 ** 3,
      T: 1000 ** 4,
      P: 1000 ** 5,
      E: 1000 ** 6,
    };
    const match = memoryString.match(/^(\d+\.?\d*|\.\d+)([KMGTPE]i?)?$/); // Allow decimals
    if (!match) {
      const numericValue = parseFloat(memoryString);
      return isNaN(numericValue) ? undefined : numericValue; // Assuming bytes if no suffix and numeric
    }

    const value = parseFloat(match[1]);
    if (isNaN(value)) return undefined; // Parsing of numeric part failed

    const suffix = match[2];

    if (suffix && suffixes[suffix]) {
      return value * suffixes[suffix];
    }
    return value; // Bytes
  }

  /**
   * Normalizes and merges metrics from different sources.
   * This is a placeholder and will need actual implementation logic.
   * @param nodeMetricsRaw Raw node metrics from Metrics Server.
   * @param podMetricsRaw Raw pod metrics from Metrics Server.
   * @param prometheusMetricsRaw Raw metrics from Prometheus (array of results from getPrometheusMetrics).
   * @param allPodsRaw Optional: Full pod list for enrichment
   * @returns An object containing lists of normalized node and pod metrics.
   */
  public async normalizeAndMergeMetrics(
    nodeMetricsRaw: NodeMetricsList | null,
    podMetricsRaw: PodMetricsList | null,
    prometheusMetricsRaw: any[], // This will be an array of Prometheus query results
    allPodsRaw?: V1PodList | null, // Optional: Full pod list for enrichment
  ): Promise<{
    nodesMetrics: NormalizedNodeMetric[];
    podsMetrics: NormalizedPodMetric[];
    error?: string;
  }> {
    this.logger?.debug?.('Starting metrics normalization and merging...');
    const normalizedNodes: NormalizedNodeMetric[] = [];
    const normalizedPods: NormalizedPodMetric[] = [];

    try {
      // Add a try-catch block for the whole normalization process
      // Create a map for quick pod spec lookup if allPodsRaw is provided
      const podSpecMap = new Map<string, V1Pod>();
      if (allPodsRaw && allPodsRaw.items) {
        for (const pod of allPodsRaw.items) {
          if (pod.metadata?.uid) {
            podSpecMap.set(pod.metadata.uid, pod);
          }
        }
      }

      // Normalize NodeMetrics from Metrics Server
      if (nodeMetricsRaw && Array.isArray(nodeMetricsRaw.items)) {
        for (const rawNode of nodeMetricsRaw.items) {
          normalizedNodes.push({
            name: rawNode.metadata.name,
            uid: rawNode.metadata.name, // Use name as fallback UID
            timestamp: rawNode.timestamp,
            window: rawNode.window,
            usage: {
              cpuCores: this.parseK8sCpuString(rawNode.usage.cpu),
              memoryBytes: this.parseK8sMemoryString(rawNode.usage.memory),
            },
            customMetrics: [], // Initialize for Prometheus metrics
          });
        }
      }

      // Normalize PodMetrics from Metrics Server
      if (podMetricsRaw && Array.isArray(podMetricsRaw.items)) {
        for (const rawPod of podMetricsRaw.items) {
          const containers: NormalizedContainerMetric[] = rawPod.containers.map((c) => ({
            name: c.name,
            usage: {
              cpuCores: this.parseK8sCpuString(c.usage.cpu),
              memoryBytes: this.parseK8sMemoryString(c.usage.memory),
            },
          }));

          // Sum container usage for pod-level usage if not directly available or to ensure consistency
          const podUsage: NormalizedResourceUsage = containers.reduce(
            (acc, curr) => {
              return {
                cpuCores: (acc.cpuCores || 0) + (curr.usage.cpuCores || 0),
                memoryBytes: (acc.memoryBytes || 0) + (curr.usage.memoryBytes || 0),
              };
            },
            { cpuCores: 0, memoryBytes: 0 },
          );

          // Use name and namespace as fallback UID
          const podUID = `${rawPod.metadata.namespace || 'default'}:${rawPod.metadata.name}`;
          let nodeNameFromSpec: string | undefined = undefined;

          if (podUID) {
            // Try to find matching pod spec by UID if available
            const podSpec = podSpecMap.get(podUID);
            if (podSpec) {
              nodeNameFromSpec = podSpec.spec?.nodeName;
            } else {
              // Fallback: try to match by name and namespace if UID from metrics isn't reliable
              if (
                allPodsRaw &&
                allPodsRaw.items &&
                rawPod.metadata.name &&
                rawPod.metadata.namespace
              ) {
                const fallbackPodSpec = allPodsRaw.items.find(
                  (p) =>
                    p.metadata?.name === rawPod.metadata.name &&
                    p.metadata?.namespace === rawPod.metadata.namespace,
                );
                if (fallbackPodSpec) {
                  nodeNameFromSpec = fallbackPodSpec.spec?.nodeName;
                }
              }
            }
          }

          normalizedPods.push({
            name: rawPod.metadata.name,
            namespace: rawPod.metadata.namespace || 'unknown',
            uid: podUID,
            nodeName: nodeNameFromSpec,
            timestamp: rawPod.timestamp,
            window: rawPod.window,
            usage: podUsage,
            containers: containers,
            customMetrics: [], // Initialize for Prometheus metrics
          });
        }
      }

      // TODO: Implement merging of Prometheus metrics
      // This will involve iterating prometheusMetricsRaw, parsing PromQL results,
      // and matching them to the correct normalizedNodes or normalizedPods based on labels (e.g., node name, pod name, namespace).
      this.logger?.debug?.(`Prometheus metrics to merge: ${prometheusMetricsRaw.length} results.`);
      for (const promResult of prometheusMetricsRaw) {
        if (
          promResult &&
          promResult.status === 'success' &&
          promResult.data &&
          promResult.data.result
        ) {
          for (const metric of promResult.data.result) {
            // --- Map Prometheus resultType to accepted metric kinds -----------------
            const metricTypeMap: Record<string, NormalizedCustomMetric['type']> = {
              gauge: 'gauge',
              counter: 'counter',
              histogram: 'histogram',
              summary: 'summary',
              untyped: 'untyped',
              vector: 'gauge',
              matrix: 'gauge',
              scalar: 'gauge',
              string: 'untyped',
            };
            const mappedType =
              metricTypeMap[(promResult.data.resultType as string) ?? ''] ?? 'untyped';
            const metricName = metric.metric.__name__ || 'unknown_metric';

            // Prometheus instant vector: metric.value = [ts, val]
            // Range vector (matrix): metric.values = [[ts, val], ...] – take last sample
            let sampleValue: string | number | undefined = undefined;
            if (Array.isArray(metric.value)) {
              sampleValue = metric.value[1];
            } else if (Array.isArray(metric.values) && metric.values.length > 0) {
              const last = metric.values[metric.values.length - 1];
              sampleValue = last?.[1];
            }
            const valueParsed = parseFloat(String(sampleValue));
            if (Number.isNaN(valueParsed)) {
              // Skip this metric if the value isn't a finite number
              continue;
            }
            const value = valueParsed;
            const labels = { ...metric.metric };
            delete labels.__name__;

            const customMetric: NormalizedCustomMetric = {
              name: metricName,
              value: value,
              labels: labels,
              type: mappedType,
            };

            // Example: Attempt to match to a node
            if (labels.node) {
              const node = normalizedNodes.find((n) => n.name === labels.node);
              if (node) {
                node.customMetrics?.push(customMetric);
              }
            } else if (labels.pod_name && labels.namespace) {
              // Or a pod
              const pod = normalizedPods.find(
                (p) => p.name === labels.pod_name && p.namespace === labels.namespace,
              );
              if (pod) {
                pod.customMetrics?.push(customMetric);
              }
            } else if (labels.pod && labels.namespace) {
              // k8s_pod_name from cAdvisor via Prometheus
              const pod = normalizedPods.find(
                (p) => p.name === labels.pod && p.namespace === labels.namespace,
              );
              if (pod) {
                pod.customMetrics?.push(customMetric);
              }
            }
            // Add more matching logic as needed based on common Prometheus label conventions for K8s
          }
        }
      }

      this.logger?.debug?.('Metrics normalization and merging finished.');
      return { nodesMetrics: normalizedNodes, podsMetrics: normalizedPods };
    } catch (error: any) {
      this.logger?.error(
        `Critical error during metrics normalization and merging: ${error.message}`,
        error,
      );
      // Depending on desired behavior, might re-throw or return empty/partial normalized lists
      // For now, return empty lists to indicate failure but not crash the caller.
      return { nodesMetrics: [], podsMetrics: [], error: error.message };
    }
  }

  /**
   * Build a compact, LLM-friendly cluster resource summary from normalized metrics
   */
  public buildLLMSummary(
    nodes: NormalizedNodeMetric[] = [],
    pods: NormalizedPodMetric[] = [],
    topN: number = 5,
  ): any {
    const totalNodeCpu = nodes.reduce((acc, n) => acc + (n.usage.cpuCores || 0), 0);
    const totalNodeMem = nodes.reduce((acc, n) => acc + (n.usage.memoryBytes || 0), 0);

    const podsByCpu = [...pods]
      .map((p) => ({
        name: p.name,
        namespace: p.namespace,
        nodeName: p.nodeName,
        cpuCores: p.usage.cpuCores || 0,
        memoryBytes: p.usage.memoryBytes || 0,
      }))
      .sort((a, b) => b.cpuCores - a.cpuCores)
      .slice(0, topN);

    const podsByMem = [...pods]
      .map((p) => ({
        name: p.name,
        namespace: p.namespace,
        nodeName: p.nodeName,
        cpuCores: p.usage.cpuCores || 0,
        memoryBytes: p.usage.memoryBytes || 0,
      }))
      .sort((a, b) => b.memoryBytes - a.memoryBytes)
      .slice(0, topN);

    // Aggregate usage per namespace
    const nsAgg: Record<string, { cpuCores: number; memoryBytes: number; podCount: number }> = {};
    for (const p of pods) {
      const key = p.namespace || 'unknown';
      if (!nsAgg[key]) nsAgg[key] = { cpuCores: 0, memoryBytes: 0, podCount: 0 };
      nsAgg[key].cpuCores += p.usage.cpuCores || 0;
      nsAgg[key].memoryBytes += p.usage.memoryBytes || 0;
      nsAgg[key].podCount += 1;
    }
    const namespaces = Object.entries(nsAgg)
      .map(([ns, v]) => ({ namespace: ns, ...v }))
      .sort((a, b) => b.cpuCores - a.cpuCores)
      .slice(0, Math.min(topN, Object.keys(nsAgg).length));

    return {
      totals: {
        nodeCpuCores: totalNodeCpu,
        nodeMemoryBytes: totalNodeMem,
        nodeCount: nodes.length,
        podCount: pods.length,
      },
      topPodsByCpu: podsByCpu,
      topPodsByMemory: podsByMem,
      topNamespacesByCpu: namespaces,
    };
  }

  /**
   * Fetches all relevant metrics (Metrics Server, Prometheus), optionally enriches with pod specs,
   * and returns them in a normalized and merged format.
   *
   * This is a high-level convenience method.
   *
   * @param prometheusQueries An array of PromQL queries to execute against discovered Prometheus targets.
   * @param fetchPodSpecs If true, fetches all pod specifications to enrich normalized pod metrics with nodeName. Defaults to true.
   * @param discoveryNamespace Optional namespace to restrict Prometheus discovery and pod spec fetching.
   * @returns A promise that resolves to an object containing lists of normalized node and pod metrics.
   */
  public async getAllNormalizedMetrics(
    prometheusQueries: string[],
    fetchPodSpecs: boolean = true,
    discoveryNamespace?: string,
  ): Promise<{
    nodesMetrics: NormalizedNodeMetric[];
    podsMetrics: NormalizedPodMetric[];
    error?: string;
  }> {
    this.logger?.debug?.(
      'Starting high-level metric gathering using sequential sources (Metrics API ➔ Prometheus ➔ Kubelet)...',
    );

    /* -----------------------------------------------------------
     * 0) Optionally fetch full Pod specs for later enrichment
     * -------------------------------------------------------- */
    let allPodsRaw: V1PodList | null = null;
    if (fetchPodSpecs) {
      try {
        this.logger?.debug?.('Fetching all pod specs for enrichment...');
        if (discoveryNamespace) {
          if (typeof this.k8sClient.core.listNamespacedPod === 'function') {
            allPodsRaw = await this.k8sClient.core.listNamespacedPod({
              namespace: discoveryNamespace,
            });
          } else {
            this.logger?.warn(
              'this.k8sClient.core.listNamespacedPod is not a function. Skipping pod spec fetch.',
            );
          }
        } else {
          if (typeof this.k8sClient.core.listPodForAllNamespaces === 'function') {
            allPodsRaw = await this.k8sClient.core.listPodForAllNamespaces();
          } else {
            this.logger?.warn(
              'this.k8sClient.core.listPodForAllNamespaces is not a function. Skipping pod spec fetch.',
            );
          }
        }
        this.logger?.debug?.(`Fetched ${allPodsRaw?.items?.length || 0} pod specs.`);
      } catch (error: any) {
        this.logger?.error(`Error fetching pod specs: ${error.message}`, error);
      }
    }

    /* -----------------------------------------------------------
     * 1) Metrics Server (/apis/metrics.k8s.io/v1beta1)
     * -------------------------------------------------------- */
    let nodeMetricsRaw = null;
    let podMetricsRaw = null;

    // Try to get node metrics directly via customObjects API
    try {
      this.logger?.debug?.('Attempting to fetch node metrics from metrics.k8s.io API...');
      nodeMetricsRaw = await this.getNodeMetrics();
      if (nodeMetricsRaw) {
        this.logger?.debug?.(
          `Successfully fetched metrics for ${nodeMetricsRaw?.items?.length || 0} nodes.`,
        );
      } else {
        this.logger?.warn('Node metrics API returned null or undefined response.');
      }
    } catch (error: any) {
      this.logger?.warn(`Error fetching node metrics from metrics.k8s.io API: ${error.message}`);
    }

    // If no node metrics yet, try direct API endpoint access for environments where the aggregator
    // path works better (e.g., Rancher Desktop, some managed clusters)
    if (
      !nodeMetricsRaw ||
      (Array.isArray(nodeMetricsRaw.items) && nodeMetricsRaw.items.length === 0)
    ) {
      try {
        this.logger?.debug?.('Attempting direct API endpoint access for node metrics...');
        const directMetrics = await this.k8sClient.getRaw<any>(
          '/apis/metrics.k8s.io/v1beta1/nodes',
        );
        if (directMetrics && directMetrics.items) {
          this.logger?.debug?.(
            `Successfully fetched metrics for ${directMetrics.items.length} nodes via direct API access.`,
          );
          nodeMetricsRaw = directMetrics;
        }
      } catch (directError: any) {
        this.logger?.warn(`Direct API access for node metrics failed: ${directError.message}`);
      }
    }

    // Try to get pod metrics via customObjects API
    try {
      this.logger?.debug?.('Attempting to fetch pod metrics from metrics.k8s.io API...');
      podMetricsRaw = await this.getPodMetricsFromMetricsApi(discoveryNamespace);
      if (podMetricsRaw) {
        this.logger?.debug?.(
          `Successfully fetched metrics for ${podMetricsRaw?.items?.length || 0} pods.`,
        );
      } else {
        this.logger?.warn('Pod metrics API returned null or undefined response.');
      }
    } catch (error: any) {
      this.logger?.warn(`Error fetching pod metrics from metrics.k8s.io API: ${error.message}`);
    }

    // If no pod metrics yet, try direct API endpoint access for environments where the aggregator
    // path works better
    if (
      !podMetricsRaw ||
      (Array.isArray(podMetricsRaw.items) && podMetricsRaw.items.length === 0)
    ) {
      try {
        this.logger?.debug?.('Attempting direct API endpoint access for pod metrics...');
        const apiPath = discoveryNamespace
          ? `/apis/metrics.k8s.io/v1beta1/namespaces/${discoveryNamespace}/pods`
          : '/apis/metrics.k8s.io/v1beta1/pods';
        const directMetrics = await this.k8sClient.getRaw<any>(apiPath);
        if (directMetrics && directMetrics.items) {
          this.logger?.debug?.(
            `Successfully fetched metrics for ${directMetrics.items.length} pods via direct API access.`,
          );
          podMetricsRaw = directMetrics;
        }
      } catch (directError: any) {
        this.logger?.warn(`Direct API access for pod metrics failed: ${directError.message}`);
      }
    }

    const metricsApiHasData =
      (nodeMetricsRaw?.items?.length ?? 0) > 0 || (podMetricsRaw?.items?.length ?? 0) > 0;

    if (metricsApiHasData) {
      this.logger?.debug?.('Returning metrics gathered from metrics.k8s.io API.');
      return this.normalizeAndMergeMetrics(nodeMetricsRaw, podMetricsRaw, [], allPodsRaw);
    }

    /* -----------------------------------------------------------
     * 2) Prometheus (if Metrics Server unavailable)
     * -------------------------------------------------------- */
    await this.discoverPrometheusTargets(discoveryNamespace);

    const prometheusMetricsRaw: any[] = [];
    for (const query of prometheusQueries) {
      const results = await this.getPrometheusMetrics(query);
      if (Array.isArray(results)) {
        prometheusMetricsRaw.push(...results);
      }
    }

    if (prometheusMetricsRaw.length > 0) {
      this.logger?.debug?.('Returning metrics gathered from Prometheus targets.');
      return this.normalizeAndMergeMetrics(null, null, prometheusMetricsRaw, allPodsRaw);
    }

    /* -----------------------------------------------------------
     * 3) Kubelet /stats/summary (final fallback)
     * -------------------------------------------------------- */
    const disableKubelet =
      process.env.KUBE_METRICS_DISABLE_KUBELET === 'true' ||
      process.env.KUBE_METRICS_DISABLE_KUBELET === '1';
    if (disableKubelet) {
      this.logger?.warn(
        'Kubelet summary fallback disabled via KUBE_METRICS_DISABLE_KUBELET. Returning empty lists.',
      );
      return this.normalizeAndMergeMetrics(null, null, [], allPodsRaw);
    }

    const kubeletPodMetrics = await this.getPodMetricsFromKubeletSummary(discoveryNamespace);
    const podMetricsList: PodMetricsList | null =
      kubeletPodMetrics && kubeletPodMetrics.length > 0
        ? {
            kind: 'PodMetricsList',
            apiVersion: 'metrics.k8s.io/v1beta1',
            metadata: {},
            items: kubeletPodMetrics,
          }
        : null;

    if (podMetricsList) {
      this.logger?.debug?.('Returning metrics gathered from kubelet summary fallback.');
    } else {
      this.logger?.warn('Failed to gather metrics from any source; returning empty lists.');
    }

    return this.normalizeAndMergeMetrics(null, podMetricsList, [], allPodsRaw);
  }

  /**
   * Get metrics with specific behavior for clean API calls.
   * This method provides a more direct approach than getAllNormalizedMetrics for direct API access.
   *
   * @param prometheusQueries An array of PromQL queries to execute against discovered Prometheus targets.
   * @param fetchPodSpecs If true, fetches all pod specifications to enrich normalized pod metrics with nodeName. Defaults to true.
   * @param discoveryNamespace Optional namespace to restrict Prometheus discovery and pod spec fetching.
   * @returns A promise that resolves to an object containing lists of normalized node and pod metrics.
   */
  public async getMetricsWithOptions(
    prometheusQueries: string[] = [],
    fetchPodSpecs: boolean = true,
    discoveryNamespace?: string,
    nodeApiPath: string = '/apis/metrics.k8s.io/v1beta1/nodes',
    podApiPath: string = '/apis/metrics.k8s.io/v1beta1/pods',
  ): Promise<{
    normalizedNodes?: NormalizedNodeMetric[];
    normalizedPods?: NormalizedPodMetric[];
    error?: string;
  }> {
    // Try direct API calls first for better performance
    try {
      let nodeMetricsRaw = null;
      let podMetricsRaw = null;
      let allPodsRaw = null;
      let errors: string[] = [];

      // Get node metrics via direct API call
      try {
        nodeMetricsRaw = await this.k8sClient.getRaw<any>(nodeApiPath);
        this.logger?.debug?.(`Successfully fetched node metrics from ${nodeApiPath}`);
      } catch (error: any) {
        const errorMsg = `Failed to get node metrics via API ${nodeApiPath}: ${error.message}`;
        errors.push(errorMsg);
        this.logger?.warn?.(errorMsg);
      }

      // Get pod metrics via direct API call
      const podMetricsPath = discoveryNamespace
        ? `/apis/metrics.k8s.io/v1beta1/namespaces/${discoveryNamespace}/pods`
        : podApiPath;
      try {
        podMetricsRaw = await this.k8sClient.getRaw<any>(podMetricsPath);
        this.logger?.debug?.(`Successfully fetched pod metrics from ${podMetricsPath}`);
      } catch (error: any) {
        const errorMsg = `Failed to get pod metrics via API ${podMetricsPath}: ${error.message}`;
        errors.push(errorMsg);
        this.logger?.warn?.(errorMsg);
      }

      // Get pod specs for enrichment if requested
      if (fetchPodSpecs) {
        try {
          if (discoveryNamespace) {
            allPodsRaw = await this.k8sClient.core.listNamespacedPod({
              namespace: discoveryNamespace,
            });
          } else {
            allPodsRaw = await this.k8sClient.core.listPodForAllNamespaces();
          }
          this.logger?.debug?.(`Successfully fetched pod specs for enrichment`);
        } catch (error: any) {
          const errorMsg = `Failed to get pod specs for enrichment: ${error.message}`;
          errors.push(errorMsg);
          this.logger?.warn?.(errorMsg);
        }
      }

      // If we got metrics, normalize and return them (augmented with Prometheus if requested)
      if (
        (nodeMetricsRaw && nodeMetricsRaw.items && nodeMetricsRaw.items.length > 0) ||
        (podMetricsRaw && podMetricsRaw.items && podMetricsRaw.items.length > 0)
      ) {
        try {
          // Optionally query Prometheus and merge custom metrics
          const prometheusMetricsRaw: any[] = [];
          if (Array.isArray(prometheusQueries) && prometheusQueries.length > 0) {
            try {
              await this.discoverPrometheusTargets(discoveryNamespace);
              for (const q of prometheusQueries) {
                const results = await this.getPrometheusMetrics(q);
                if (Array.isArray(results)) prometheusMetricsRaw.push(...results);
              }
            } catch (e: any) {
              const promErr = `Prometheus enrichment failed: ${e?.message || String(e)}`;
              errors.push(promErr);
              this.logger?.warn?.(promErr);
            }
          }

          const normalized = await this.normalizeAndMergeMetrics(
            nodeMetricsRaw,
            podMetricsRaw,
            prometheusMetricsRaw,
            allPodsRaw,
          );

          // Include partial errors if any occurred during API calls
          const combinedError =
            errors.length > 0
              ? normalized.error
                ? `${normalized.error}; Additional errors: ${errors.join('; ')}`
                : errors.join('; ')
              : normalized.error;

          return {
            normalizedNodes: normalized.nodesMetrics,
            normalizedPods: normalized.podsMetrics,
            error: combinedError,
          };
        } catch (normalizationError: any) {
          this.logger?.error?.(`Error during metrics normalization: ${normalizationError.message}`);
          return {
            normalizedNodes: [],
            normalizedPods: [],
            error: `Normalization failed: ${normalizationError.message}${errors.length > 0 ? `; API errors: ${errors.join('; ')}` : ''}`,
          };
        }
      }

      // If no direct metrics available, log collected errors and try fallback
      if (errors.length > 0) {
        this.logger?.warn?.(
          `Direct API calls failed, attempting fallback. Errors: ${errors.join('; ')}`,
        );
      }

      // Fallback: try the high-level getAllNormalizedMetrics method
      try {
        const safeDiscoveryNamespace =
          typeof discoveryNamespace === 'string' ? discoveryNamespace : undefined;
        const metrics = await this.getAllNormalizedMetrics(
          prometheusQueries,
          fetchPodSpecs,
          safeDiscoveryNamespace,
        );

        // Include errors from direct API attempts if fallback succeeds
        const combinedError =
          errors.length > 0
            ? metrics.error
              ? `${metrics.error}; Direct API errors: ${errors.join('; ')}`
              : `Direct API errors (fallback used): ${errors.join('; ')}`
            : metrics.error;

        return {
          normalizedNodes: metrics.nodesMetrics,
          normalizedPods: metrics.podsMetrics,
          error: combinedError,
        };
      } catch (fallbackError: any) {
        this.logger?.error?.(`Fallback method also failed: ${fallbackError.message}`);
        return {
          normalizedNodes: [],
          normalizedPods: [],
          error: `All methods failed. Direct API errors: ${errors.join('; ')}; Fallback error: ${fallbackError.message}`,
        };
      }
    } catch (error: any) {
      this.logger?.error?.(`Critical error in getMetricsWithOptions: ${error.message}`);
      return {
        normalizedNodes: [],
        normalizedPods: [],
        error: `Critical error: ${error.message}`,
      };
    }
  }

  /**
   * Parse CPU value to nanocores for consistent summing
   * Public method for use by tools that need raw nanocores values
   */
  public parseCpuValueToNanocores(cpuString: string): number {
    if (!cpuString) return 0;

    // Handle different CPU units
    if (cpuString.endsWith('n')) {
      return parseInt(cpuString.slice(0, -1), 10);
    } else if (cpuString.endsWith('u')) {
      return parseInt(cpuString.slice(0, -1), 10) * 1000;
    } else if (cpuString.endsWith('m')) {
      return parseInt(cpuString.slice(0, -1), 10) * 1000000;
    } else {
      // Assume cores, convert to nanocores
      return parseFloat(cpuString) * 1000000000;
    }
  }

  /**
   * Parse memory value to bytes for consistent summing
   * Public method for use by tools that need raw bytes values
   */
  public parseMemoryValueToBytes(memoryString: string): number {
    if (!memoryString) return 0;

    const value = parseInt(memoryString.replace(/[^\d]/g, ''), 10);

    if (memoryString.includes('Ki')) {
      return value * 1024;
    } else if (memoryString.includes('Mi')) {
      return value * 1024 * 1024;
    } else if (memoryString.includes('Gi')) {
      return value * 1024 * 1024 * 1024;
    } else if (memoryString.includes('Ti')) {
      return value * 1024 * 1024 * 1024 * 1024;
    } else {
      // Assume bytes
      return value;
    }
  }

  // TODO: Implement data normalization and merging
  // TODO: Implement caching and throttling
  // TODO: Integrate with AnalysisEngine
}

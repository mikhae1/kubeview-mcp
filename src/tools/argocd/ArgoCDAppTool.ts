import { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as https from 'https';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { PodOperations } from '../../kubernetes/resources/PodOperations.js';
import { toMcpToolResult } from '../../utils/McpToolResult.js';
import {
  ArgoCDBaseTool,
  ArgoCDCommonSchemas,
  executeArgoCDCommand,
  validateArgoCDCLI,
} from './BaseTool.js';

function buildKubernetesClientFromEnv(): KubernetesClient {
  const context = process.env.MCP_KUBE_CONTEXT;
  const skipTlsEnv = process.env.MCP_K8S_SKIP_TLS_VERIFY;
  const skipTlsVerify = skipTlsEnv === 'true' || skipTlsEnv === '1';

  return new KubernetesClient({
    context: context && context.trim().length > 0 ? context.trim() : undefined,
    skipTlsVerify,
  });
}

function isRecoverableK8sError(error: any): boolean {
  const statusCode = error?.statusCode ?? error?.response?.statusCode;
  if (statusCode === 404 || statusCode === 403 || statusCode === 401) return true;
  const code = error?.body?.code;
  if (code === 404 || code === 403 || code === 401) return true;
  const reason = error?.body?.reason;
  if (reason === 'NotFound' || reason === 'Forbidden' || reason === 'Unauthorized') return true;
  return false;
}

function defaultArgoCDNamespace(): string {
  const ns = process.env.MCP_ARGOCD_NAMESPACE;
  return ns && ns.trim().length > 0 ? ns.trim() : 'argocd';
}

function markTransport<T>(value: T, transport: 'k8s' | 'cli' | 'api'): T {
  if (value && typeof value === 'object') {
    Object.defineProperty(value as any, '__transport', {
      value: transport,
      enumerable: false,
      configurable: true,
    });
  }
  return value;
}

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

async function listApplicationsViaK8s(params: any): Promise<any> {
  const client = params?.client as KubernetesClient;
  await client.refreshCurrentContext();

  const group = 'argoproj.io';
  const version = 'v1alpha1';
  const plural = 'applications';
  const labelSelector = params?.labelSelector || params?.selector;
  const namespace = defaultArgoCDNamespace();

  const resp = (await client.customObjects.listNamespacedCustomObject({
    group,
    version,
    namespace,
    plural,
    labelSelector,
  })) as any;

  const body = (resp?.body ?? resp) as any;
  const items = Array.isArray(body?.items) ? body.items : [];
  let filtered = items;

  if (params?.project) {
    filtered = filtered.filter(
      (a: any) => String(a?.spec?.project || '') === String(params.project),
    );
  }

  if (params?.cluster) {
    filtered = filtered.filter(
      (a: any) => String(a?.spec?.destination?.server || '') === String(params.cluster),
    );
  }

  if (params?.namespace) {
    filtered = filtered.filter(
      (a: any) => String(a?.spec?.destination?.namespace || '') === String(params.namespace),
    );
  }

  if (params?.repo) {
    filtered = filtered.filter(
      (a: any) => String(a?.spec?.source?.repoURL || '') === String(params.repo),
    );
  }

  if (params?.health) {
    filtered = filtered.filter(
      (a: any) => String(a?.status?.health?.status || '') === String(params.health),
    );
  }

  if (params?.sync) {
    filtered = filtered.filter(
      (a: any) => String(a?.status?.sync?.status || '') === String(params.sync),
    );
  }

  return { ...body, items: filtered };
}

async function getApplicationViaK8s(appName: string, client: KubernetesClient): Promise<any> {
  await client.refreshCurrentContext();

  const group = 'argoproj.io';
  const version = 'v1alpha1';
  const plural = 'applications';
  const namespace = defaultArgoCDNamespace();

  const resp = (await client.customObjects.getNamespacedCustomObject({
    group,
    version,
    namespace,
    plural,
    name: appName,
  })) as any;
  return (resp?.body ?? resp) as any;
}

function filterApplicationResources(resources: any[], params: any): any[] {
  let filtered = Array.isArray(resources) ? resources : [];

  if (params?.group) {
    filtered = filtered.filter((r: any) => String(r?.group || '') === String(params.group));
  }
  if (params?.kind) {
    filtered = filtered.filter((r: any) => String(r?.kind || '') === String(params.kind));
  }
  if (params?.name) {
    filtered = filtered.filter((r: any) => String(r?.name || '') === String(params.name));
  }
  if (params?.namespace) {
    filtered = filtered.filter((r: any) => String(r?.namespace || '') === String(params.namespace));
  }
  if (params?.health) {
    const desired = String(params.health);
    filtered = filtered.filter(
      (r: any) => String(r?.health?.status || r?.health || '') === desired,
    );
  }
  if (params?.sync) {
    const desired = String(params.sync);
    filtered = filtered.filter((r: any) => String(r?.status || r?.sync || '') === desired);
  }

  return filtered;
}

async function fetchLogsViaK8s(params: any, client: KubernetesClient): Promise<string> {
  await client.refreshCurrentContext();
  const podOps = new PodOperations(client);

  const namespace = params.namespace;
  const appName = params.appName;

  let pods: any[] = [];

  // 1. If specific pod name provided
  if (params.name && (!params.kind || params.kind === 'Pod')) {
    if (namespace) {
      try {
        const pod = await podOps.get(params.name, { namespace });
        if (pod) pods = [pod];
      } catch {
        // ignore not found
      }
    } else {
      const allPodsList = await podOps.list();
      const found = allPodsList.items.find((p: any) => p.metadata?.name === params.name);
      if (found) pods = [found];
    }
  } else {
    // 2. Search for pods matching the application
    const labelSelector = `app.kubernetes.io/instance=${appName}`;
    const listOptions = {
      namespace,
      labelSelector,
    };

    const res = await podOps.list(listOptions);
    pods = res.items;
  }

  if (pods.length === 0) {
    throw new Error(
      `No pods found for application "${appName}" via Kubernetes API (label selector: app.kubernetes.io/instance=${appName})`,
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

async function fetchLogsViaApi(params: any): Promise<string> {
  const server = params.server || process.env.ARGOCD_SERVER;
  const token = params.authToken || process.env.ARGOCD_AUTH_TOKEN;

  if (!server || !token) {
    throw new Error('Server and token are required for API access');
  }

  const protocol = params.insecure || params.plaintext ? 'http' : 'https';
  const baseUrl = `${protocol}://${server}`;
  const agent = new https.Agent({
    rejectUnauthorized: !params.insecure,
  });

  const headers = {
    Authorization: `Bearer ${token}`,
  };

  // Helper to fetch logs for a specific pod
  const fetchPodLogs = async (podName: string, namespace: string): Promise<string> => {
    const queryParams = new URLSearchParams();
    if (params.container) queryParams.append('container', params.container);
    if (params.tail || params.tailLines) {
      queryParams.append('tailLines', String(params.tail || params.tailLines));
    }
    if (params.since) {
      try {
        const sinceSeconds = parseDurationToSeconds(params.since);
        queryParams.append('sinceSeconds', String(sinceSeconds));
      } catch {
        // ignore invalid duration
      }
    }
    if (params.sinceTime) queryParams.append('sinceTime', params.sinceTime);
    if (params.previous) queryParams.append('previous', 'true');
    if (params.timestamps) queryParams.append('timestamps', 'true');
    if (namespace) queryParams.append('namespace', namespace);

    const url = `${baseUrl}/api/v1/applications/${params.appName}/pods/${podName}/logs?${queryParams.toString()}`;

    try {
      const response = await fetch(url, {
        headers,
        agent: params.insecure ? agent : undefined,
      } as any);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`API Error ${response.status}: ${text}`);
      }
      return await response.text();
    } catch (error) {
      console.error(`Failed to fetch logs for pod ${podName}:`, error);
      return `Error fetching logs for ${podName}: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  // If resource name is provided, try to fetch logs directly
  if (params.name && (!params.kind || params.kind === 'Pod')) {
    return await fetchPodLogs(params.name, params.namespace || '');
  }

  // Otherwise, we need to discover pods for the app
  const treeUrl = `${baseUrl}/api/v1/applications/${params.appName}/resource-tree`;
  const treeResponse = await fetch(treeUrl, {
    headers,
    agent: params.insecure ? agent : undefined,
  } as any);

  if (!treeResponse.ok) {
    throw new Error(`Failed to fetch resource tree: ${treeResponse.statusText}`);
  }

  const treeData = (await treeResponse.json()) as any;
  const nodes = treeData.nodes || [];

  // Filter for Pods
  const pods = nodes.filter(
    (node: any) =>
      node.kind === 'Pod' &&
      (!params.group || node.group === params.group) &&
      (!params.namespace || node.namespace === params.namespace),
  );

  if (pods.length === 0) {
    return 'No pods found for application.';
  }

  // Fetch logs for all pods concurrently
  const logs = await Promise.all(pods.map((pod: any) => fetchPodLogs(pod.name, pod.namespace)));

  return logs.join('\n');
}

/**
 * ArgoCD app tool: list, get, resources, logs, history, status
 */
export class ArgoCDAppTool implements ArgoCDBaseTool {
  tool: Tool = {
    name: 'argocd_app',
    description:
      'Get Argo CD applications data (similar to `argocd app`): list|get|resources|logs|history|status.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: 'Operation to perform: list, get, resources, logs, history, or status',
          enum: ['list', 'get', 'resources', 'logs', 'history', 'status'],
        },
        appName: { ...ArgoCDCommonSchemas.appName, optional: true },
        outputFormat: {
          type: 'string',
          description: 'Output format: json, yaml, wide, tree, or name',
          enum: ['json', 'yaml', 'wide', 'tree', 'name'],
          optional: true,
          default: 'json',
        },
        // list filters
        labelSelector: ArgoCDCommonSchemas.labelSelector,
        selector: ArgoCDCommonSchemas.selector,
        project: { type: 'string', description: 'Filter by project name', optional: true },
        cluster: { type: 'string', description: 'Filter by cluster name', optional: true },
        namespace: { type: 'string', description: 'Filter by target namespace', optional: true },
        repo: { type: 'string', description: 'Filter by repository URL', optional: true },
        health: {
          type: 'string',
          description: 'Filter by health status',
          enum: ['Healthy', 'Progressing', 'Degraded', 'Suspended', 'Missing', 'Unknown'],
          optional: true,
        },
        sync: {
          type: 'string',
          description: 'Filter by sync status',
          enum: ['Synced', 'OutOfSync', 'Unknown'],
          optional: true,
        },
        // flags
        server: ArgoCDCommonSchemas.server,
        grpcWeb: ArgoCDCommonSchemas.grpcWeb,
        plaintext: ArgoCDCommonSchemas.plaintext,
        insecure: ArgoCDCommonSchemas.insecure,
        refresh: {
          type: 'boolean',
          description: 'Refresh application data when retrieving',
          optional: true,
        },
        hardRefresh: {
          type: 'boolean',
          description: 'Refresh application data and ignore cache',
          optional: true,
        },
        // resources filters
        group: { type: 'string', description: 'Filter by resource group', optional: true },
        kind: {
          type: 'string',
          description: 'Filter by resource kind (e.g., Pod, Deployment)',
          optional: true,
        },
        name: { type: 'string', description: 'Filter by resource name', optional: true },
        // logs options
        container: {
          type: 'string',
          description: 'Container name to get logs from',
          optional: true,
        },
        follow: { type: 'boolean', description: 'Follow the logs stream', optional: true },
        previous: {
          type: 'boolean',
          description: 'Get logs from previous container instance',
          optional: true,
        },
        since: {
          type: 'string',
          description: 'Show logs newer than this duration (e.g., "1h", "30m")',
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
        tailLines: { type: 'number', description: 'Alias for tail', optional: true },
        timestamps: {
          type: 'boolean',
          description: 'Include timestamps in the log output',
          optional: true,
        },
        authToken: {
          type: 'string',
          description: 'ArgoCD authentication token for API access',
          optional: true,
        },
      },
      required: ['operation'],
    },
  };

  async execute(params: any, client?: KubernetesClient): Promise<any> {
    const {
      operation,
      appName,
      outputFormat,
      selector,
      project,
      cluster,
      namespace,
      repo,
      health,
      sync,
      server,
      grpcWeb,
      plaintext,
      insecure,
      refresh,
      hardRefresh,
      group,
      kind,
      name,
      container,
      follow,
      previous,
      since,
      sinceTime,
      tail,
      tailLines,
      timestamps,
    } = params || {};

    const labelSelector = params?.labelSelector || selector;

    const effectiveOutputFormat = outputFormat || 'json';

    if (operation === 'list' && effectiveOutputFormat === 'json') {
      try {
        const k8sClient = client || buildKubernetesClientFromEnv();
        return toMcpToolResult(
          markTransport(await listApplicationsViaK8s({ ...params, client: k8sClient }), 'k8s'),
        );
      } catch {
        // Fallback to CLI
      }
    }

    if (operation === 'get' && appName && effectiveOutputFormat === 'json') {
      try {
        const k8sClient = client || buildKubernetesClientFromEnv();
        return toMcpToolResult(
          markTransport(await getApplicationViaK8s(appName, k8sClient), 'k8s'),
        );
      } catch {
        // Fallback to CLI
      }
    }

    if (operation === 'resources' && appName && effectiveOutputFormat === 'json') {
      try {
        const k8sClient = client || buildKubernetesClientFromEnv();
        const app = await getApplicationViaK8s(appName, k8sClient);
        const resources = filterApplicationResources(app?.status?.resources || [], params);
        return toMcpToolResult(markTransport({ appName, resources }, 'k8s'));
      } catch {
        // Fallback to CLI
      }
    }

    if (operation === 'history' && appName && effectiveOutputFormat === 'json') {
      try {
        const k8sClient = client || buildKubernetesClientFromEnv();
        const app = await getApplicationViaK8s(appName, k8sClient);
        return toMcpToolResult(
          markTransport(
            { appName, history: Array.isArray(app?.status?.history) ? app.status.history : [] },
            'k8s',
          ),
        );
      } catch {
        // Fallback to CLI
      }
    }

    if (operation === 'status' && appName && effectiveOutputFormat === 'json') {
      try {
        const k8sClient = client || buildKubernetesClientFromEnv();
        const app = await getApplicationViaK8s(appName, k8sClient);
        return toMcpToolResult(
          markTransport(
            {
              appName,
              health: app?.status?.health,
              sync: app?.status?.sync,
              conditions: app?.status?.conditions,
              operationState: app?.status?.operationState,
              reconciledAt: app?.status?.reconciledAt,
              summary: app?.status?.summary,
            },
            'k8s',
          ),
        );
      } catch {
        // Fallback to CLI
      }
    }

    if (operation === 'logs' && appName) {
      const tailLinesValue = tailLines ?? tail;

      // 1. Try Kubernetes API first (Direct access, no ArgoCD auth needed if we have kubeconfig)
      try {
        const k8sClient = client || buildKubernetesClientFromEnv();
        const text = await fetchLogsViaK8s({ ...params, tail: tailLinesValue }, k8sClient);
        const logLines = String(text)
          .split('\n')
          .map((l) => l.trimEnd())
          .filter((l) => l.length > 0);
        return toMcpToolResult(
          markTransport(
            {
              appName,
              namespace,
              container,
              lineCount: logLines.length,
              logs: logLines,
              options: {
                follow: Boolean(follow),
                previous: Boolean(previous),
                since,
                sinceTime,
                tailLines: tailLinesValue,
                timestamps: Boolean(timestamps),
                group,
                kind,
                name,
              },
              transport: 'k8s',
            },
            'k8s',
          ),
        );
      } catch (error: any) {
        if (!isRecoverableK8sError(error)) {
          // Ignore k8s error and fallback to ArgoCD API/CLI
          console.error('ArgoCD API log fetch failed, falling back to CLI: ', error.message);
        }
      }

      // 2. Try ArgoCD API
      try {
        const text = await fetchLogsViaApi({ ...params, tail: tailLinesValue });
        const logLines = String(text)
          .split('\n')
          .map((l) => l.trimEnd())
          .filter((l) => l.length > 0);
        return toMcpToolResult(
          markTransport(
            {
              appName,
              namespace,
              container,
              lineCount: logLines.length,
              logs: logLines,
              options: {
                follow: Boolean(follow),
                previous: Boolean(previous),
                since,
                sinceTime,
                tailLines: tailLinesValue,
                timestamps: Boolean(timestamps),
                group,
                kind,
                name,
              },
              transport: 'api',
            },
            'api',
          ),
        );
      } catch {
        // If API fails (including missing config), fall back to CLI
      }
    }

    const addServerFlags = (args: string[]) => {
      if (server) args.push('--server', server);
      if (grpcWeb) args.push('--grpc-web');
      if (plaintext) args.push('--plaintext');
      if (insecure) args.push('--insecure');
    };

    switch (operation) {
      case 'list': {
        await validateArgoCDCLI();
        const args = ['app', 'list'];
        args.push('-o', outputFormat || 'json');
        if (labelSelector) args.push('-l', labelSelector);
        if (project) args.push('--project', project);
        if (cluster) args.push('--cluster', cluster);
        if (namespace) args.push('--namespace', namespace);
        if (repo) args.push('--repo', repo);
        if (health) args.push('--health', health);
        if (sync) args.push('--sync', sync);
        addServerFlags(args);
        if (refresh) args.push('--refresh');
        try {
          return toMcpToolResult(markTransport(await executeArgoCDCommand(args), 'cli'));
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to list ArgoCD applications: ${errorMessage}`);
        }
      }
      case 'get': {
        if (!appName) throw new Error('appName is required for operation=get');
        await validateArgoCDCLI();
        const args = ['app', 'get', appName];
        if (outputFormat) args.push('-o', outputFormat);
        if (refresh) args.push('--refresh');
        if (hardRefresh) args.push('--hard-refresh');
        addServerFlags(args);
        try {
          return toMcpToolResult(markTransport(await executeArgoCDCommand(args), 'cli'));
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to get ArgoCD application "${appName}": ${errorMessage}`);
        }
      }
      case 'resources': {
        if (!appName) throw new Error('appName is required for operation=resources');
        await validateArgoCDCLI();
        const args = ['app', 'resources', appName];
        if (outputFormat) args.push('-o', outputFormat);
        if (group) args.push('--group', group);
        if (kind) args.push('--kind', kind);
        if (name) args.push('--name', name);
        if (namespace) args.push('--namespace', namespace);
        if (health) args.push('--health', health);
        if (sync) args.push('--sync', sync);
        addServerFlags(args);
        try {
          return toMcpToolResult(markTransport(await executeArgoCDCommand(args), 'cli'));
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Failed to get resources for ArgoCD application "${appName}": ${errorMessage}`,
          );
        }
      }
      case 'history': {
        if (!appName) throw new Error('appName is required for operation=history');
        await validateArgoCDCLI();
        const args = ['app', 'history', appName];
        if (outputFormat) args.push('-o', outputFormat);
        addServerFlags(args);
        try {
          return toMcpToolResult(markTransport(await executeArgoCDCommand(args), 'cli'));
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Failed to get history for ArgoCD application "${appName}": ${errorMessage}`,
          );
        }
      }
      case 'status': {
        if (!appName) throw new Error('appName is required for operation=status');
        await validateArgoCDCLI();
        const args = ['app', 'status', appName];
        if (outputFormat) args.push('-o', outputFormat);
        addServerFlags(args);
        try {
          return toMcpToolResult(markTransport(await executeArgoCDCommand(args), 'cli'));
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Failed to get status for ArgoCD application "${appName}": ${errorMessage}`,
          );
        }
      }
      case 'logs': {
        if (!appName) throw new Error('appName is required for operation=logs');
        await validateArgoCDCLI();
        const args = ['app', 'logs', appName];
        const tailLinesValue = tailLines ?? tail;
        if (container) args.push('--container', container);
        if (follow) args.push('--follow');
        if (group) args.push('--group', group);
        if (kind) args.push('--kind', kind);
        if (name) args.push('--name', name);
        if (namespace) args.push('--namespace', namespace);
        if (previous) args.push('--previous');
        if (since) args.push('--since', since);
        if (sinceTime) args.push('--since-time', sinceTime);
        if (typeof tailLinesValue === 'number') args.push('--tail', String(tailLinesValue));
        if (timestamps) args.push('--timestamps');
        addServerFlags(args);
        let result: any;
        try {
          result = await executeArgoCDCommand(args);
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Failed to fetch logs for ArgoCD application "${appName}" via CLI: ${errorMessage}. ` +
              'All fallback methods (Kubernetes API, ArgoCD API, and CLI) have been exhausted.',
          );
        }
        // ArgoCD CLI via CliUtils returns { output: string }
        // We want to return structured data to mirror enhanced behavior
        if (result === undefined || result === null) {
          throw new Error(`ArgoCD CLI returned empty result for application "${appName}"`);
        }
        const text =
          typeof result === 'object' && result !== null && 'output' in result
            ? String((result as any).output || '')
            : typeof result === 'string'
              ? result
              : JSON.stringify(result);
        const logLines = text
          .split('\n')
          .map((l) => l.trimEnd())
          .filter((l) => l.length > 0);
        return toMcpToolResult(
          markTransport(
            {
              appName,
              namespace,
              container,
              lineCount: logLines.length,
              logs: logLines,
              options: {
                follow: Boolean(follow),
                previous: Boolean(previous),
                since,
                sinceTime,
                tailLines: tailLinesValue,
                timestamps: Boolean(timestamps),
                group,
                kind,
                name,
                server,
                grpcWeb: Boolean(grpcWeb),
                plaintext: Boolean(plaintext),
                insecure: Boolean(insecure),
              },
              transport: 'cli',
            },
            'cli',
          ),
        );
      }
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
  }
}

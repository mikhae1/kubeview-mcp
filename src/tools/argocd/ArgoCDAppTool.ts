import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
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

function markTransport<T>(value: T, transport: 'k8s' | 'cli'): T {
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
  const client = buildKubernetesClientFromEnv();
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

async function getApplicationViaK8s(appName: string): Promise<any> {
  const client = buildKubernetesClientFromEnv();
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

async function getApplicationAndClientViaK8s(
  appName: string,
): Promise<{ app: any; client: KubernetesClient }> {
  const client = buildKubernetesClientFromEnv();
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

  return { app: (resp?.body ?? resp) as any, client };
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

async function listAppPodsViaK8s(client: KubernetesClient, app: any, params: any): Promise<any[]> {
  const namespaceFromParams = params?.namespace;
  const namespaceFromSpec = app?.spec?.destination?.namespace;
  const namespace = namespaceFromParams || namespaceFromSpec;

  const kind = params?.kind;
  if (kind && String(kind).toLowerCase() !== 'pod') {
    return [];
  }

  const name = params?.name;
  if (name) {
    if (namespace) {
      const podResp = (await client.core.readNamespacedPod({ name, namespace })) as any;
      return podResp ? [podResp] : [];
    }

    const all = (await client.core.listPodForAllNamespaces({})) as any;
    const pods = Array.isArray(all?.items) ? all.items : [];
    return pods.filter((p: any) => String(p?.metadata?.name || '') === String(name));
  }

  const appName = String(app?.metadata?.name || '');
  const labelKeys: string[] = [];

  try {
    const cmResp = (await client.core.readNamespacedConfigMap({
      name: 'argocd-cm',
      namespace: defaultArgoCDNamespace(),
    })) as any;
    const cm = cmResp?.body ?? cmResp;
    const configured = cm?.data?.['application.instanceLabelKey'];
    if (configured && String(configured).trim().length > 0) {
      labelKeys.push(String(configured).trim());
    }
  } catch {
    // ignore
  }

  labelKeys.push('app.kubernetes.io/instance');
  labelKeys.push('argocd.argoproj.io/instance');

  const seen = new Set<string>();
  const results: any[] = [];

  for (const key of labelKeys) {
    const labelSelector = `${key}=${appName}`;
    const resp = namespace
      ? ((await client.core.listNamespacedPod({ namespace, labelSelector })) as any)
      : ((await client.core.listPodForAllNamespaces({ labelSelector })) as any);

    const pods = Array.isArray(resp?.items) ? resp.items : [];
    for (const p of pods) {
      const ns = p?.metadata?.namespace;
      const n = p?.metadata?.name;
      if (!ns || !n) continue;
      const k = `${ns}/${n}`;
      if (seen.has(k)) continue;
      seen.add(k);
      results.push(p);
    }
  }

  return results;
}

async function getAppLogsViaK8s(appName: string, params: any): Promise<any> {
  const { app, client } = await getApplicationAndClientViaK8s(appName);

  const requestedKind = params?.kind;
  if (requestedKind && String(requestedKind).toLowerCase() !== 'pod') {
    return { output: '' };
  }

  const namespaceFilter = params?.namespace;
  const podsFromStatus = (Array.isArray(app?.status?.resources) ? app.status.resources : [])
    .filter((r: any) => String(r?.kind || '') === 'Pod')
    .filter((r: any) => !namespaceFilter || String(r?.namespace || '') === String(namespaceFilter))
    .map((r: any) => ({ name: r?.name, namespace: r?.namespace }))
    .filter((p: any) => Boolean(p?.name) && Boolean(p?.namespace));

  const pods: any[] = [];
  if (podsFromStatus.length > 0 && !params?.name) {
    for (const p of podsFromStatus) {
      try {
        const podResp = (await client.core.readNamespacedPod({
          name: p.name,
          namespace: p.namespace,
        })) as any;
        if (podResp) pods.push(podResp);
      } catch {
        // ignore
      }
    }
  }

  if (pods.length === 0) {
    pods.push(...(await listAppPodsViaK8s(client, app, params)));
  }

  const {
    container,
    previous,
    since,
    sinceTime,
    tail,
    timestamps,
  }: {
    container?: string;
    previous?: boolean;
    since?: string;
    sinceTime?: string;
    tail?: number;
    timestamps?: boolean;
  } = params || {};

  const sinceSeconds = since ? parseDurationToSeconds(since) : undefined;

  const podCount = pods.length;
  const outLines: string[] = [];

  for (const pod of pods) {
    const podName = pod?.metadata?.name;
    const namespace = pod?.metadata?.namespace;
    if (!podName || !namespace) continue;

    let effectiveContainer = container;
    if (!effectiveContainer) {
      const containers = Array.isArray(pod?.spec?.containers) ? pod.spec.containers : [];
      if (containers.length === 1 && containers[0]?.name) {
        effectiveContainer = String(containers[0].name);
      }
    }

    const logResp = await client.core.readNamespacedPodLog({
      name: podName,
      namespace,
      container: effectiveContainer,
      previous,
      timestamps,
      tailLines: typeof tail === 'number' ? tail : undefined,
      sinceSeconds,
      sinceTime,
      follow: false,
    } as any);

    const raw = (logResp as unknown as string) || '';
    const lines = raw.split('\n').filter((line) => line.length > 0);

    const prefixBase = effectiveContainer || container || '';
    const prefix =
      prefixBase && podCount > 1
        ? `${podName}/${prefixBase}: `
        : podCount > 1
          ? `${podName}: `
          : '';
    for (const line of lines) {
      outLines.push(prefix ? `${prefix}${line}` : line);
    }
  }

  return { output: outLines.join('\n') };
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
          enum: ['list', 'get', 'resources', 'logs', 'history', 'status'],
        },
        appName: { ...ArgoCDCommonSchemas.appName, optional: true },
        outputFormat: {
          type: 'string',
          enum: ['json', 'yaml', 'wide', 'tree', 'name'],
          optional: true,
          default: 'json',
        },
        // list filters
        labelSelector: ArgoCDCommonSchemas.labelSelector,
        selector: ArgoCDCommonSchemas.selector,
        project: { type: 'string', optional: true },
        cluster: { type: 'string', optional: true },
        namespace: { type: 'string', optional: true },
        repo: { type: 'string', optional: true },
        health: {
          type: 'string',
          enum: ['Healthy', 'Progressing', 'Degraded', 'Suspended', 'Missing', 'Unknown'],
          optional: true,
        },
        sync: { type: 'string', enum: ['Synced', 'OutOfSync', 'Unknown'], optional: true },
        // flags
        server: ArgoCDCommonSchemas.server,
        grpcWeb: ArgoCDCommonSchemas.grpcWeb,
        plaintext: ArgoCDCommonSchemas.plaintext,
        insecure: ArgoCDCommonSchemas.insecure,
        refresh: { type: 'boolean', optional: true },
        hardRefresh: { type: 'boolean', optional: true },
        // resources filters
        group: { type: 'string', optional: true },
        kind: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        // logs options
        container: { type: 'string', optional: true },
        follow: { type: 'boolean', optional: true },
        previous: { type: 'boolean', optional: true },
        since: { type: 'string', optional: true },
        sinceTime: { type: 'string', optional: true },
        tail: { type: 'number', optional: true },
        timestamps: { type: 'boolean', optional: true },
      },
      required: ['operation'],
    },
  };

  async execute(params: any): Promise<any> {
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
      timestamps,
    } = params || {};

    const labelSelector = params?.labelSelector || selector;

    const effectiveOutputFormat = outputFormat || 'json';

    if (operation === 'list' && effectiveOutputFormat === 'json') {
      try {
        return markTransport(await listApplicationsViaK8s(params), 'k8s');
      } catch (error: any) {
        if (!isRecoverableK8sError(error)) {
          throw new Error(
            `Failed to list ArgoCD applications via Kubernetes API: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    if (operation === 'get' && appName && effectiveOutputFormat === 'json') {
      try {
        return markTransport(await getApplicationViaK8s(appName), 'k8s');
      } catch (error: any) {
        if (!isRecoverableK8sError(error)) {
          throw new Error(
            `Failed to get ArgoCD application ${appName} via Kubernetes API: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    if (operation === 'resources' && appName && effectiveOutputFormat === 'json') {
      try {
        const app = await getApplicationViaK8s(appName);
        const resources = filterApplicationResources(app?.status?.resources || [], params);
        return markTransport({ appName, resources }, 'k8s');
      } catch (error: any) {
        if (!isRecoverableK8sError(error)) {
          throw new Error(
            `Failed to get ArgoCD application resources for ${appName} via Kubernetes API: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    if (operation === 'history' && appName && effectiveOutputFormat === 'json') {
      try {
        const app = await getApplicationViaK8s(appName);
        return markTransport(
          { appName, history: Array.isArray(app?.status?.history) ? app.status.history : [] },
          'k8s',
        );
      } catch (error: any) {
        if (!isRecoverableK8sError(error)) {
          throw new Error(
            `Failed to get ArgoCD application history for ${appName} via Kubernetes API: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    if (operation === 'status' && appName && effectiveOutputFormat === 'json') {
      try {
        const app = await getApplicationViaK8s(appName);
        return markTransport(
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
        );
      } catch (error: any) {
        if (!isRecoverableK8sError(error)) {
          throw new Error(
            `Failed to get ArgoCD application status for ${appName} via Kubernetes API: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    const logsWouldNeedCli =
      operation === 'logs' &&
      (Boolean(follow) ||
        Boolean(group) ||
        (kind && String(kind).toLowerCase() !== 'pod') ||
        (name && kind && String(kind).toLowerCase() !== 'pod'));

    if (!logsWouldNeedCli && operation === 'logs' && appName && effectiveOutputFormat === 'json') {
      try {
        return markTransport(await getAppLogsViaK8s(appName, params), 'k8s');
      } catch (error: any) {
        if (!isRecoverableK8sError(error)) {
          throw new Error(
            `Failed to get ArgoCD application logs for ${appName} via Kubernetes API: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
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
        return markTransport(await executeArgoCDCommand(args), 'cli');
      }
      case 'get': {
        if (!appName) throw new Error('appName is required for operation=get');
        await validateArgoCDCLI();
        const args = ['app', 'get', appName];
        if (outputFormat) args.push('-o', outputFormat);
        if (refresh) args.push('--refresh');
        if (hardRefresh) args.push('--hard-refresh');
        addServerFlags(args);
        return markTransport(await executeArgoCDCommand(args), 'cli');
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
        return markTransport(await executeArgoCDCommand(args), 'cli');
      }
      case 'history': {
        if (!appName) throw new Error('appName is required for operation=history');
        await validateArgoCDCLI();
        const args = ['app', 'history', appName];
        if (outputFormat) args.push('-o', outputFormat);
        addServerFlags(args);
        return markTransport(await executeArgoCDCommand(args), 'cli');
      }
      case 'status': {
        if (!appName) throw new Error('appName is required for operation=status');
        await validateArgoCDCLI();
        const args = ['app', 'status', appName];
        if (outputFormat) args.push('-o', outputFormat);
        addServerFlags(args);
        return markTransport(await executeArgoCDCommand(args), 'cli');
      }
      case 'logs': {
        if (!appName) throw new Error('appName is required for operation=logs');
        await validateArgoCDCLI();
        const args = ['app', 'logs', appName];
        if (container) args.push('--container', container);
        if (follow) args.push('--follow');
        if (group) args.push('--group', group);
        if (kind) args.push('--kind', kind);
        if (name) args.push('--name', name);
        if (namespace) args.push('--namespace', namespace);
        if (previous) args.push('--previous');
        if (since) args.push('--since', since);
        if (sinceTime) args.push('--since-time', sinceTime);
        if (typeof tail === 'number') args.push('--tail', String(tail));
        if (timestamps) args.push('--timestamps');
        addServerFlags(args);
        return markTransport(await executeArgoCDCommand(args), 'cli');
      }
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
  }
}

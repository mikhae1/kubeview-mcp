import { KubernetesClient } from '../kubernetes/KubernetesClient.js';
import { ParsedManifestResource, parseManifestResources } from './HelmDataParser.js';

export interface HelmManifestResourceRef extends ParsedManifestResource {
  apiVersion?: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

export type HelmLiveResourceRef = Omit<HelmManifestResourceRef, 'manifest'>;

export type HelmLiveResourceState = 'ready' | 'degraded' | 'missing' | 'unsupported' | 'unknown';

export interface HelmLiveResource {
  ref: HelmLiveResourceRef;
  state: HelmLiveResourceState;
  live?: {
    uid?: string;
    resourceVersion?: string;
    creationTimestamp?: unknown;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    status?: Record<string, unknown>;
    spec?: Record<string, unknown>;
  };
  pods?: HelmPodSummary[];
  reason?: string;
  message?: string;
}

export interface HelmPodSummary {
  name: string;
  namespace?: string;
  phase?: string;
  ready: boolean;
  restarts: number;
  nodeName?: string;
  waitingReasons: string[];
  terminatedReasons: string[];
}

export interface HelmEventSummary {
  namespace?: string;
  timestamp?: unknown;
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  involvedObject: {
    kind?: string;
    name?: string;
    namespace?: string;
  };
}

export interface HelmResourceHealth {
  overall: 'healthy' | 'degraded' | 'missing' | 'unknown';
  total: number;
  supported: number;
  ready: number;
  degraded: number;
  missing: number;
  unsupported: number;
  unknown: number;
  warningEvents: number;
}

function cleanYamlScalar(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function lineIndent(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

function parseMetadataMap(lines: string[], startIndex: number): Record<string, string> {
  const out: Record<string, string> = {};
  const baseIndent = lineIndent(lines[startIndex]);

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }

    const indent = lineIndent(line);
    if (indent <= baseIndent) {
      break;
    }

    const match = line.trim().match(/^([^:]+):\s*(.*)$/);
    if (match && match[2] !== '') {
      out[cleanYamlScalar(match[1])] = cleanYamlScalar(match[2]);
    }
  }

  return out;
}

export function parseHelmManifestResourceRefs(
  manifestText: string,
  defaultNamespace = 'default',
  filterType?: string,
): HelmManifestResourceRef[] {
  return parseManifestResources(manifestText, filterType).map((resource) => {
    const lines = resource.manifest.split('\n');
    const labels: Record<string, string> = {};
    const annotations: Record<string, string> = {};
    let apiVersion: string | undefined;
    let name = resource.name;
    let namespace = resource.namespace;
    let inMetadata = false;
    let metadataIndent = -1;
    let metadataChildIndent = 2;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const indent = lineIndent(line);
      const field = trimmed.match(/^([^:]+):\s*(.*)$/);
      if (!field) {
        continue;
      }

      if (indent === 0 && field[1] === 'apiVersion') {
        apiVersion = cleanYamlScalar(field[2]);
      }

      if (indent === 0 && field[1] === 'metadata') {
        inMetadata = true;
        metadataIndent = indent;
        metadataChildIndent = 2;
        for (let j = i + 1; j < lines.length; j += 1) {
          const nextLine = lines[j];
          const nextTrimmed = nextLine.trim();
          if (!nextTrimmed || nextTrimmed.startsWith('#')) {
            continue;
          }
          const nextIndent = lineIndent(nextLine);
          if (nextIndent <= metadataIndent) {
            break;
          }
          metadataChildIndent = nextIndent - metadataIndent;
          break;
        }
        continue;
      }

      if (inMetadata && indent <= metadataIndent) {
        inMetadata = false;
      }

      if (!inMetadata) {
        continue;
      }

      const metadataFieldIndent = metadataIndent + metadataChildIndent;
      if (indent === metadataFieldIndent && field[1] === 'name') {
        name = cleanYamlScalar(field[2]);
      } else if (indent === metadataFieldIndent && field[1] === 'namespace') {
        namespace = cleanYamlScalar(field[2]);
      } else if (indent === metadataFieldIndent && field[1] === 'labels') {
        Object.assign(labels, parseMetadataMap(lines, i));
      } else if (indent === metadataFieldIndent && field[1] === 'annotations') {
        Object.assign(annotations, parseMetadataMap(lines, i));
      }
    }

    return {
      ...resource,
      apiVersion,
      name,
      namespace: namespace || defaultNamespace,
      labels,
      annotations,
    };
  });
}

function getErrorStatus(error: unknown): number | undefined {
  const err = error as { response?: { statusCode?: number; status?: number }; statusCode?: number };
  return err.response?.statusCode ?? err.response?.status ?? err.statusCode;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function resourceMeta(resource: any): HelmLiveResource['live'] {
  return {
    uid: resource.metadata?.uid,
    resourceVersion: resource.metadata?.resourceVersion,
    creationTimestamp: resource.metadata?.creationTimestamp,
    labels: resource.metadata?.labels || {},
    annotations: resource.metadata?.annotations || {},
    status: resource.status || {},
    spec: resource.spec || {},
  };
}

function publicRef(ref: HelmManifestResourceRef): HelmLiveResourceRef {
  const rest: Partial<HelmManifestResourceRef> = { ...ref };
  delete rest.manifest;
  return rest as HelmLiveResourceRef;
}

function conditionMessages(
  conditions?: Array<{ type?: string; status?: string; reason?: string }>,
): string[] {
  if (!Array.isArray(conditions)) {
    return [];
  }
  return conditions
    .filter((condition) => condition.status === 'False' || condition.status === 'Unknown')
    .map((condition) => [condition.type, condition.reason].filter(Boolean).join(': '))
    .filter(Boolean);
}

function normalizePod(pod: any): HelmLiveResourceState {
  if (pod.status?.phase === 'Succeeded') {
    return 'ready';
  }
  if (pod.status?.phase === 'Failed') {
    return 'degraded';
  }
  const statuses = pod.status?.containerStatuses || [];
  const ready = statuses.length > 0 && statuses.every((status: any) => status.ready);
  const waiting = statuses.some((status: any) => Boolean(status.state?.waiting));
  return ready && !waiting ? 'ready' : 'degraded';
}

function normalizeController(resource: any, kind: string): HelmLiveResourceState {
  const status = resource.status || {};
  const desired = Number(
    resource.spec?.replicas ?? (kind === 'DaemonSet' ? status.desiredNumberScheduled : 1),
  );

  if (kind === 'DaemonSet') {
    return status.numberReady === status.desiredNumberScheduled ? 'ready' : 'degraded';
  }
  if (kind === 'Job') {
    if (status.failed && status.failed > 0) {
      return 'degraded';
    }
    if (status.succeeded && status.succeeded >= Number(resource.spec?.completions ?? 1)) {
      return 'ready';
    }
    return 'unknown';
  }
  if (kind === 'CronJob') {
    return 'ready';
  }

  return desired === 0 || status.readyReplicas === desired ? 'ready' : 'degraded';
}

function normalizeService(resource: any): HelmLiveResourceState {
  if (resource.spec?.type !== 'LoadBalancer') {
    return 'ready';
  }
  const ingress = resource.status?.loadBalancer?.ingress || [];
  return ingress.length > 0 ? 'ready' : 'degraded';
}

function normalizeIngress(resource: any): HelmLiveResourceState {
  if (!resource.status || !resource.status.loadBalancer) {
    return 'unknown';
  }
  const ingress = resource.status.loadBalancer.ingress || [];
  return ingress.length > 0 ? 'ready' : 'degraded';
}

function normalizePvc(resource: any): HelmLiveResourceState {
  return resource.status?.phase === 'Bound' ? 'ready' : 'degraded';
}

function normalizePdb(resource: any): HelmLiveResourceState {
  const status = resource.status;
  if (!status) {
    return 'unknown';
  }
  if (status.currentHealthy !== undefined && status.desiredHealthy !== undefined) {
    return Number(status.currentHealthy) >= Number(status.desiredHealthy) ? 'ready' : 'degraded';
  }
  return 'ready';
}

function normalizeHpa(resource: any): HelmLiveResourceState {
  const messages = conditionMessages(resource.status?.conditions);
  return messages.length > 0 ? 'degraded' : 'ready';
}

function selectorToLabelSelector(selector?: {
  matchLabels?: Record<string, string>;
}): string | undefined {
  const labels = selector?.matchLabels || {};
  const parts = Object.entries(labels).map(([key, value]) => `${key}=${value}`);
  return parts.length > 0 ? parts.join(',') : undefined;
}

function summarizePods(pods: any[]): HelmPodSummary[] {
  return pods.map((pod) => {
    const statuses = pod.status?.containerStatuses || [];
    return {
      name: pod.metadata?.name || 'unknown',
      namespace: pod.metadata?.namespace,
      phase: pod.status?.phase,
      ready: normalizePod(pod) === 'ready',
      restarts: statuses.reduce(
        (sum: number, status: any) => sum + Number(status.restartCount || 0),
        0,
      ),
      nodeName: pod.spec?.nodeName,
      waitingReasons: statuses.map((status: any) => status.state?.waiting?.reason).filter(Boolean),
      terminatedReasons: statuses
        .map((status: any) => status.state?.terminated?.reason)
        .filter(Boolean),
    };
  });
}

async function listPodsForSelector(
  client: KubernetesClient,
  namespace: string,
  labelSelector?: string,
): Promise<HelmPodSummary[] | undefined> {
  if (!labelSelector) {
    return undefined;
  }
  const response = await client.core.listNamespacedPod({ namespace, labelSelector });
  return summarizePods((response as any).items || []);
}

async function fetchLiveResource(
  client: KubernetesClient,
  ref: HelmManifestResourceRef,
): Promise<{ resource: any; pods?: HelmPodSummary[]; state: HelmLiveResourceState }> {
  const name = ref.name || '';
  const namespace = ref.namespace || 'default';
  const core = client.core as any;
  const apps = client.apps as any;
  const batch = client.batch as any;
  const rbac = client.rbac as any;

  switch (ref.kind) {
    case 'Pod': {
      const resource = await core.readNamespacedPod({ name, namespace });
      return { resource, state: normalizePod(resource) };
    }
    case 'Deployment': {
      const resource = await apps.readNamespacedDeployment({ name, namespace });
      const pods = await listPodsForSelector(
        client,
        namespace,
        selectorToLabelSelector(resource.spec?.selector),
      );
      return { resource, pods, state: normalizeController(resource, ref.kind) };
    }
    case 'StatefulSet': {
      const resource = await apps.readNamespacedStatefulSet({ name, namespace });
      const pods = await listPodsForSelector(
        client,
        namespace,
        selectorToLabelSelector(resource.spec?.selector),
      );
      return { resource, pods, state: normalizeController(resource, ref.kind) };
    }
    case 'DaemonSet': {
      const resource = await apps.readNamespacedDaemonSet({ name, namespace });
      const pods = await listPodsForSelector(
        client,
        namespace,
        selectorToLabelSelector(resource.spec?.selector),
      );
      return { resource, pods, state: normalizeController(resource, ref.kind) };
    }
    case 'ReplicaSet': {
      const resource = await apps.readNamespacedReplicaSet({ name, namespace });
      const pods = await listPodsForSelector(
        client,
        namespace,
        selectorToLabelSelector(resource.spec?.selector),
      );
      return { resource, pods, state: normalizeController(resource, ref.kind) };
    }
    case 'Job': {
      const resource = await batch.readNamespacedJob({ name, namespace });
      const pods = await listPodsForSelector(
        client,
        namespace,
        selectorToLabelSelector(resource.spec?.selector),
      );
      return { resource, pods, state: normalizeController(resource, ref.kind) };
    }
    case 'CronJob': {
      const resource = await batch.readNamespacedCronJob({ name, namespace });
      return { resource, state: normalizeController(resource, ref.kind) };
    }
    case 'Service': {
      const resource = await core.readNamespacedService({ name, namespace });
      return { resource, state: normalizeService(resource) };
    }
    case 'ServiceAccount': {
      const resource = await core.readNamespacedServiceAccount({ name, namespace });
      return { resource, state: 'ready' };
    }
    case 'Namespace': {
      const resource = await core.readNamespace({ name });
      return { resource, state: 'ready' };
    }
    case 'Ingress': {
      const resource = await (client.networking as any).readNamespacedIngress({ name, namespace });
      return { resource, state: normalizeIngress(resource) };
    }
    case 'PersistentVolumeClaim': {
      const resource = await core.readNamespacedPersistentVolumeClaim({ name, namespace });
      return { resource, state: normalizePvc(resource) };
    }
    case 'ConfigMap': {
      const resource = await core.readNamespacedConfigMap({ name, namespace });
      return { resource, state: 'ready' };
    }
    case 'Secret': {
      const resource = await core.readNamespacedSecret({ name, namespace });
      return { resource, state: 'ready' };
    }
    case 'Role': {
      const resource = await rbac.readNamespacedRole({ name, namespace });
      return { resource, state: 'ready' };
    }
    case 'RoleBinding': {
      const resource = await rbac.readNamespacedRoleBinding({ name, namespace });
      return { resource, state: 'ready' };
    }
    case 'ClusterRole': {
      const resource = await rbac.readClusterRole({ name });
      return { resource, state: 'ready' };
    }
    case 'ClusterRoleBinding': {
      const resource = await rbac.readClusterRoleBinding({ name });
      return { resource, state: 'ready' };
    }
    case 'HorizontalPodAutoscaler': {
      const resource = await (client.autoscaling as any).readNamespacedHorizontalPodAutoscaler({
        name,
        namespace,
      });
      return { resource, state: normalizeHpa(resource) };
    }
    case 'PodDisruptionBudget': {
      const resource = await (client.policy as any).readNamespacedPodDisruptionBudget({
        name,
        namespace,
      });
      return { resource, state: normalizePdb(resource) };
    }
    default:
      throw new Error(`Unsupported resource kind: ${ref.kind}`);
  }
}

export async function getHelmLiveResources(
  client: KubernetesClient,
  manifestText: string,
  defaultNamespace = 'default',
  filterType?: string,
): Promise<HelmLiveResource[]> {
  const refs = parseHelmManifestResourceRefs(manifestText, defaultNamespace, filterType);
  const resources = await Promise.all(
    refs.map(async (ref): Promise<HelmLiveResource> => {
      const refForOutput = publicRef(ref);
      try {
        const result = await fetchLiveResource(client, ref);
        return {
          ref: refForOutput,
          state: result.state,
          live: resourceMeta(result.resource),
          pods: result.pods,
          reason:
            result.state === 'ready'
              ? undefined
              : result.state === 'unknown'
                ? 'Unknown'
                : 'NotReady',
          message:
            result.state === 'ready'
              ? undefined
              : conditionMessages(result.resource.status?.conditions).join('; ') || undefined,
        };
      } catch (error) {
        const message = getErrorMessage(error);
        if (message.startsWith('Unsupported resource kind')) {
          return { ref: refForOutput, state: 'unsupported', reason: 'UnsupportedKind', message };
        } else if (getErrorStatus(error) === 404 || /not found/i.test(message)) {
          return { ref: refForOutput, state: 'missing', reason: 'NotFound', message };
        }
        return { ref: refForOutput, state: 'unknown', reason: 'LookupFailed', message };
      }
    }),
  );

  return resources;
}

function eventTimestamp(event: any): unknown {
  return (
    event.lastTimestamp ||
    event.eventTime ||
    event.firstTimestamp ||
    event.metadata?.creationTimestamp
  );
}

export async function getHelmResourceEvents(
  client: KubernetesClient,
  resources: HelmLiveResource[],
  eventLimit = 50,
): Promise<HelmEventSummary[]> {
  const refs = new Set(
    resources.map((resource) => {
      const namespace = resource.ref.namespace || 'default';
      return `${namespace}/${resource.ref.kind}/${resource.ref.name}`;
    }),
  );
  const namespaces = Array.from(
    new Set(resources.map((resource) => resource.ref.namespace || 'default')),
  );
  const events: HelmEventSummary[] = [];

  for (const namespace of namespaces) {
    const response = await client.core.listNamespacedEvent({
      namespace,
      limit: Math.max(eventLimit * 4, 100),
    });
    for (const event of (response as any).items || []) {
      const involved = event.involvedObject || {};
      const key = `${involved.namespace || namespace}/${involved.kind}/${involved.name}`;
      if (!refs.has(key)) {
        continue;
      }
      events.push({
        namespace: event.metadata?.namespace || namespace,
        timestamp: eventTimestamp(event),
        type: event.type,
        reason: event.reason,
        message: event.message,
        count: event.count,
        involvedObject: {
          kind: involved.kind,
          name: involved.name,
          namespace: involved.namespace || namespace,
        },
      });
    }
  }

  return events
    .sort((a, b) => {
      const left = new Date(String(a.timestamp || 0)).getTime();
      const right = new Date(String(b.timestamp || 0)).getTime();
      return right - left;
    })
    .slice(0, eventLimit);
}

export function summarizeHelmResourceHealth(
  resources: HelmLiveResource[],
  events: HelmEventSummary[] = [],
): HelmResourceHealth {
  const degraded = resources.filter((resource) => resource.state === 'degraded').length;
  const missing = resources.filter((resource) => resource.state === 'missing').length;
  const unsupported = resources.filter((resource) => resource.state === 'unsupported').length;
  const unknown = resources.filter((resource) => resource.state === 'unknown').length;
  const ready = resources.filter((resource) => resource.state === 'ready').length;
  const supported = resources.length - unsupported;
  const warningEvents = events.filter((event) => event.type === 'Warning').length;
  const overall =
    missing > 0
      ? 'missing'
      : degraded > 0 || warningEvents > 0
        ? 'degraded'
        : unknown > 0
          ? 'unknown'
          : ready > 0
            ? 'healthy'
            : 'unknown';

  return {
    overall,
    total: resources.length,
    supported,
    ready,
    degraded,
    missing,
    unsupported,
    unknown,
    warningEvents,
  };
}

import * as k8s from '@kubernetes/client-node';
import { KubernetesClient } from '../KubernetesClient.js';
import { ConfigMapOperations } from './ConfigMapOperations.js';
import { SecretOperations } from './SecretOperations.js';
import {
  extractHooks,
  extractManifest,
  extractNotes,
  extractValues,
  formatHelmTimestamp,
  HelmHook,
  HelmReleaseData,
  parseHelmSecret,
} from '../../utils/HelmDataParser.js';

export interface HelmListReleasesOptions {
  namespace?: string;
  selector?: string;
  statuses?: string[];
  maxReleases?: number;
}

export interface HelmGetReleaseOptions {
  releaseName: string;
  namespace?: string;
  revision?: number;
}

export interface HelmReleaseSummary {
  name: string;
  namespace: string;
  revision: number;
  updated: string;
  status: string;
  chart: string;
  app_version: string;
}

export interface HelmReleaseHistoryEntry {
  revision: number;
  updated: string;
  status: string;
  chart: string;
  app_version: string;
  description: string;
}

export interface HelmReleaseRecord {
  storageBackend: HelmStorageKind;
  storageObjectName: string;
  labels: Record<string, string>;
  release: HelmReleaseData;
  summary: HelmReleaseSummary;
}

type HelmStorageKind = 'secret' | 'configmap';

interface HelmStorageRef {
  source: HelmStorageKind;
  object: k8s.V1Secret | k8s.V1ConfigMap;
  objectName: string;
  namespace: string;
  releaseName: string;
  revision: number;
  status: string;
  labels: Record<string, string>;
}

function parseStorageObjectName(resource: k8s.V1Secret | k8s.V1ConfigMap): string {
  return (
    resource.metadata?.name ||
    (resource as unknown as { name?: string }).name ||
    'unknown-helm-object'
  );
}

function parseStorageNamespace(resource: k8s.V1Secret | k8s.V1ConfigMap): string {
  return (
    resource.metadata?.namespace ||
    (resource as unknown as { namespace?: string }).namespace ||
    'default'
  );
}

function parseLabels(resource: k8s.V1Secret | k8s.V1ConfigMap): Record<string, string> {
  return (resource.metadata?.labels || {}) as Record<string, string>;
}

function parseReleaseNameFromStorageName(storageName: string): string | undefined {
  const match = storageName.match(/^sh\.helm\.release\.v\d+\.(.+)\.v\d+$/);
  return match?.[1];
}

function parseRevision(storageName: string, labels: Record<string, string>): number {
  const labelVersion = Number.parseInt(labels.version || '', 10);
  if (Number.isFinite(labelVersion)) {
    return labelVersion;
  }
  const match = storageName.match(/\.v(\d+)$/);
  const nameVersion = Number.parseInt(match?.[1] || '', 10);
  return Number.isFinite(nameVersion) ? nameVersion : 0;
}

function parseStatus(labels: Record<string, string>): string {
  return labels.status || 'unknown';
}

function chartLabel(release: HelmReleaseData): string {
  const chartName = release.chart?.metadata?.name;
  const chartVersion = release.chart?.metadata?.version;
  if (chartName && chartVersion) {
    return `${chartName}-${chartVersion}`;
  }
  if (chartName) {
    return chartName;
  }
  return 'unknown';
}

function appVersionLabel(release: HelmReleaseData): string {
  return release.chart?.metadata?.appVersion || 'unknown';
}

function isPendingStatus(status: string): boolean {
  return status.startsWith('pending');
}

function statusMatchesFilter(status: string, statuses?: string[]): boolean {
  if (!statuses || statuses.length === 0) {
    return true;
  }
  const normalized = status.toLowerCase();
  for (const filter of statuses) {
    const normalizedFilter = filter.toLowerCase();
    if (normalizedFilter === 'pending' && isPendingStatus(normalized)) {
      return true;
    }
    if (normalizedFilter === normalized) {
      return true;
    }
  }
  return false;
}

function expandStatusFilters(statuses?: string[]): string[] {
  if (!statuses || statuses.length === 0) {
    return [];
  }

  const expanded = new Set<string>();
  for (const status of statuses) {
    const normalized = status.toLowerCase();
    if (normalized === 'pending') {
      expanded.add('pending-install');
      expanded.add('pending-upgrade');
      expanded.add('pending-rollback');
      continue;
    }
    expanded.add(normalized);
  }

  return Array.from(expanded);
}

export class HelmReleaseOperations {
  private readonly secretOps: SecretOperations;
  private readonly configMapOps: ConfigMapOperations;

  constructor(client: KubernetesClient) {
    this.secretOps = new SecretOperations(client);
    this.configMapOps = new ConfigMapOperations(client);
  }

  async listReleases(options: HelmListReleasesOptions = {}): Promise<HelmReleaseSummary[]> {
    const selector = this.buildLabelSelector(options.selector, undefined, options.statuses);
    const refs = await this.listStorageRefs(selector, options.namespace);

    const latestByRelease = new Map<string, HelmStorageRef>();
    for (const ref of refs) {
      const key = `${ref.namespace}/${ref.releaseName}`;
      const existing = latestByRelease.get(key);
      if (!existing || ref.revision > existing.revision) {
        latestByRelease.set(key, ref);
      }
    }

    let selected = Array.from(latestByRelease.values()).sort((a, b) => {
      if (a.releaseName === b.releaseName) {
        return a.namespace.localeCompare(b.namespace);
      }
      return a.releaseName.localeCompare(b.releaseName);
    });

    if (options.maxReleases && options.maxReleases > 0) {
      selected = selected.slice(0, options.maxReleases);
    }

    const summaries: HelmReleaseSummary[] = [];
    for (const ref of selected) {
      const withData = await this.ensureRefHasData(ref);
      const summary = this.toSummary(withData);
      if (statusMatchesFilter(summary.status, options.statuses)) {
        summaries.push(summary);
      }
    }

    return summaries;
  }

  async getRelease(options: HelmGetReleaseOptions): Promise<HelmReleaseRecord> {
    if (!options.releaseName) {
      throw new Error('Release name is required');
    }

    const selector = this.buildLabelSelector(undefined, options.releaseName);
    let refs = await this.listStorageRefs(selector, options.namespace);
    if (refs.length === 0) {
      const fallbackSelector = this.buildLabelSelector(undefined);
      const allRefs = await this.listStorageRefs(fallbackSelector, options.namespace);
      refs = allRefs.filter((ref) => ref.releaseName === options.releaseName);
    }
    if (refs.length === 0) {
      throw new Error(`Helm release not found: ${options.releaseName}`);
    }

    const target =
      options.revision !== undefined
        ? refs.find((ref) => ref.revision === options.revision)
        : refs.reduce(
            (latest, current) => (current.revision > latest.revision ? current : latest),
            refs[0],
          );

    if (!target) {
      throw new Error(
        `Helm release '${options.releaseName}' revision '${options.revision}' was not found`,
      );
    }

    const refWithData = await this.ensureRefHasData(target);
    const release = this.parseReleaseData(refWithData);
    return {
      storageBackend: target.source,
      storageObjectName: target.objectName,
      labels: refWithData.labels,
      release,
      summary: this.toSummary(refWithData, release),
    };
  }

  async getReleaseHistory(
    options: HelmGetReleaseOptions & { maxRevisions?: number },
  ): Promise<HelmReleaseHistoryEntry[]> {
    const selector = this.buildLabelSelector(undefined, options.releaseName);
    let refs = await this.listStorageRefs(selector, options.namespace);

    if (refs.length === 0) {
      const fallbackSelector = this.buildLabelSelector(undefined);
      const allRefs = await this.listStorageRefs(fallbackSelector, options.namespace);
      refs = allRefs.filter((ref) => ref.releaseName === options.releaseName);
    }

    if (refs.length === 0) {
      throw new Error(`Helm release not found: ${options.releaseName}`);
    }

    const sorted = refs.sort((a, b) => b.revision - a.revision);
    const bounded =
      options.maxRevisions && options.maxRevisions > 0
        ? sorted.slice(0, options.maxRevisions)
        : sorted;

    const history: HelmReleaseHistoryEntry[] = [];
    for (const ref of bounded) {
      const withData = await this.ensureRefHasData(ref);
      const release = this.parseReleaseData(withData);
      const summary = this.toSummary(withData, release);
      history.push({
        revision: summary.revision,
        updated: summary.updated,
        status: summary.status,
        chart: summary.chart,
        app_version: summary.app_version,
        description: release.info?.description || '',
      });
    }

    return history;
  }

  async getReleaseValues(options: HelmGetReleaseOptions, allValues = false): Promise<any> {
    const release = await this.getRelease(options);
    return extractValues(release.release, allValues);
  }

  async getReleaseManifest(options: HelmGetReleaseOptions): Promise<string> {
    const release = await this.getRelease(options);
    return extractManifest(release.release);
  }

  async getReleaseNotes(options: HelmGetReleaseOptions): Promise<string> {
    const release = await this.getRelease(options);
    return extractNotes(release.release);
  }

  async getReleaseHooks(options: HelmGetReleaseOptions): Promise<HelmHook[]> {
    const release = await this.getRelease(options);
    return extractHooks(release.release);
  }

  private buildLabelSelector(selector?: string, releaseName?: string, statuses?: string[]): string {
    const parts = ['owner=helm'];
    if (releaseName) {
      parts.push(`name=${releaseName}`);
    }
    const expandedStatuses = expandStatusFilters(statuses);
    if (expandedStatuses.length === 1) {
      parts.push(`status=${expandedStatuses[0]}`);
    } else if (expandedStatuses.length > 1) {
      parts.push(`status in (${expandedStatuses.join(',')})`);
    }
    if (selector) {
      parts.push(selector);
    }
    return parts.join(',');
  }

  private async listStorageRefs(
    labelSelector: string,
    namespace?: string,
  ): Promise<HelmStorageRef[]> {
    const [secretRefsResult, configMapRefsResult] = await Promise.allSettled([
      this.listSecretRefs(labelSelector, namespace),
      this.listConfigMapRefs(labelSelector, namespace),
    ]);

    const refs: HelmStorageRef[] = [];
    const errors: string[] = [];

    if (secretRefsResult.status === 'fulfilled') {
      refs.push(...secretRefsResult.value);
    } else {
      errors.push(
        `Secret backend: ${secretRefsResult.reason instanceof Error ? secretRefsResult.reason.message : String(secretRefsResult.reason)}`,
      );
    }

    if (configMapRefsResult.status === 'fulfilled') {
      refs.push(...configMapRefsResult.value);
    } else {
      errors.push(
        `ConfigMap backend: ${configMapRefsResult.reason instanceof Error ? configMapRefsResult.reason.message : String(configMapRefsResult.reason)}`,
      );
    }

    if (refs.length === 0 && errors.length > 0) {
      throw new Error(`Unable to query Helm release storage backends. ${errors.join(' | ')}`);
    }

    return this.dedupeRefs(refs);
  }

  private dedupeRefs(refs: HelmStorageRef[]): HelmStorageRef[] {
    const deduped = new Map<string, HelmStorageRef>();
    for (const ref of refs) {
      const key = `${ref.namespace}/${ref.releaseName}/${ref.revision}`;
      const existing = deduped.get(key);
      if (!existing) {
        deduped.set(key, ref);
        continue;
      }

      if (existing.source !== 'secret' && ref.source === 'secret') {
        deduped.set(key, ref);
      }
    }

    return Array.from(deduped.values());
  }

  private async listSecretRefs(
    labelSelector: string,
    namespace?: string,
  ): Promise<HelmStorageRef[]> {
    const secretList = await this.secretOps.list({
      namespace,
      labelSelector,
      skipSanitize: true,
    });

    const refs: HelmStorageRef[] = [];
    const items = Array.isArray(secretList.items) ? secretList.items : [];
    for (const secret of items) {
      const objectName = parseStorageObjectName(secret);
      const objectNamespace = parseStorageNamespace(secret);
      const labels = parseLabels(secret);
      const releaseName = labels.name || parseReleaseNameFromStorageName(objectName);
      if (!releaseName) {
        continue;
      }

      refs.push({
        source: 'secret',
        object: secret,
        objectName,
        namespace: objectNamespace,
        releaseName,
        revision: parseRevision(objectName, labels),
        status: parseStatus(labels),
        labels,
      });
    }
    return refs;
  }

  private async listConfigMapRefs(
    labelSelector: string,
    namespace?: string,
  ): Promise<HelmStorageRef[]> {
    const configMapList = await this.configMapOps.list({
      namespace,
      labelSelector,
      skipSanitize: true,
    });

    const refs: HelmStorageRef[] = [];
    const items = Array.isArray(configMapList.items) ? configMapList.items : [];
    for (const configMap of items) {
      const objectName = parseStorageObjectName(configMap);
      const objectNamespace = parseStorageNamespace(configMap);
      const labels = parseLabels(configMap);
      const releaseName = labels.name || parseReleaseNameFromStorageName(objectName);
      if (!releaseName) {
        continue;
      }

      refs.push({
        source: 'configmap',
        object: configMap,
        objectName,
        namespace: objectNamespace,
        releaseName,
        revision: parseRevision(objectName, labels),
        status: parseStatus(labels),
        labels,
      });
    }

    return refs;
  }

  private async ensureRefHasData(ref: HelmStorageRef): Promise<HelmStorageRef> {
    if (ref.source === 'secret') {
      const secret = ref.object as k8s.V1Secret;
      if (secret.data?.release) {
        return ref;
      }

      const hydratedSecret = await this.secretOps.get(ref.objectName, {
        namespace: ref.namespace,
        skipSanitize: true,
      });

      return {
        ...ref,
        object: hydratedSecret,
      };
    }

    const configMap = ref.object as k8s.V1ConfigMap;
    if (configMap.data?.release) {
      return ref;
    }

    const hydratedConfigMap = await this.configMapOps.get(ref.objectName, {
      namespace: ref.namespace,
      skipSanitize: true,
    });

    return {
      ...ref,
      object: hydratedConfigMap,
    };
  }

  private parseReleaseData(ref: HelmStorageRef): HelmReleaseData {
    const encoded =
      ref.source === 'secret'
        ? (ref.object as k8s.V1Secret).data?.release
        : (ref.object as k8s.V1ConfigMap).data?.release;

    if (!encoded) {
      throw new Error(
        `Invalid Helm ${ref.source} format: missing data.release in ${ref.objectName}`,
      );
    }

    try {
      return parseHelmSecret(encoded);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse Helm ${ref.source} '${ref.objectName}': ${message}`);
    }
  }

  private toSummary(ref: HelmStorageRef, preParsedRelease?: HelmReleaseData): HelmReleaseSummary {
    let parsed = preParsedRelease;
    if (!parsed) {
      try {
        parsed = this.parseReleaseData(ref);
      } catch {
        parsed = undefined;
      }
    }

    const creationTimestamp = (ref.object as { metadata?: { creationTimestamp?: unknown } })
      .metadata?.creationTimestamp;

    const updated =
      (parsed && formatHelmTimestamp(parsed.info?.last_deployed)) ||
      formatHelmTimestamp(creationTimestamp) ||
      '';

    const status = parsed?.info?.status || ref.status || 'unknown';

    return {
      name: parsed?.name || ref.releaseName,
      namespace: parsed?.namespace || ref.namespace,
      revision: parsed?.version || ref.revision,
      updated,
      status,
      chart: parsed ? chartLabel(parsed) : 'unknown',
      app_version: parsed ? appVersionLabel(parsed) : 'unknown',
    };
  }
}

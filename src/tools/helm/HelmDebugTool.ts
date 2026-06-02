import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { HelmReleaseOperations } from '../../kubernetes/resources/HelmReleaseOperations.js';
import {
  HelmEventSummary,
  getHelmLiveResources,
  getHelmResourceEvents,
  HelmLiveResource,
  HelmPodSummary,
  HelmResourceHealth,
  summarizeHelmResourceHealth,
} from '../../utils/HelmLiveResources.js';
import { isSensitiveMaskEnabled, maskTextForSensitiveValues } from '../../utils/SensitiveData.js';
import { HelmBaseTool, HelmCommonSchemas } from './BaseTool.js';

/**
 * High-signal Helm release diagnostics backed by native Kubernetes API reads.
 */
export class HelmDebugTool implements HelmBaseTool {
  tool: Tool = {
    name: 'helm_debug',
    description:
      'Debug a Helm release by combining stored release data, live Kubernetes resource state, workload readiness, and correlated warning events.',
    inputSchema: {
      type: 'object',
      properties: {
        releaseName: HelmCommonSchemas.releaseName,
        namespace: HelmCommonSchemas.namespace,
        revision: HelmCommonSchemas.revision,
        includeEvents: {
          type: 'boolean',
          description: 'Include recent Kubernetes events correlated to release resources',
          optional: true,
          default: true,
        },
        includeHistory: {
          type: 'boolean',
          description: 'Include Helm release revision history',
          optional: true,
          default: true,
        },
        historyLimit: {
          type: 'number',
          description: 'Maximum number of Helm release history entries to return',
          optional: true,
          default: 5,
        },
        includeValues: {
          type: 'boolean',
          description: 'Include computed Helm release values',
          optional: true,
          default: false,
        },
        includeManifest: {
          type: 'boolean',
          description: 'Include the rendered Helm manifest',
          optional: true,
          default: false,
        },
        eventLimit: {
          type: 'number',
          description: 'Maximum number of correlated events to return',
          optional: true,
          default: 10,
        },
        showAllResources: {
          type: 'boolean',
          description: 'Include concise state summaries for every rendered release resource',
          optional: true,
          default: false,
        },
        showRawKubernetesData: {
          type: 'boolean',
          description:
            'Include raw live Kubernetes spec, status, labels, and annotations for deep inspection',
          optional: true,
          default: false,
        },
      },
      required: ['releaseName'],
    },
  };

  async execute(params: any, client?: KubernetesClient): Promise<any> {
    if (!client) {
      throw new Error('helm_debug requires a Kubernetes client for native live resource lookup');
    }

    const {
      releaseName,
      namespace,
      revision,
      includeEvents = true,
      includeHistory = true,
      historyLimit = 5,
      includeValues = false,
      includeManifest = false,
      eventLimit = 10,
      showAllResources = false,
      showRawKubernetesData = false,
    } = params || {};

    try {
      await client.refreshCurrentContext();
      const resolvedNamespace = namespace || client.getCurrentNamespace() || 'default';
      const helmOps = new HelmReleaseOperations(client);
      const release = await helmOps.getRelease({
        releaseName,
        namespace: resolvedNamespace,
        revision,
      });
      const manifest = release.release.manifest || '';
      const resources = await getHelmLiveResources(client, manifest, resolvedNamespace);
      const events = includeEvents
        ? await getHelmResourceEvents(client, resources, Number(eventLimit) || 10)
        : [];
      const warningEvents = events.filter((event) => event.type === 'Warning');
      const health = summarizeHelmResourceHealth(resources, events);
      const eventMap = this.buildEventMap(warningEvents);
      const allUnsupported =
        resources.length > 0 && resources.every((resource) => resource.state === 'unsupported');
      const issues = resources
        .filter((resource) => this.isIssue(resource, eventMap, allUnsupported))
        .map((resource) => this.toIssue(resource, eventMap, showRawKubernetesData));
      const result: Record<string, unknown> = {
        diagnosis: this.buildDiagnosis(health, resources, issues),
        release: {
          ...release.summary,
          description: release.release.info?.description || '',
          hasNotes: Boolean(release.release.info?.notes),
          storageBackend: release.storageBackend,
        },
        health,
        issues,
        workloads: this.extractWorkloads(resources, showRawKubernetesData),
      };

      if (includeEvents) {
        result.events = warningEvents;
      }
      if (includeHistory) {
        const history = await helmOps.getReleaseHistory({
          releaseName,
          namespace: resolvedNamespace,
        });
        result.history = history.slice(0, Number(historyLimit) || 5).map((entry) => ({
          revision: entry.revision,
          updated: entry.updated,
          status: entry.status,
          chart: entry.chart,
          app_version: entry.app_version,
          description: entry.description,
        }));
      }
      if (showAllResources) {
        result.resources = resources.map((resource) =>
          this.toResourceSummary(resource, eventMap, showRawKubernetesData),
        );
      }
      if (includeValues) {
        result.values = this.maskValuesIfNeeded(
          await helmOps.getReleaseValues(
            { releaseName, namespace: resolvedNamespace, revision },
            true,
          ),
        );
      }
      if (includeManifest) {
        result.manifest = manifest;
      }

      return result;
    } catch (error: any) {
      throw new Error(`Failed to debug Helm release '${releaseName}': ${error.message}`);
    }
  }

  private buildDiagnosis(
    health: HelmResourceHealth,
    resources: HelmLiveResource[],
    issues: any[],
  ): any {
    const issueCounts = {
      total: issues.length,
      missing: health.missing,
      degraded: health.degraded,
      unknown: health.unknown,
      warningBacked: issues.filter((issue) => issue.warningEvents > 0).length,
    };
    const byKindAndState = this.summarizeByKindAndState(resources);
    const nextTargets = issues.slice(0, 5).map((issue) => ({
      kind: issue.kind,
      name: issue.name,
      namespace: issue.namespace,
      reason: issue.reason || issue.state,
    }));

    return {
      overall: health.overall,
      summary: this.diagnosisSummary(health, issueCounts),
      issueCounts,
      byKindAndState,
      nextTargets,
    };
  }

  private diagnosisSummary(health: HelmResourceHealth, issueCounts: any): string {
    if (health.overall === 'healthy') {
      return `Release appears healthy: ${health.ready}/${health.supported} supported resources are ready.`;
    }
    if (health.overall === 'missing') {
      return `Release has missing resources: ${health.missing} expected resource(s) were not found.`;
    }
    if (health.overall === 'degraded') {
      return `Release is degraded: ${issueCounts.total} issue(s), ${health.warningEvents} warning event(s).`;
    }
    return `Release health is unknown: ${health.unknown} resource lookup(s) need follow-up.`;
  }

  private summarizeByKindAndState(
    resources: HelmLiveResource[],
  ): Record<string, Record<string, number>> {
    const summary: Record<string, Record<string, number>> = {};
    for (const resource of resources) {
      const kind = resource.ref.kind;
      summary[kind] ||= {};
      summary[kind][resource.state] = (summary[kind][resource.state] || 0) + 1;
    }
    return summary;
  }

  private extractWorkloads(resources: HelmLiveResource[], showRawKubernetesData: boolean): any[] {
    const workloadKinds = new Set([
      'Pod',
      'Deployment',
      'StatefulSet',
      'DaemonSet',
      'ReplicaSet',
      'Job',
      'CronJob',
    ]);

    return resources
      .filter((resource) => workloadKinds.has(resource.ref.kind) && resource.state !== 'ready')
      .map((resource) => this.toWorkloadSignal(resource, showRawKubernetesData));
  }

  private isIssue(
    resource: HelmLiveResource,
    eventMap: Map<string, HelmEventSummary[]>,
    allUnsupported: boolean,
  ): boolean {
    const warningEvents = eventMap.get(this.resourceKey(resource)) || [];
    if (warningEvents.length > 0) {
      return true;
    }
    if (resource.state === 'unsupported') {
      return allUnsupported;
    }
    return (
      resource.state === 'missing' || resource.state === 'degraded' || resource.state === 'unknown'
    );
  }

  private toIssue(
    resource: HelmLiveResource,
    eventMap: Map<string, HelmEventSummary[]>,
    showRawKubernetesData: boolean,
  ): any {
    const warningEvents = eventMap.get(this.resourceKey(resource)) || [];
    const issue: Record<string, unknown> = {
      kind: resource.ref.kind,
      name: resource.ref.name,
      namespace: resource.ref.namespace,
      state: resource.state,
      reason: resource.reason,
      message: resource.message,
      warningEvents: warningEvents.length,
      evidence: this.statusFacts(resource),
    };
    if (warningEvents.length > 0) {
      issue.latestWarnings = warningEvents.slice(0, 3).map((event) => ({
        timestamp: event.timestamp,
        reason: event.reason,
        message: event.message,
        count: event.count,
      }));
    }
    if (showRawKubernetesData) {
      issue.rawKubernetesData = resource.live;
    }
    return issue;
  }

  private toWorkloadSignal(
    resource: HelmLiveResource,
    showRawKubernetesData: boolean,
  ): Record<string, unknown> {
    const signal: Record<string, unknown> = {
      kind: resource.ref.kind,
      name: resource.ref.name,
      namespace: resource.ref.namespace,
      state: resource.state,
      reason: resource.reason,
      message: resource.message,
      readiness: this.statusFacts(resource),
      pods: this.summarizePodSignals(resource.pods || []),
    };
    if (showRawKubernetesData) {
      signal.rawKubernetesData = resource.live;
    }
    return signal;
  }

  private toResourceSummary(
    resource: HelmLiveResource,
    eventMap: Map<string, HelmEventSummary[]>,
    showRawKubernetesData: boolean,
  ): Record<string, unknown> {
    const summary: Record<string, unknown> = {
      kind: resource.ref.kind,
      apiVersion: resource.ref.apiVersion,
      name: resource.ref.name,
      namespace: resource.ref.namespace,
      state: resource.state,
      reason: resource.reason,
      message: resource.message,
      warningEvents: (eventMap.get(this.resourceKey(resource)) || []).length,
      evidence: this.statusFacts(resource),
    };
    if (showRawKubernetesData) {
      summary.rawKubernetesData = resource.live;
    }
    return summary;
  }

  private statusFacts(resource: HelmLiveResource): Record<string, unknown> {
    const status = resource.live?.status || {};
    const spec = resource.live?.spec || {};
    switch (resource.ref.kind) {
      case 'Deployment':
      case 'ReplicaSet':
      case 'StatefulSet':
        return this.compactObject({
          desiredReplicas: spec.replicas,
          replicas: status.replicas,
          readyReplicas: status.readyReplicas,
          availableReplicas: status.availableReplicas,
          updatedReplicas: status.updatedReplicas,
        });
      case 'DaemonSet':
        return this.compactObject({
          desiredNumberScheduled: status.desiredNumberScheduled,
          numberReady: status.numberReady,
          numberAvailable: status.numberAvailable,
          updatedNumberScheduled: status.updatedNumberScheduled,
        });
      case 'Job':
        return this.compactObject({
          completions: spec.completions,
          active: status.active,
          succeeded: status.succeeded,
          failed: status.failed,
        });
      case 'CronJob':
        return this.compactObject({
          suspend: spec.suspend,
          active: Array.isArray(status.active) ? status.active.length : undefined,
          lastScheduleTime: status.lastScheduleTime,
          lastSuccessfulTime: status.lastSuccessfulTime,
        });
      case 'Pod':
        return this.compactObject({
          phase: status.phase,
          podIP: status.podIP,
          nodeName: spec.nodeName,
        });
      case 'PersistentVolumeClaim':
        return this.compactObject({
          phase: status.phase,
          accessModes: status.accessModes,
          capacity: status.capacity,
        });
      case 'Service':
        return this.compactObject({
          type: spec.type,
          clusterIP: spec.clusterIP,
          externalName: spec.externalName,
          loadBalancerIngress: (status.loadBalancer as any)?.ingress,
        });
      case 'Ingress':
        return this.compactObject({
          loadBalancerIngress: (status.loadBalancer as any)?.ingress,
        });
      case 'HorizontalPodAutoscaler':
        return this.compactObject({
          currentReplicas: status.currentReplicas,
          desiredReplicas: status.desiredReplicas,
          currentMetrics: status.currentMetrics,
        });
      case 'PodDisruptionBudget':
        return this.compactObject({
          currentHealthy: status.currentHealthy,
          desiredHealthy: status.desiredHealthy,
          disruptionsAllowed: status.disruptionsAllowed,
        });
      default:
        return {};
    }
  }

  private summarizePodSignals(pods: HelmPodSummary[]): Record<string, unknown> {
    const phaseCounts: Record<string, number> = {};
    const waitingReasons = new Set<string>();
    const terminatedReasons = new Set<string>();
    let restartTotal = 0;
    const problematicPods: Array<Record<string, unknown>> = [];

    for (const pod of pods) {
      const phase = pod.phase || 'Unknown';
      phaseCounts[phase] = (phaseCounts[phase] || 0) + 1;
      restartTotal += pod.restarts;
      pod.waitingReasons.forEach((reason) => waitingReasons.add(reason));
      pod.terminatedReasons.forEach((reason) => terminatedReasons.add(reason));
      if (
        !pod.ready ||
        pod.restarts > 0 ||
        pod.waitingReasons.length > 0 ||
        pod.terminatedReasons.length > 0
      ) {
        problematicPods.push({
          name: pod.name,
          phase: pod.phase,
          ready: pod.ready,
          restarts: pod.restarts,
          waitingReasons: pod.waitingReasons,
          terminatedReasons: pod.terminatedReasons,
        });
      }
    }

    return {
      total: pods.length,
      phaseCounts,
      restartTotal,
      waitingReasons: Array.from(waitingReasons),
      terminatedReasons: Array.from(terminatedReasons),
      problematicPods: problematicPods.slice(0, 10),
    };
  }

  private buildEventMap(events: HelmEventSummary[]): Map<string, HelmEventSummary[]> {
    const map = new Map<string, HelmEventSummary[]>();
    for (const event of events) {
      const key = `${event.involvedObject.namespace || 'default'}/${event.involvedObject.kind}/${event.involvedObject.name}`;
      const existing = map.get(key) || [];
      existing.push(event);
      map.set(key, existing);
    }
    return map;
  }

  private resourceKey(resource: HelmLiveResource): string {
    return `${resource.ref.namespace || 'default'}/${resource.ref.kind}/${resource.ref.name}`;
  }

  private compactObject(input: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined && value !== null),
    );
  }

  private maskValuesIfNeeded(result: any): any {
    if (!isSensitiveMaskEnabled()) {
      return result;
    }

    const json = JSON.stringify(result, null, 2);
    const masked = maskTextForSensitiveValues(json);
    try {
      return JSON.parse(masked);
    } catch {
      return masked;
    }
  }
}

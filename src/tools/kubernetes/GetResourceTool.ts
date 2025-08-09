import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { ConfigMapOperations } from '../../kubernetes/resources/ConfigMapOperations.js';
import { PodOperations } from '../../kubernetes/resources/PodOperations.js';
import { ServiceOperations } from '../../kubernetes/resources/ServiceOperations.js';
import { DeploymentOperations } from '../../kubernetes/resources/DeploymentOperations.js';
import { SecretOperations } from '../../kubernetes/resources/SecretOperations.js';
import { MetricOperations } from '../../kubernetes/resources/MetricOperations.js';

/**
 * Get details of a specific Kubernetes resource
 */
export class GetResourceTool implements BaseTool {
  tool: Tool = {
    name: 'kube_describe',
    description:
      'Describe a single Kubernetes resource by type and name (supports: [pod, service, deployment, configmap, secret, role, clusterrole, rolebinding, clusterrolebinding]) and perform one-shot diagnostics. Returns structured details with related context (events, related resources) and problem findings.',
    inputSchema: {
      type: 'object',
      properties: {
        resourceType: {
          type: 'string',
          description:
            'Type of resource (pod, service, deployment, configmap, secret, role, clusterrole, rolebinding, clusterrolebinding)',
          enum: [
            'pod',
            'service',
            'deployment',
            'configmap',
            'secret',
            'role',
            'clusterrole',
            'rolebinding',
            'clusterrolebinding',
          ],
        },
        name: CommonSchemas.name,
        namespace: {
          ...CommonSchemas.namespace,
          description: 'Kubernetes namespace (defaults to "default")',
        },
        skipSanitize: {
          type: 'boolean',
          description:
            'Skip sanitizing sensitive data in ConfigMap values (only applies to configmap type)',
          optional: true,
        },
        includeEvents: {
          type: 'boolean',
          description: 'Include recent events for the resource',
          optional: true,
        },
        includeDiagnostics: {
          type: 'boolean',
          description: 'Include problem findings and health assessment',
          optional: true,
        },
        eventsLimit: {
          type: 'number',
          description: 'Max number of recent events to include (default 50)',
          optional: true,
        },
        restartThreshold: {
          type: 'number',
          description: 'Container restart count threshold for warnings (default 5)',
          optional: true,
        },
      },
      required: ['resourceType', 'name'],
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    try {
      const {
        resourceType,
        name,
        namespace = 'default',
        skipSanitize,
        includeEvents = true,
        includeDiagnostics = true,
        eventsLimit = 50,
        restartThreshold = 5,
      } = params || {};

      switch (resourceType) {
        case 'pod':
          return await this.describePod(client, {
            name,
            namespace,
            includeEvents,
            includeDiagnostics,
            eventsLimit,
            restartThreshold,
          });
        case 'service':
          return await this.describeService(client, {
            name,
            namespace,
            includeEvents,
            includeDiagnostics,
            eventsLimit,
          });
        case 'deployment':
          return await this.describeDeployment(client, {
            name,
            namespace,
            includeEvents,
            includeDiagnostics,
            eventsLimit,
            restartThreshold,
          });
        case 'configmap':
          return await this.describeConfigMap(client, {
            name,
            namespace,
            skipSanitize,
            includeEvents,
            includeDiagnostics,
            eventsLimit,
          });
        case 'secret':
          return await this.describeSecret(client, {
            name,
            namespace,
            includeEvents,
            includeDiagnostics,
            eventsLimit,
          });
        case 'role':
          return await this.describeRole(client, {
            name,
            namespace,
            includeEvents,
            includeDiagnostics,
            eventsLimit,
          });
        case 'clusterrole':
          return await this.describeClusterRole(client, {
            name,
            includeEvents,
            includeDiagnostics,
            eventsLimit,
          });
        case 'rolebinding':
          return await this.describeRoleBinding(client, {
            name,
            namespace,
            includeEvents,
            includeDiagnostics,
            eventsLimit,
          });
        case 'clusterrolebinding':
          return await this.describeClusterRoleBinding(client, {
            name,
            includeEvents,
            includeDiagnostics,
            eventsLimit,
          });
        default:
          throw new Error(`Unsupported resource type: ${resourceType}`);
      }
    } catch (error: any) {
      const errorMessage = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to get resource details: ${errorMessage}`);
    }
  }

  // ---------- Helpers ----------
  private parseCpuToCores(cpu?: string): number | undefined {
    if (!cpu) return undefined;
    const s = String(cpu);
    if (s.endsWith('n')) return parseFloat(s) / 1e9;
    if (s.endsWith('u')) return parseFloat(s) / 1e6;
    if (s.endsWith('m')) return parseFloat(s) / 1e3;
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : undefined;
  }

  private parseMemoryToBytes(mem?: string): number | undefined {
    if (!mem) return undefined;
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
    const m = String(mem).match(/^(\d+\.?\d*|\.\d+)([KMGTPE]i?)?$/);
    if (!m) {
      const n = parseFloat(String(mem));
      return Number.isFinite(n) ? n : undefined;
    }
    const value = parseFloat(m[1]);
    const suf = m[2];
    return suf && suffixes[suf] ? value * suffixes[suf] : value;
  }

  private computeHealth(
    findings: Array<{ severity: 'info' | 'warning' | 'critical' }>,
  ): 'healthy' | 'degraded' | 'critical' {
    const hasCritical = findings.some((f) => f.severity === 'critical');
    if (hasCritical) return 'critical';
    const hasWarning = findings.some((f) => f.severity === 'warning');
    if (hasWarning) return 'degraded';
    return 'healthy';
  }

  private async fetchEvents(
    client: KubernetesClient,
    kind: string,
    name: string,
    namespace: string,
    limit = 50,
  ): Promise<any[]> {
    try {
      const fieldSelector = `involvedObject.name=${name},involvedObject.kind=${kind}`;
      const res = await client.core.listNamespacedEvent({ namespace, fieldSelector, limit });
      const items = (res.items || []) as any[];
      return items
        .sort((a: any, b: any) => {
          const ta = new Date(a.lastTimestamp || a.firstTimestamp || 0).getTime();
          const tb = new Date(b.lastTimestamp || b.firstTimestamp || 0).getTime();
          return tb - ta;
        })
        .map((e: any) => ({
          namespace: e.metadata?.namespace,
          timestamp: e.lastTimestamp || e.firstTimestamp,
          type: e.type,
          reason: e.reason,
          message: e.message,
          count: e.count,
          source: { component: e.source?.component, host: e.source?.host },
        }));
    } catch {
      return [];
    }
  }

  // ---------- Describers ----------
  private buildMeta(resource: any): any {
    return {
      name: resource?.metadata?.name,
      namespace: resource?.metadata?.namespace,
      uid: resource?.metadata?.uid,
      resourceVersion: resource?.metadata?.resourceVersion,
      generation: resource?.metadata?.generation,
      creationTimestamp: resource?.metadata?.creationTimestamp,
      labels: resource?.metadata?.labels || {},
      annotations: resource?.metadata?.annotations || {},
    };
  }

  private async describeRole(
    client: KubernetesClient,
    args: {
      name: string;
      namespace: string;
      includeEvents: boolean;
      includeDiagnostics: boolean;
      eventsLimit: number;
    },
  ): Promise<any> {
    const role = await client.rbac.readNamespacedRole({
      name: args.name,
      namespace: args.namespace,
    });

    // Related: RoleBindings that reference this Role in the same namespace
    let boundBy: Array<{ name: string; namespace: string; subjects: any[] }> = [];
    try {
      const rbs = await client.rbac.listNamespacedRoleBinding({ namespace: args.namespace });
      const items = ((rbs as any)?.items || []) as any[];
      boundBy = items
        .filter((rb) => rb?.roleRef?.kind === 'Role' && rb?.roleRef?.name === args.name)
        .map((rb) => ({
          name: rb?.metadata?.name,
          namespace: rb?.metadata?.namespace,
          subjects: rb?.subjects || [],
        }));
    } catch {
      // ignore
    }

    const events = args.includeEvents
      ? await this.fetchEvents(client, 'Role', args.name, args.namespace, args.eventsLimit)
      : [];

    const findings: Array<{
      severity: 'info' | 'warning' | 'critical';
      reason: string;
      message: string;
    }> = [];
    if (args.includeDiagnostics) {
      const rules = (role as any)?.rules || [];
      const hasWildcardVerbs = rules.some((r: any) => (r.verbs || []).includes('*'));
      const hasWildcardResources = rules.some((r: any) => (r.resources || []).includes('*'));
      if (hasWildcardVerbs || hasWildcardResources) {
        findings.push({
          severity: 'warning',
          reason: 'BroadPermissions',
          message: 'Role uses wildcard verbs or resources',
        });
      }
    }

    const health = this.computeHealth(findings);
    return {
      resourceType: 'role',
      metadata: this.buildMeta(role),
      rules: (role as any)?.rules || [],
      related: { boundBy },
      events,
      diagnostics: { health, findings },
    };
  }

  private async describeClusterRole(
    client: KubernetesClient,
    args: {
      name: string;
      includeEvents: boolean;
      includeDiagnostics: boolean;
      eventsLimit: number;
    },
  ): Promise<any> {
    const cr = await client.rbac.readClusterRole({ name: args.name });

    // Related: ClusterRoleBindings and RoleBindings that reference this ClusterRole
    let boundByCluster: Array<{ name: string; subjects: any[] }> = [];
    let boundByNamespaced: Array<{ name: string; namespace: string; subjects: any[] }> = [];
    try {
      const crbs = await client.rbac.listClusterRoleBinding({});
      boundByCluster = (((crbs as any)?.items || []) as any[])
        .filter((crb) => crb?.roleRef?.kind === 'ClusterRole' && crb?.roleRef?.name === args.name)
        .map((crb) => ({ name: crb?.metadata?.name, subjects: crb?.subjects || [] }));
    } catch {
      // ignore
    }
    try {
      const rbs = await client.rbac.listRoleBindingForAllNamespaces({});
      boundByNamespaced = (((rbs as any)?.items || []) as any[])
        .filter((rb) => rb?.roleRef?.kind === 'ClusterRole' && rb?.roleRef?.name === args.name)
        .map((rb) => ({
          name: rb?.metadata?.name,
          namespace: rb?.metadata?.namespace,
          subjects: rb?.subjects || [],
        }));
    } catch {
      // ignore
    }

    const events = args.includeEvents
      ? await this.fetchEvents(client, 'ClusterRole', args.name, 'default', args.eventsLimit)
      : [];

    const findings: Array<{
      severity: 'info' | 'warning' | 'critical';
      reason: string;
      message: string;
    }> = [];
    if (args.includeDiagnostics) {
      const rules = (cr as any)?.rules || [];
      const hasWildcardVerbs = rules.some((r: any) => (r.verbs || []).includes('*'));
      const hasWildcardResources = rules.some((r: any) => (r.resources || []).includes('*'));
      if (hasWildcardVerbs || hasWildcardResources) {
        findings.push({
          severity: 'warning',
          reason: 'BroadPermissions',
          message: 'ClusterRole uses wildcard verbs or resources',
        });
      }
    }

    const health = this.computeHealth(findings);
    return {
      resourceType: 'clusterrole',
      metadata: this.buildMeta(cr),
      rules: (cr as any)?.rules || [],
      related: { boundByCluster, boundByNamespaced },
      events,
      diagnostics: { health, findings },
    };
  }

  private async describeRoleBinding(
    client: KubernetesClient,
    args: {
      name: string;
      namespace: string;
      includeEvents: boolean;
      includeDiagnostics: boolean;
      eventsLimit: number;
    },
  ): Promise<any> {
    const rb = await client.rbac.readNamespacedRoleBinding({
      name: args.name,
      namespace: args.namespace,
    });

    // Resolve referenced role (existence check)
    const roleRef = (rb as any)?.roleRef || {};
    let roleExists: boolean | undefined = undefined;
    try {
      if (roleRef.kind === 'Role') {
        await client.rbac.readNamespacedRole({ name: roleRef.name, namespace: args.namespace });
        roleExists = true;
      } else if (roleRef.kind === 'ClusterRole') {
        await client.rbac.readClusterRole({ name: roleRef.name });
        roleExists = true;
      }
    } catch {
      roleExists = false;
    }

    const events = args.includeEvents
      ? await this.fetchEvents(client, 'RoleBinding', args.name, args.namespace, args.eventsLimit)
      : [];

    const findings: Array<{
      severity: 'info' | 'warning' | 'critical';
      reason: string;
      message: string;
    }> = [];
    if (args.includeDiagnostics) {
      if ((rb as any)?.subjects?.length === 0) {
        findings.push({
          severity: 'warning',
          reason: 'NoSubjects',
          message: 'RoleBinding has no subjects',
        });
      }
      if (roleExists === false) {
        findings.push({
          severity: 'critical',
          reason: 'MissingReferencedRole',
          message: `${roleRef.kind} '${roleRef.name}' not found`,
        });
      }
    }

    const health = this.computeHealth(findings);
    return {
      resourceType: 'rolebinding',
      metadata: this.buildMeta(rb),
      roleRef,
      subjects: (rb as any)?.subjects || [],
      related: { roleExists },
      events,
      diagnostics: { health, findings },
    };
  }

  private async describeClusterRoleBinding(
    client: KubernetesClient,
    args: {
      name: string;
      includeEvents: boolean;
      includeDiagnostics: boolean;
      eventsLimit: number;
    },
  ): Promise<any> {
    const crb = await client.rbac.readClusterRoleBinding({ name: args.name });

    const roleRef = (crb as any)?.roleRef || {};
    let roleExists: boolean | undefined = undefined;
    try {
      if (roleRef.kind === 'ClusterRole') {
        await client.rbac.readClusterRole({ name: roleRef.name });
        roleExists = true;
      }
    } catch {
      roleExists = false;
    }

    const events = args.includeEvents
      ? await this.fetchEvents(client, 'ClusterRoleBinding', args.name, 'default', args.eventsLimit)
      : [];

    const findings: Array<{
      severity: 'info' | 'warning' | 'critical';
      reason: string;
      message: string;
    }> = [];
    if (args.includeDiagnostics) {
      if ((crb as any)?.subjects?.length === 0) {
        findings.push({
          severity: 'warning',
          reason: 'NoSubjects',
          message: 'ClusterRoleBinding has no subjects',
        });
      }
      if (roleExists === false) {
        findings.push({
          severity: 'critical',
          reason: 'MissingReferencedClusterRole',
          message: `ClusterRole '${roleRef.name}' not found`,
        });
      }
    }

    const health = this.computeHealth(findings);
    return {
      resourceType: 'clusterrolebinding',
      metadata: this.buildMeta(crb),
      roleRef,
      subjects: (crb as any)?.subjects || [],
      related: { roleExists },
      events,
      diagnostics: { health, findings },
    };
  }
  private async describePod(
    client: KubernetesClient,
    args: {
      name: string;
      namespace: string;
      includeEvents: boolean;
      includeDiagnostics: boolean;
      eventsLimit: number;
      restartThreshold: number;
    },
  ): Promise<any> {
    const podOps = new PodOperations(client);
    const pod = await podOps.get(args.name, { namespace: args.namespace });
    const formatted = await podOps.getFormatted(args.name, { namespace: args.namespace });

    const events = args.includeEvents
      ? await this.fetchEvents(client, 'Pod', args.name, args.namespace, args.eventsLimit)
      : [];

    let metricsSummary: any | undefined;
    try {
      const metrics = await new MetricOperations(client).getPodMetricsByName(
        args.name,
        args.namespace,
      );
      if (metrics) {
        const cpuCores = (metrics.containers || [])
          .map((c: any) => this.parseCpuToCores(c.usage?.cpu))
          .filter((v): v is number => v !== undefined)
          .reduce((a, b) => a + b, 0);
        const memoryBytes = (metrics.containers || [])
          .map((c: any) => this.parseMemoryToBytes(c.usage?.memory))
          .filter((v): v is number => v !== undefined)
          .reduce((a, b) => a + b, 0);
        metricsSummary = {
          timestamp: metrics.timestamp,
          window: metrics.window,
          usage: { cpuCores, memoryBytes },
        };
      }
    } catch {
      // ignore metrics errors
    }

    const findings: Array<{
      severity: 'info' | 'warning' | 'critical';
      reason: string;
      message: string;
      recommendation?: string;
    }> = [];

    if (args.includeDiagnostics) {
      const phase = (pod as any).status?.phase;
      if (phase === 'Pending') {
        findings.push({
          severity: 'warning',
          reason: 'Pending',
          message: `Pod ${args.namespace}:${args.name} is Pending`,
          recommendation:
            'Check scheduling: node selector/affinity, taints/tolerations, and resource requests.',
        });
      }
      if (phase === 'Unknown') {
        findings.push({
          severity: 'critical',
          reason: 'UnknownPhase',
          message: `Pod ${args.namespace}:${args.name} is in Unknown phase`,
          recommendation: 'Check node status and kubelet connectivity.',
        });
      }

      const statuses = (pod as any).status?.containerStatuses || [];
      for (const cs of statuses) {
        const restarts = cs.restartCount || 0;
        if (restarts >= args.restartThreshold) {
          findings.push({
            severity: 'warning',
            reason: 'HighRestarts',
            message: `Container ${cs.name} restarted ${restarts} times`,
            recommendation: 'Check container logs and probe configs; investigate crash causes.',
          });
        }
        const waiting = cs.state?.waiting?.reason;
        if (waiting === 'CrashLoopBackOff' || waiting === 'ImagePullBackOff') {
          findings.push({
            severity: 'critical',
            reason: waiting,
            message: `Container ${cs.name} is ${waiting}`,
            recommendation:
              waiting === 'CrashLoopBackOff'
                ? 'Inspect logs, entrypoint/command, configs, and resource limits.'
                : 'Verify image name/tag, registry access, and imagePullSecrets.',
          });
        }
        const lastTerm = cs.lastState?.terminated;
        if (lastTerm?.reason === 'OOMKilled') {
          findings.push({
            severity: 'critical',
            reason: 'OOMKilled',
            message: `Container ${cs.name} was OOMKilled`,
            recommendation: 'Increase memory limit or reduce memory usage.',
          });
        }
        if (!cs.ready) {
          findings.push({
            severity: 'warning',
            reason: 'ContainerNotReady',
            message: `Container ${cs.name} is not Ready`,
            recommendation: 'Check readiness probe and dependencies.',
          });
        }
      }

      if (metricsSummary && (pod as any).spec?.containers?.length) {
        let cpuLimit = 0;
        let memLimit = 0;
        let hasAnyLimit = false;
        for (const c of (pod as any).spec.containers) {
          const cCpu = this.parseCpuToCores(c.resources?.limits?.cpu as any);
          const cMem = this.parseMemoryToBytes(c.resources?.limits?.memory as any);
          if (cCpu !== undefined) {
            hasAnyLimit = true;
            cpuLimit += cCpu;
          }
          if (cMem !== undefined) {
            hasAnyLimit = true;
            memLimit += cMem;
          }
        }
        if (hasAnyLimit) {
          const cpuUse = metricsSummary.usage.cpuCores as number | undefined;
          const memUse = metricsSummary.usage.memoryBytes as number | undefined;
          if (cpuUse !== undefined && cpuLimit > 0) {
            const pct = cpuUse / cpuLimit;
            if (pct >= 0.8) {
              findings.push({
                severity: pct >= 1 ? 'critical' : 'warning',
                reason: 'CpuLimitPressure',
                message: `CPU usage at ${(pct * 100).toFixed(0)}% of limit`,
                recommendation: 'Increase CPU limit or optimize CPU usage.',
              });
            }
          }
          if (memUse !== undefined && memLimit > 0) {
            const pct = memUse / memLimit;
            if (pct >= 0.8) {
              findings.push({
                severity: pct >= 1 ? 'critical' : 'warning',
                reason: 'MemoryLimitPressure',
                message: `Memory usage at ${(pct * 100).toFixed(0)}% of limit`,
                recommendation: 'Increase memory limit or reduce memory footprint.',
              });
            }
          }
        }
      }

      const recentWarnings = (events || []).filter((e) => e.type === 'Warning').slice(0, 5);
      for (const e of recentWarnings) {
        findings.push({
          severity: 'warning',
          reason: e.reason || 'WarningEvent',
          message: e.message || 'Warning event',
        });
      }
    }

    const health = this.computeHealth(findings);
    return { ...formatted, metrics: metricsSummary, events, diagnostics: { health, findings } };
  }

  private async describeService(
    client: KubernetesClient,
    args: {
      name: string;
      namespace: string;
      includeEvents: boolean;
      includeDiagnostics: boolean;
      eventsLimit: number;
    },
  ): Promise<any> {
    const svcOps = new ServiceOperations(client);
    const service = await svcOps.get(args.name, { namespace: args.namespace });
    const formatted = await svcOps.getFormatted(args.name, { namespace: args.namespace });

    const events = args.includeEvents
      ? await this.fetchEvents(client, 'Service', args.name, args.namespace, args.eventsLimit)
      : [];

    let endpoints: any = undefined;
    try {
      const ep = await svcOps.getEndpoints(args.name, { namespace: args.namespace });
      const subsets = (ep as any)?.subsets || [];
      const readyAddresses = subsets.flatMap((s: any) => s.addresses || []);
      const notReadyAddresses = subsets.flatMap((s: any) => s.notReadyAddresses || []);
      endpoints = {
        readyAddresses: readyAddresses.map((a: any) => a.ip),
        notReadyAddresses: notReadyAddresses.map((a: any) => a.ip),
        ports: subsets.flatMap((s: any) => s.ports || []),
      };
    } catch {
      // ignore
    }

    let selectedPodsSummary: any = undefined;
    try {
      const selector = (service as any)?.spec?.selector || {};
      const labelSelector = Object.keys(selector)
        .map((k) => `${k}=${selector[k]}`)
        .join(',');
      if (labelSelector) {
        const pods = await client.core.listNamespacedPod({
          namespace: args.namespace,
          labelSelector,
        });
        const items = (pods as any).items || [];
        const phases: Record<string, number> = {};
        let notReadyCount = 0;
        for (const p of items as any[]) {
          const ph = p.status?.phase || 'Unknown';
          phases[ph] = (phases[ph] || 0) + 1;
          const st = p.status?.containerStatuses || [];
          for (const cs of st) if (!cs.ready) notReadyCount++;
        }
        selectedPodsSummary = { count: items.length, phases, notReadyContainers: notReadyCount };
      }
    } catch {
      // ignore
    }

    const findings: Array<{
      severity: 'info' | 'warning' | 'critical';
      reason: string;
      message: string;
      recommendation?: string;
    }> = [];
    if (args.includeDiagnostics) {
      const selector = (service as any)?.spec?.selector || {};
      const hasSelector = selector && Object.keys(selector).length > 0;
      const readyCount = endpoints?.readyAddresses?.length || 0;
      if (hasSelector && readyCount === 0) {
        findings.push({
          severity: 'critical',
          reason: 'NoReadyEndpoints',
          message: 'Service has no ready endpoints',
          recommendation: 'Verify selector matches running pods and pods expose matching ports.',
        });
      }
      if ((service as any)?.spec?.type === 'LoadBalancer') {
        const ingress = (service as any).status?.loadBalancer?.ingress || [];
        if (!ingress || ingress.length === 0) {
          findings.push({
            severity: 'warning',
            reason: 'LoadBalancerPending',
            message: 'LoadBalancer has no assigned ingress yet',
            recommendation: 'Check cloud controller manager and events for provisioning issues.',
          });
        }
      }
      for (const e of (events || []).filter((e) => e.type === 'Warning').slice(0, 5)) {
        findings.push({
          severity: 'warning',
          reason: e.reason || 'WarningEvent',
          message: e.message || 'Warning event',
        });
      }
    }

    const health = this.computeHealth(findings);
    return {
      ...formatted,
      related: { endpoints, selectedPods: selectedPodsSummary },
      events,
      diagnostics: { health, findings },
    };
  }

  private async describeDeployment(
    client: KubernetesClient,
    args: {
      name: string;
      namespace: string;
      includeEvents: boolean;
      includeDiagnostics: boolean;
      eventsLimit: number;
      restartThreshold: number;
    },
  ): Promise<any> {
    const depOps = new DeploymentOperations(client);
    const deployment = await depOps.get(args.name, { namespace: args.namespace });
    const formatted = await depOps.getFormatted(args.name, { namespace: args.namespace });

    const events = args.includeEvents
      ? await this.fetchEvents(client, 'Deployment', args.name, args.namespace, args.eventsLimit)
      : [];

    let podsSummary: any = undefined;
    try {
      const matchLabels = (deployment as any)?.spec?.selector?.matchLabels || {};
      const labelSelector = Object.keys(matchLabels)
        .map((k) => `${k}=${matchLabels[k]}`)
        .join(',');
      if (labelSelector) {
        const pods = await client.core.listNamespacedPod({
          namespace: args.namespace,
          labelSelector,
        });
        const items = (pods as any).items || [];
        const phases: Record<string, number> = {};
        let notReadyContainers = 0;
        let restartFindings = 0;
        for (const p of items as any[]) {
          const ph = p.status?.phase || 'Unknown';
          phases[ph] = (phases[ph] || 0) + 1;
          const st = p.status?.containerStatuses || [];
          for (const cs of st) {
            if (!cs.ready) notReadyContainers++;
            if ((cs.restartCount || 0) >= args.restartThreshold) restartFindings++;
          }
        }
        podsSummary = {
          count: items.length,
          phases,
          notReadyContainers,
          highRestartContainers: restartFindings,
        };
      }
    } catch {
      // ignore
    }

    let hpa: any = undefined;
    try {
      const hpas = await client.autoscaling.listNamespacedHorizontalPodAutoscaler({
        namespace: args.namespace,
      });
      const target = (hpas as any).items?.find(
        (h: any) =>
          h.spec?.scaleTargetRef?.kind === 'Deployment' &&
          h.spec?.scaleTargetRef?.name === args.name,
      );
      if (target) {
        hpa = {
          name: target.metadata?.name,
          minReplicas: target.spec?.minReplicas,
          maxReplicas: target.spec?.maxReplicas,
          currentReplicas: target.status?.currentReplicas,
          desiredReplicas: target.status?.desiredReplicas,
        };
      }
    } catch {
      // ignore
    }

    const findings: Array<{
      severity: 'info' | 'warning' | 'critical';
      reason: string;
      message: string;
      recommendation?: string;
    }> = [];
    if (args.includeDiagnostics) {
      const desired = (deployment as any)?.spec?.replicas ?? 1;
      const available = (deployment as any)?.status?.availableReplicas ?? 0;
      const ready = (deployment as any)?.status?.readyReplicas ?? 0;
      if (available < desired) {
        findings.push({
          severity: ready === 0 ? 'critical' : 'warning',
          reason: 'InsufficientAvailableReplicas',
          message: `Available replicas ${available}/${desired} (ready ${ready})`,
          recommendation: 'Check pod failures, image pulls, probes, and node capacity.',
        });
      }
      const conditions = (deployment as any)?.status?.conditions || [];
      const progressing = conditions.find((c: any) => c.type === 'Progressing');
      if (progressing && progressing.status === 'False') {
        findings.push({
          severity: 'critical',
          reason: progressing.reason || 'ProgressingFalse',
          message: progressing.message || 'Deployment is not progressing',
          recommendation: 'Investigate rollout history, events, and ReplicaSet status.',
        });
      }
      const availableCond = conditions.find((c: any) => c.type === 'Available');
      if (availableCond && availableCond.status === 'False') {
        findings.push({
          severity: 'critical',
          reason: availableCond.reason || 'AvailableFalse',
          message: availableCond.message || 'Deployment is not available',
        });
      }
      for (const e of (events || []).filter((e) => e.type === 'Warning').slice(0, 5)) {
        findings.push({
          severity: 'warning',
          reason: e.reason || 'WarningEvent',
          message: e.message || 'Warning event',
        });
      }
    }

    const health = this.computeHealth(findings);
    return {
      ...formatted,
      related: { pods: podsSummary, hpa },
      events,
      diagnostics: { health, findings },
    };
  }

  private async describeConfigMap(
    client: KubernetesClient,
    args: {
      name: string;
      namespace: string;
      skipSanitize?: boolean;
      includeEvents: boolean;
      includeDiagnostics: boolean;
      eventsLimit: number;
    },
  ): Promise<any> {
    const cmOps = new ConfigMapOperations(client);
    const cm = await cmOps.get(args.name, {
      namespace: args.namespace,
      skipSanitize: !!args.skipSanitize,
    });

    let referencedBy: string[] = [];
    try {
      const pods = await client.core.listNamespacedPod({ namespace: args.namespace });
      const items = (pods as any).items || [];
      for (const p of items as any[]) {
        const podName = p.metadata?.name;
        const vMount = (p.spec?.volumes || []).some((v: any) => v.configMap?.name === args.name);
        const envFrom = (p.spec?.containers || []).some((c: any) =>
          (c.envFrom || []).some((ef: any) => ef.configMapRef?.name === args.name),
        );
        const envKeyRef = (p.spec?.containers || []).some((c: any) =>
          (c.env || []).some((e: any) => e?.valueFrom?.configMapKeyRef?.name === args.name),
        );
        if (podName && (vMount || envFrom || envKeyRef)) referencedBy.push(podName);
      }
      referencedBy = referencedBy.slice(0, 20);
    } catch {
      // ignore
    }

    const events = args.includeEvents
      ? await this.fetchEvents(client, 'ConfigMap', args.name, args.namespace, args.eventsLimit)
      : [];

    const findings: Array<{
      severity: 'info' | 'warning' | 'critical';
      reason: string;
      message: string;
    }> = [];
    if (args.includeDiagnostics) {
      if ((referencedBy || []).length === 0) {
        findings.push({
          severity: 'info',
          reason: 'UnreferencedConfigMap',
          message: 'No pods reference this ConfigMap',
        });
      }
      for (const e of (events || []).filter((e) => e.type === 'Warning').slice(0, 5)) {
        findings.push({
          severity: 'warning',
          reason: e.reason || 'WarningEvent',
          message: e.message || 'Warning event',
        });
      }
    }
    const health = this.computeHealth(findings);

    return {
      resourceType: 'configmap',
      metadata: {
        name: (cm as any).metadata?.name,
        namespace: (cm as any).metadata?.namespace,
        uid: (cm as any).metadata?.uid,
        resourceVersion: (cm as any).metadata?.resourceVersion,
        generation: (cm as any).metadata?.generation,
        creationTimestamp: (cm as any).metadata?.creationTimestamp,
        labels: (cm as any).metadata?.labels || {},
        annotations: (cm as any).metadata?.annotations || {},
      },
      data: (cm as any).data || {},
      binaryData: (cm as any).binaryData ? Object.keys((cm as any).binaryData) : [],
      related: { referencedBy },
      events,
      diagnostics: { health, findings },
    };
  }

  private async describeSecret(
    client: KubernetesClient,
    args: {
      name: string;
      namespace: string;
      includeEvents: boolean;
      includeDiagnostics: boolean;
      eventsLimit: number;
    },
  ): Promise<any> {
    const secOps = new SecretOperations(client);
    const formatted = await secOps.getFormatted(args.name, { namespace: args.namespace });

    let referencedBy: string[] = [];
    try {
      const pods = await client.core.listNamespacedPod({ namespace: args.namespace });
      const items = (pods as any).items || [];
      for (const p of items as any[]) {
        const podName = p.metadata?.name;
        const vMount = (p.spec?.volumes || []).some((v: any) => v.secret?.secretName === args.name);
        const envFrom = (p.spec?.containers || []).some((c: any) =>
          (c.envFrom || []).some((ef: any) => ef.secretRef?.name === args.name),
        );
        const envKeyRef = (p.spec?.containers || []).some((c: any) =>
          (c.env || []).some((e: any) => e?.valueFrom?.secretKeyRef?.name === args.name),
        );
        if (podName && (vMount || envFrom || envKeyRef)) referencedBy.push(podName);
      }
      referencedBy = referencedBy.slice(0, 20);
    } catch {
      // ignore
    }

    const events = args.includeEvents
      ? await this.fetchEvents(client, 'Secret', args.name, args.namespace, args.eventsLimit)
      : [];

    const findings: Array<{
      severity: 'info' | 'warning' | 'critical';
      reason: string;
      message: string;
    }> = [];
    if (args.includeDiagnostics) {
      if ((referencedBy || []).length === 0) {
        findings.push({
          severity: 'info',
          reason: 'UnreferencedSecret',
          message: 'No pods reference this Secret',
        });
      }
      for (const e of (events || []).filter((e) => e.type === 'Warning').slice(0, 5)) {
        findings.push({
          severity: 'warning',
          reason: e.reason || 'WarningEvent',
          message: e.message || 'Warning event',
        });
      }
    }
    const health = this.computeHealth(findings);
    return { ...formatted, related: { referencedBy }, events, diagnostics: { health, findings } };
  }
}

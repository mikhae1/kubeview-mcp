import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { PodOperations } from '../../kubernetes/resources/PodOperations.js';
import { ServiceOperations } from '../../kubernetes/resources/ServiceOperations.js';
import { DeploymentOperations } from '../../kubernetes/resources/DeploymentOperations.js';
import { ConfigMapOperations } from '../../kubernetes/resources/ConfigMapOperations.js';
import { SecretOperations } from '../../kubernetes/resources/SecretOperations.js';
import { NamespaceOperations } from '../../kubernetes/resources/NamespaceOperations.js';
import { PersistentVolumeOperations } from '../../kubernetes/resources/PersistentVolumeOperations.js';
import { PersistentVolumeClaimOperations } from '../../kubernetes/resources/PersistentVolumeClaimOperations.js';
import { MetricOperations } from '../../kubernetes/resources/MetricOperations.js';

/**
 * Consolidated list tool for Kubernetes resources
 */
export class KubeListTool implements BaseTool {
  tool: Tool = {
    name: 'kube_list',
    description:
      'List Kubernetes resources by type with common selectors (supports: [pod, service, deployment, node, namespace, persistentvolume, persistentvolumeclaim, secret, configmap]). If resourceType is omitted, returns a consolidated cluster overview with diagnostics and actionable insights across supported resources.',
    inputSchema: {
      type: 'object',
      properties: {
        resourceType: {
          type: 'string',
          description: 'Kubernetes resource type to list',
          enum: [
            'pod',
            'service',
            'deployment',
            'node',
            'role',
            'clusterrole',
            'rolebinding',
            'clusterrolebinding',
            'replicaset',
            'statefulset',
            'daemonset',
            'job',
            'cronjob',
            'hpa',
            'pdb',
            'endpoints',
            'endpointslice',
            'resourcequota',
            'limitrange',
            'namespace',
            'persistentvolume',
            'persistentvolumeclaim',
            'secret',
            'configmap',
          ],
        },
        namespace: CommonSchemas.namespace,
        labelSelector: CommonSchemas.labelSelector,
        fieldSelector: CommonSchemas.fieldSelector,
        // Generic toggles for enriched diagnostics (mainly used for PV/PVC)
        includeAnalysis: {
          type: 'boolean',
          description:
            'Include server-side diagnostics/analysis where available (e.g. storage analysis)',
          optional: true,
          default: true,
        },
        includeEvents: {
          type: 'boolean',
          description: 'Include recent Warning/Normal events correlated to resources (PV/PVC)',
          optional: true,
          default: false,
        },
        includePods: {
          type: 'boolean',
          description: 'Include pods that consume PVCs and perform mount diagnostics',
          optional: true,
          default: false,
        },
        includeCSI: {
          type: 'boolean',
          description: 'Include CSI driver and VolumeAttachment correlation',
          optional: true,
          default: false,
        },
        includeQuotas: {
          type: 'boolean',
          description: 'Include ResourceQuota/LimitRange checks for PVC sizing',
          optional: true,
          default: false,
        },
        since: {
          type: 'string',
          description: 'Time window for event correlation (e.g., "30m", "2h", "1d")',
          optional: true,
        },
        // Storage-oriented filters
        storageClass: {
          type: 'string',
          description: 'Filter by storage class (PV/PVC)',
          optional: true,
        },
        reclaimPolicy: {
          type: 'string',
          description: 'Filter PVs by reclaim policy (Retain, Delete, Recycle)',
          optional: true,
        },
        accessMode: {
          type: 'string',
          description: 'Filter PV/PVC by access mode (ReadWriteOnce, ReadOnlyMany, ReadWriteMany)',
          optional: true,
        },
        volumeMode: {
          type: 'string',
          description: 'Filter PVC by volume mode (Filesystem, Block)',
          optional: true,
        },
        name: {
          type: 'string',
          description: 'Filter by specific resource name (PV/PVC)',
          optional: true,
        },
      },
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    const {
      resourceType,
      namespace,
      labelSelector,
      fieldSelector,
      includeAnalysis = true,
      includeEvents = false,
      includePods = false,
      includeCSI = false,
      includeQuotas = false,
      since,
      storageClass,
      reclaimPolicy,
      accessMode,
      volumeMode,
      name,
    } = params || {};

    // Default diagnostics overview when no resourceType provided
    if (!resourceType) {
      return this.getClusterDiagnostics(client);
    }

    switch (resourceType) {
      case 'pod': {
        const ops = new PodOperations(client);
        return ops.listFormatted({ namespace, labelSelector, fieldSelector });
      }
      case 'service': {
        const ops = new ServiceOperations(client);
        return ops.listFormatted({ namespace, labelSelector, fieldSelector });
      }
      case 'deployment': {
        const ops = new DeploymentOperations(client);
        return ops.list({ namespace, labelSelector, fieldSelector });
      }
      case 'configmap': {
        const ops = new ConfigMapOperations(client);
        return ops.list({ namespace, labelSelector });
      }
      case 'secret': {
        const ops = new SecretOperations(client);
        return ops.list({ namespace, labelSelector });
      }
      case 'namespace': {
        const ops = new NamespaceOperations(client);
        return ops.list();
      }
      case 'persistentvolume': {
        return this.listPersistentVolumesWithDiagnostics(client, {
          labelSelector,
          fieldSelector,
          includeAnalysis,
          includeEvents,
          includeCSI,
          since,
          storageClass,
          reclaimPolicy,
          accessMode,
          name,
        });
      }
      case 'persistentvolumeclaim': {
        return this.listPersistentVolumeClaimsWithDiagnostics(client, {
          namespace,
          labelSelector,
          fieldSelector,
          includeAnalysis,
          includeEvents,
          includePods,
          includeCSI,
          includeQuotas,
          since,
          storageClass,
          accessMode,
          volumeMode,
          name,
        });
      }
      case 'node': {
        // Use core API directly for nodes
        const nodes = await client.core.listNode();
        return nodes?.items ?? [];
      }
      case 'role': {
        // Namespaced resource
        if (namespace) {
          const res = await client.rbac.listNamespacedRole({
            namespace,
            labelSelector,
            fieldSelector,
          } as any);
          return (res as any)?.items ?? [];
        }
        const res = await client.rbac.listRoleForAllNamespaces({
          labelSelector,
          fieldSelector,
        } as any);
        return (res as any)?.items ?? [];
      }
      case 'clusterrole': {
        const res = await client.rbac.listClusterRole({
          labelSelector,
          fieldSelector,
        } as any);
        return (res as any)?.items ?? [];
      }
      case 'rolebinding': {
        // Namespaced resource
        if (namespace) {
          const res = await client.rbac.listNamespacedRoleBinding({
            namespace,
            labelSelector,
            fieldSelector,
          } as any);
          return (res as any)?.items ?? [];
        }
        const res = await client.rbac.listRoleBindingForAllNamespaces({
          labelSelector,
          fieldSelector,
        } as any);
        return (res as any)?.items ?? [];
      }
      case 'clusterrolebinding': {
        const res = await client.rbac.listClusterRoleBinding({
          labelSelector,
          fieldSelector,
        } as any);
        return (res as any)?.items ?? [];
      }
      // Not yet consolidated to operations; throw clear error for now
      case 'replicaset':
      case 'statefulset':
      case 'daemonset':
      case 'job':
      case 'cronjob':
      case 'hpa':
      case 'pdb':
      case 'endpoints':
      case 'endpointslice':
      case 'resourcequota':
      case 'limitrange': {
        throw new Error(
          `Listing for resourceType "${resourceType}" not implemented in kube_list yet`,
        );
      }
      default:
        throw new Error(`Unsupported resourceType: ${resourceType}`);
    }
  }

  /**
   * Build a comprehensive, LLM-friendly cluster diagnostics overview with problem detection
   */
  private async getClusterDiagnostics(client: KubernetesClient): Promise<any> {
    // Gather basics immediately
    const contextName = client.getCurrentContext();
    const cluster = client.getCurrentCluster();

    // Fetch data in parallel where possible
    const [
      versionInfo,
      nodesResp,
      namespacesResp,
      deploymentsResp,
      replicaSetsResp,
      statefulSetsResp,
      daemonSetsResp,
      servicesResp,
      podsResp,
      pvAnalysis,
      pvcAnalysis,
      metricsSummary,
      warningEvents,
      resourceQuotasResp,
      limitRangesResp,
      hpasResp,
      networkPoliciesResp,
      secretsResp,
    ] = await Promise.all([
      this.getVersionInfoSafe(client),
      client.core.listNode().catch(() => ({ items: [] as any[] }) as any),
      client.core.listNamespace().catch(() => ({ items: [] as any[] }) as any),
      client.apps.listDeploymentForAllNamespaces({}).catch(() => ({ items: [] as any[] }) as any),
      client.apps.listReplicaSetForAllNamespaces({}).catch(() => ({ items: [] as any[] }) as any),
      client.apps.listStatefulSetForAllNamespaces({}).catch(() => ({ items: [] as any[] }) as any),
      client.apps.listDaemonSetForAllNamespaces({}).catch(() => ({ items: [] as any[] }) as any),
      client.core.listServiceForAllNamespaces({}).catch(() => ({ items: [] as any[] }) as any),
      client.core.listPodForAllNamespaces({}).catch(() => ({ items: [] as any[] }) as any),
      new PersistentVolumeOperations(client).analyzePVs().catch(() => undefined),
      new PersistentVolumeClaimOperations(client).analyzePVCs().catch(() => undefined),
      this.getMetricsHighlights(client).catch((e) => ({ error: e?.message || String(e) })),
      this.getRecentWarningEvents(client, 100).catch(() => ({ total: 0, items: [] as any[] })),
      client.core
        .listResourceQuotaForAllNamespaces({})
        .catch(() => ({ items: [] as any[] }) as any),
      client.core.listLimitRangeForAllNamespaces({}).catch(() => ({ items: [] as any[] }) as any),
      client.autoscaling
        .listHorizontalPodAutoscalerForAllNamespaces({})
        .catch(() => ({ items: [] as any[] }) as any),
      client.networking
        .listNetworkPolicyForAllNamespaces({})
        .catch(() => ({ items: [] as any[] }) as any),
      client.core.listSecretForAllNamespaces({}).catch(() => ({ items: [] as any[] }) as any),
    ]);

    // Build comprehensive analysis
    const nodeSummary = this.buildNodeSummary(nodesResp?.items || []);
    const workloadSummary = this.buildEnhancedWorkloadSummary(
      podsResp?.items || [],
      deploymentsResp?.items || [],
      replicaSetsResp?.items || [],
      statefulSetsResp?.items || [],
      daemonSetsResp?.items || [],
      servicesResp?.items || [],
      namespacesResp?.items || [],
    );

    // Enhanced problem detection
    const healthAnalysis = this.analyzeClusterHealth(
      nodesResp?.items || [],
      podsResp?.items || [],
      deploymentsResp?.items || [],
      servicesResp?.items || [],
      namespacesResp?.items || [],
      warningEvents?.items || [],
    );

    const securityAnalysis = this.analyzeSecurityPosture(
      podsResp?.items || [],
      servicesResp?.items || [],
      secretsResp?.items || [],
      networkPoliciesResp?.items || [],
      namespacesResp?.items || [],
    );

    const resourceAnalysis = this.analyzeResourcePressure(
      nodesResp?.items || [],
      podsResp?.items || [],
      resourceQuotasResp?.items || [],
      limitRangesResp?.items || [],
      hpasResp?.items || [],
    );

    const insights = this.generateActionableInsights(
      healthAnalysis,
      securityAnalysis,
      resourceAnalysis,
      pvAnalysis,
      pvcAnalysis,
    );

    return {
      context: {
        currentContext: contextName,
        clusterName: cluster?.name,
        server: cluster?.server,
      },
      version: versionInfo || {},
      health: healthAnalysis,
      security: securityAnalysis,
      resources: resourceAnalysis,
      nodes: nodeSummary,
      workloads: workloadSummary,
      storage: this.buildStorageSummary(pvAnalysis, pvcAnalysis),
      metrics: metricsSummary,
      events: warningEvents,
      insights: insights,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * List PersistentVolumes with optional diagnostics, events, and CSI correlation
   */
  private async listPersistentVolumesWithDiagnostics(
    client: KubernetesClient,
    options: {
      labelSelector?: string;
      fieldSelector?: string;
      includeAnalysis?: boolean;
      includeEvents?: boolean;
      includeCSI?: boolean;
      since?: string;
      storageClass?: string;
      reclaimPolicy?: string;
      accessMode?: string;
      name?: string;
    },
  ): Promise<any> {
    const pvOps = new PersistentVolumeOperations(client);

    const listFilters = {
      labelSelector: options.labelSelector,
      fieldSelector: options.fieldSelector,
      storageClass: options.storageClass,
      reclaimPolicy: options.reclaimPolicy,
      accessMode: options.accessMode,
    } as any;

    let pvItems: any[] = [];
    if (options.name) {
      try {
        const single = await pvOps.get(options.name);
        if (single) pvItems = [single];
      } catch {
        pvItems = [];
      }
    } else {
      const list = await pvOps.list(listFilters);
      pvItems = list?.items || [];
    }

    let analysis: any | undefined = undefined;
    if (options.includeAnalysis !== false) {
      analysis = await pvOps.analyzePVs(listFilters).catch(() => undefined);
    }

    let csi: any | undefined = undefined;
    if (options.includeCSI) {
      csi = await this.getCsiCorrelationForPVs(client, pvItems).catch(() => undefined);
    }

    let eventsByPV: Record<string, any[]> | undefined = undefined;
    if (options.includeEvents) {
      eventsByPV = await this.getEventsForObjects(
        client,
        pvItems.map((pv) => ({ kind: 'PersistentVolume', name: pv?.metadata?.name })),
        options.since,
      ).catch(() => undefined);
    }

    // Topology: evaluate nodeAffinity feasibility by checking matching nodes
    let nodeAffinityMatchesByPV: Record<string, number> | undefined = undefined;
    try {
      const nodesResp = await client.core.listNode();
      const nodes = nodesResp?.items || [];
      nodeAffinityMatchesByPV = {};
      for (const pv of pvItems) {
        const name = pv?.metadata?.name || '';
        const terms = pv?.spec?.nodeAffinity?.required?.nodeSelectorTerms || [];
        if (terms.length === 0) {
          nodeAffinityMatchesByPV[name] = nodes.length; // no restriction
          continue;
        }
        let matchCount = 0;
        for (const node of nodes) {
          if (this.nodeMatchesSelectorTerms(node, terms)) matchCount += 1;
        }
        nodeAffinityMatchesByPV[name] = matchCount;
      }
    } catch {
      // ignore topology errors
    }

    const items = pvItems.map((pv) => {
      const key = pv?.metadata?.name || '';
      return {
        metadata: {
          name: pv?.metadata?.name,
          uid: pv?.metadata?.uid,
          creationTimestamp: pv?.metadata?.creationTimestamp,
          deletionTimestamp: pv?.metadata?.deletionTimestamp,
          finalizers: pv?.metadata?.finalizers || [],
          labels: pv?.metadata?.labels || {},
          annotations: pv?.metadata?.annotations || {},
        },
        spec: {
          capacity: pv?.spec?.capacity,
          storageClassName: pv?.spec?.storageClassName,
          accessModes: pv?.spec?.accessModes,
          volumeMode: pv?.spec?.volumeMode,
          persistentVolumeReclaimPolicy: pv?.spec?.persistentVolumeReclaimPolicy,
          claimRef: pv?.spec?.claimRef,
          nodeAffinity: pv?.spec?.nodeAffinity,
          csi: pv?.spec?.csi,
        },
        status: {
          phase: pv?.status?.phase,
          reason: pv?.status?.reason,
          message: pv?.status?.message,
        },
        attachments: csi?.attachmentsByPV?.[key],
        driverPresent: csi?.driverPresenceByPV?.[key],
        events: eventsByPV?.[key],
        topology: nodeAffinityMatchesByPV
          ? { matchingNodes: nodeAffinityMatchesByPV[key] ?? null }
          : undefined,
      };
    });

    return {
      total: items.length,
      analysis,
      storageClassSummary: csi?.storageClassSummary,
      csiDrivers: csi?.drivers,
      items,
    };
  }

  /**
   * List PersistentVolumeClaims with optional diagnostics, events, pod and CSI correlation, and quotas
   */
  private async listPersistentVolumeClaimsWithDiagnostics(
    client: KubernetesClient,
    options: {
      namespace?: string;
      labelSelector?: string;
      fieldSelector?: string;
      includeAnalysis?: boolean;
      includeEvents?: boolean;
      includePods?: boolean;
      includeCSI?: boolean;
      includeQuotas?: boolean;
      since?: string;
      storageClass?: string;
      accessMode?: string;
      volumeMode?: string;
      name?: string;
    },
  ): Promise<any> {
    const pvcOps = new PersistentVolumeClaimOperations(client);
    const listFilters = {
      namespace: options.namespace,
      labelSelector: options.labelSelector,
      fieldSelector: options.fieldSelector,
      storageClass: options.storageClass,
      accessMode: options.accessMode,
      volumeMode: options.volumeMode,
    } as any;

    let pvcItems: any[] = [];
    if (options.name) {
      try {
        const single = await pvcOps.get(options.name, { namespace: options.namespace });
        if (single) pvcItems = [single];
      } catch {
        pvcItems = [];
      }
    } else {
      const list = await pvcOps.list(listFilters);
      pvcItems = list?.items || [];
    }

    let analysis: any | undefined = undefined;
    if (options.includeAnalysis !== false) {
      analysis = await pvcOps.analyzePVCs(listFilters).catch(() => undefined);
    }

    const bindingStatus = await pvcOps.checkBindingStatus().catch(() => undefined);

    const pvList = await client.core.listPersistentVolume().catch(() => ({ items: [] as any[] }));

    let csi: any | undefined = undefined;
    if (options.includeCSI) {
      csi = await this.getCsiCorrelationForPVCs(client, pvcItems).catch(() => undefined);
    }

    const podsByPVC: Record<string, any[]> = {};
    if (options.includePods) {
      const pods = options.namespace
        ? ((await client.core
            .listNamespacedPod({ namespace: options.namespace } as any)
            .catch(() => ({ items: [] as any[] }))) as any)
        : ((await client.core
            .listPodForAllNamespaces({})
            .catch(() => ({ items: [] as any[] }))) as any);
      const items = pods?.items || [];
      for (const pvc of pvcItems) {
        const pvcKey = `${pvc?.metadata?.namespace}/${pvc?.metadata?.name}`;
        const consumers = items.filter((pod: any) => {
          const vols = pod?.spec?.volumes || [];
          return vols.some((v: any) => v?.persistentVolumeClaim?.claimName === pvc?.metadata?.name);
        });
        podsByPVC[pvcKey] = consumers.map((p: any) => ({
          name: p?.metadata?.name,
          namespace: p?.metadata?.namespace,
          phase: p?.status?.phase,
          nodeName: p?.spec?.nodeName,
          containerStatuses: p?.status?.containerStatuses || [],
        }));
      }
    }

    let eventsByPVC: Record<string, any[]> | undefined = undefined;
    if (options.includeEvents) {
      eventsByPVC = await this.getEventsForObjects(
        client,
        pvcItems.map((pvc) => ({
          kind: 'PersistentVolumeClaim',
          name: pvc?.metadata?.name,
          namespace: pvc?.metadata?.namespace,
        })),
        options.since,
      ).catch(() => undefined);
    }

    let quotaDiagnostics: Record<string, any> | undefined = undefined;
    if (options.includeQuotas) {
      if (options.namespace) {
        quotaDiagnostics = await this.getQuotaDiagnosticsForPVCs(
          client,
          pvcItems,
          options.namespace,
        ).catch(() => undefined);
      } else {
        quotaDiagnostics = {};
      }
    }

    const items = pvcItems.map((pvc) => {
      const key = `${pvc?.metadata?.namespace}/${pvc?.metadata?.name}`;
      const boundPVName = pvc?.spec?.volumeName;
      const boundPV = (pvList?.items || []).find((pv: any) => pv?.metadata?.name === boundPVName);
      return {
        metadata: {
          name: pvc?.metadata?.name,
          namespace: pvc?.metadata?.namespace,
          uid: pvc?.metadata?.uid,
          creationTimestamp: pvc?.metadata?.creationTimestamp,
          labels: pvc?.metadata?.labels || {},
          annotations: pvc?.metadata?.annotations || {},
        },
        spec: {
          storageClassName: pvc?.spec?.storageClassName,
          accessModes: pvc?.spec?.accessModes,
          resources: pvc?.spec?.resources,
          volumeMode: pvc?.spec?.volumeMode,
          volumeName: boundPVName,
        },
        status: {
          phase: pvc?.status?.phase,
          capacity: pvc?.status?.capacity,
          conditions: pvc?.status?.conditions || [],
        },
        boundPVStatus: boundPV
          ? { phase: boundPV?.status?.phase, reason: boundPV?.status?.reason }
          : undefined,
        storageClass: csi?.storageClassByPVC?.[key],
        volumeAttachment: csi?.attachmentByPVC?.[key],
        pods: podsByPVC[key],
        events: eventsByPVC?.[key],
        quota: quotaDiagnostics?.[key],
      };
    });

    return {
      total: items.length,
      namespace: options.namespace || 'all',
      analysis,
      bindingStatus,
      storageClassSummary: csi?.storageClassSummary,
      items,
    };
  }

  private async getCsiCorrelationForPVs(
    client: KubernetesClient,
    pvs: any[],
  ): Promise<{
    drivers: any[];
    attachmentsByPV: Record<string, any[]>;
    driverPresenceByPV: Record<string, { driver?: string; present: boolean }>;
    storageClassSummary: Record<string, number>;
  }> {
    const [driversResp, attachmentsResp] = await Promise.all([
      client.storage.listCSIDriver().catch(() => ({ items: [] as any[] })),
      client.storage.listVolumeAttachment().catch(() => ({ items: [] as any[] })),
    ]);

    const drivers = driversResp?.items || [];
    const attachments = attachmentsResp?.items || [];

    const driverNames = new Set(drivers.map((d: any) => d?.metadata?.name));

    const attachmentsByPV: Record<string, any[]> = {};
    for (const a of attachments) {
      const pvName = a?.spec?.source?.persistentVolumeName;
      if (!pvName) continue;
      attachmentsByPV[pvName] = attachmentsByPV[pvName] || [];
      attachmentsByPV[pvName].push({
        name: a?.metadata?.name,
        nodeName: a?.spec?.nodeName,
        attachError: a?.status?.attachError,
        attached: a?.status?.attached,
        detachError: a?.status?.detachError,
      });
    }

    const driverPresenceByPV: Record<string, { driver?: string; present: boolean }> = {};
    const storageClassSummary: Record<string, number> = {};
    for (const pv of pvs) {
      const name = pv?.metadata?.name || '';
      const scName = pv?.spec?.storageClassName || 'default';
      storageClassSummary[scName] = (storageClassSummary[scName] || 0) + 1;
      const driver = pv?.spec?.csi?.driver;
      driverPresenceByPV[name] = { driver, present: driver ? driverNames.has(driver) : false };
    }

    return { drivers, attachmentsByPV, driverPresenceByPV, storageClassSummary };
  }

  private async getCsiCorrelationForPVCs(
    client: KubernetesClient,
    pvcs: any[],
  ): Promise<{
    storageClassByPVC: Record<string, any>;
    storageClassSummary: Record<string, number>;
    attachmentByPVC: Record<string, any | undefined>;
  }> {
    const [scsResp, attachmentsResp] = await Promise.all([
      client.storage.listStorageClass().catch(() => ({ items: [] as any[] })),
      client.storage.listVolumeAttachment().catch(() => ({ items: [] as any[] })),
    ]);
    const scs = scsResp?.items || [];
    const attachments = attachmentsResp?.items || [];

    const defaultScNames = new Set(
      scs
        .filter((sc: any) => {
          const anns = sc?.metadata?.annotations || {};
          return (
            anns['storageclass.kubernetes.io/is-default-class'] === 'true' ||
            anns['storageclass.beta.kubernetes.io/is-default-class'] === 'true'
          );
        })
        .map((sc: any) => sc?.metadata?.name),
    );

    const scByName: Record<string, any> = {};
    for (const sc of scs) scByName[sc?.metadata?.name] = sc;

    const storageClassByPVC: Record<string, any> = {};
    const storageClassSummary: Record<string, number> = {};
    const attachmentByPVC: Record<string, any | undefined> = {};

    for (const pvc of pvcs) {
      const key = `${pvc?.metadata?.namespace}/${pvc?.metadata?.name}`;
      const scName = pvc?.spec?.storageClassName || Array.from(defaultScNames)[0];
      const sc = scName ? scByName[scName] : undefined;
      storageClassByPVC[key] = sc
        ? {
            name: sc?.metadata?.name,
            provisioner: sc?.provisioner,
            volumeBindingMode: sc?.volumeBindingMode,
            allowVolumeExpansion: sc?.allowVolumeExpansion,
          }
        : undefined;
      const sumKey = sc?.metadata?.name || 'none';
      storageClassSummary[sumKey] = (storageClassSummary[sumKey] || 0) + 1;

      const pvName = pvc?.spec?.volumeName;
      if (pvName) {
        const attachment = attachments.find(
          (a: any) => a?.spec?.source?.persistentVolumeName === pvName,
        );
        if (attachment) {
          attachmentByPVC[key] = {
            name: attachment?.metadata?.name,
            nodeName: attachment?.spec?.nodeName,
            attached: attachment?.status?.attached,
            attachError: attachment?.status?.attachError,
            detachError: attachment?.status?.detachError,
          };
        }
      }
    }

    return { storageClassByPVC, storageClassSummary, attachmentByPVC };
  }

  private async getQuotaDiagnosticsForPVCs(
    client: KubernetesClient,
    pvcs: any[],
    namespace: string,
  ): Promise<Record<string, any>> {
    const [quotaResp, limitRangeResp] = await Promise.all([
      client.core
        .listNamespacedResourceQuota({ namespace } as any)
        .catch(() => ({ items: [] as any[] })),
      client.core
        .listNamespacedLimitRange({ namespace } as any)
        .catch(() => ({ items: [] as any[] })),
    ]);
    const quotas = quotaResp?.items || [];
    const limitRanges = limitRangeResp?.items || [];

    const result: Record<string, any> = {};
    for (const pvc of pvcs) {
      const key = `${pvc?.metadata?.namespace}/${pvc?.metadata?.name}`;
      const requested = pvc?.spec?.resources?.requests?.storage as string | undefined;
      const requestedBytes = this.parseStorageSize(requested || '0');

      const quotaIssues: any[] = [];
      for (const q of quotas) {
        const hard = q?.status?.hard || q?.spec?.hard || {};
        const used = q?.status?.used || {};

        const className = pvc?.spec?.storageClassName;
        const classKey = className
          ? `requests.storageclass.storage.k8s.io/${className}`
          : undefined;

        const hardTotal = this.parseStorageSize((hard['requests.storage'] as string) || '0');
        const usedTotal = this.parseStorageSize((used['requests.storage'] as string) || '0');
        const remainingTotal = Math.max(hardTotal - usedTotal, 0);
        if (hardTotal > 0 && requestedBytes > remainingTotal) {
          quotaIssues.push({
            type: 'requests.storage',
            remaining: remainingTotal,
            requested: requestedBytes,
          });
        }

        if (classKey && hard[classKey]) {
          const hardClass = this.parseStorageSize((hard[classKey] as string) || '0');
          const usedClass = this.parseStorageSize((used[classKey] as string) || '0');
          const remainingClass = Math.max(hardClass - usedClass, 0);
          if (requestedBytes > remainingClass) {
            quotaIssues.push({
              type: classKey,
              remaining: remainingClass,
              requested: requestedBytes,
            });
          }
        }
      }

      const limitIssues: any[] = [];
      for (const lr of limitRanges) {
        const items = lr?.spec?.limits || [];
        for (const item of items) {
          const min = this.parseStorageSize((item?.min?.storage as string) || '0');
          const max = this.parseStorageSize((item?.max?.storage as string) || '0');
          if (min > 0 && requestedBytes > 0 && requestedBytes < min) {
            limitIssues.push({ type: 'min.storage', required: min, requested: requestedBytes });
          }
          if (max > 0 && requestedBytes > max) {
            limitIssues.push({ type: 'max.storage', limit: max, requested: requestedBytes });
          }
        }
      }

      result[key] = {
        requestedBytes,
        quotaIssues,
        limitIssues,
      };
    }

    return result;
  }

  private async getEventsForObjects(
    client: KubernetesClient,
    objects: Array<{ kind: string; name?: string; namespace?: string }>,
    since?: string,
  ): Promise<Record<string, any[]>> {
    const fieldSelectors: string[] = [];
    const kinds = Array.from(new Set(objects.map((o) => o.kind))).filter(Boolean);
    if (kinds.length === 1) fieldSelectors.push(`involvedObject.kind=${kinds[0]}`);

    const list = await client.core.listEventForAllNamespaces({
      fieldSelector: fieldSelectors.length > 0 ? fieldSelectors.join(',') : undefined,
    } as any);
    const allEvents: any[] = (list as any)?.items || [];

    const sinceMs = this.parseDurationToMs(since);
    const cutoff = sinceMs ? Date.now() - sinceMs : undefined;

    const eventsByKey: Record<string, any[]> = {};
    for (const obj of objects) {
      const key = obj.namespace ? `${obj.namespace}/${obj.name}` : obj.name || '';
      const filtered = allEvents
        .filter((e: any) => {
          const okKind = !obj.kind || e?.involvedObject?.kind === obj.kind;
          const okName = !obj.name || e?.involvedObject?.name === obj.name;
          const okNs = obj.namespace ? e?.metadata?.namespace === obj.namespace : true;
          if (!okKind || !okName || !okNs) return false;
          if (!cutoff) return true;
          const ts = new Date(e?.lastTimestamp || e?.eventTime || e?.firstTimestamp || 0).getTime();
          return ts >= cutoff;
        })
        .map((e: any) => ({
          namespace: e?.metadata?.namespace,
          lastTimestamp: e?.lastTimestamp || e?.firstTimestamp,
          type: e?.type,
          reason: e?.reason,
          message: e?.message,
          count: e?.count,
        }))
        .sort(
          (a: any, b: any) =>
            new Date(b.lastTimestamp || 0).getTime() - new Date(a.lastTimestamp || 0).getTime(),
        );
      eventsByKey[key] = filtered;
    }

    return eventsByKey;
  }

  private nodeMatchesSelectorTerms(node: any, terms: any[]): boolean {
    const labels = node?.metadata?.labels || {};
    // A node matches if it matches any term, and each term requires all expressions
    for (const term of terms) {
      const exprs = term?.matchExpressions || [];
      let allOk = true;
      for (const expr of exprs) {
        const key = expr?.key;
        const operator = expr?.operator;
        const values: string[] = expr?.values || [];
        const nodeVal = labels[key];
        switch (operator) {
          case 'In':
            if (!values.includes(nodeVal)) allOk = false;
            break;
          case 'NotIn':
            if (values.includes(nodeVal)) allOk = false;
            break;
          case 'Exists':
            if (!(key in labels)) allOk = false;
            break;
          case 'DoesNotExist':
            if (key in labels) allOk = false;
            break;
          case 'Gt':
          case 'Lt': {
            const n = Number(nodeVal);
            const v = Number(values[0]);
            if (Number.isNaN(n) || Number.isNaN(v)) {
              allOk = false;
            } else if (operator === 'Gt' && !(n > v)) {
              allOk = false;
            } else if (operator === 'Lt' && !(n < v)) {
              allOk = false;
            }
            break;
          }
          default:
            break;
        }
        if (!allOk) break;
      }
      if (allOk) return true;
    }
    return false;
  }

  private parseDurationToMs(value?: string): number | undefined {
    if (!value || typeof value !== 'string') return undefined;
    const match = value.trim().match(/^(\d+)([smhdw])$/i);
    if (!match) return undefined;
    const num = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const unitMs: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
      w: 604_800_000,
    };
    return num * (unitMs[unit] || 0);
  }

  private parseStorageSize(sizeStr: string): number {
    if (!sizeStr) return 0;
    const units: { [key: string]: number } = {
      Ki: 1024,
      Mi: 1024 * 1024,
      Gi: 1024 * 1024 * 1024,
      Ti: 1024 * 1024 * 1024 * 1024,
      Pi: 1024 * 1024 * 1024 * 1024 * 1024,
      Ei: 1024 * 1024 * 1024 * 1024 * 1024 * 1024,
      K: 1000,
      M: 1000 * 1000,
      G: 1000 * 1000 * 1000,
      T: 1000 * 1000 * 1000 * 1000,
      P: 1000 * 1000 * 1000 * 1000 * 1000,
      E: 1000 * 1000 * 1000 * 1000 * 1000 * 1000,
      '': 1,
    };
    const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]*)$/);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = match[2] || '';
    const multiplier = units[unit] || 1;
    return Math.floor(value * multiplier);
  }

  private async getVersionInfoSafe(client: KubernetesClient): Promise<any | undefined> {
    try {
      const v = await client.getRaw<any>('/version');
      // Expected fields: major, minor, gitVersion, platform
      return {
        major: (v as any)?.major,
        minor: (v as any)?.minor,
        gitVersion: (v as any)?.gitVersion,
        platform: (v as any)?.platform,
      };
    } catch {
      return undefined;
    }
  }

  private buildNodeSummary(nodes: any[]): any {
    const byReady: Record<string, number> = { Ready: 0, NotReady: 0, Unknown: 0 };
    const details = nodes.map((n: any) => {
      const name = n?.metadata?.name;
      const conditions: any[] = n?.status?.conditions || [];
      const readyCond = conditions.find((c) => c.type === 'Ready');
      const ready = readyCond?.status === 'True';
      if (readyCond) {
        byReady[ready ? 'Ready' : 'NotReady'] += 1;
      } else {
        byReady.Unknown += 1;
      }
      const roles = Object.keys(n?.metadata?.labels || {})
        .filter((k) => k.startsWith('node-role.kubernetes.io/') || k === 'kubernetes.io/role')
        .map((k) => (k.includes('/') ? k.split('/')[1] : n?.metadata?.labels?.[k]))
        .filter(Boolean);
      return {
        name,
        ready,
        roles,
        kubeletVersion: n?.status?.nodeInfo?.kubeletVersion,
        containerRuntime: n?.status?.nodeInfo?.containerRuntimeVersion,
      };
    });
    return {
      total: nodes.length,
      byReady,
      sample: details.slice(0, Math.min(10, details.length)),
    };
  }

  private buildEnhancedWorkloadSummary(
    pods: any[],
    deployments: any[],
    replicaSets: any[],
    statefulSets: any[],
    daemonSets: any[],
    services: any[],
    namespaces: any[],
  ) {
    const podPhaseCounts: Record<string, number> = {};
    let crashLoopCount = 0;
    let restartingPods = 0;
    let totalRestarts = 0;
    let imagePullErrors = 0;
    let oomKilledPods = 0;
    let pendingPods = 0;

    for (const p of pods) {
      const phase = p?.status?.phase || 'Unknown';
      podPhaseCounts[phase] = (podPhaseCounts[phase] || 0) + 1;

      if (phase === 'Pending') pendingPods += 1;

      const cs: any[] = p?.status?.containerStatuses || [];
      const restarts = cs.reduce((acc, c) => acc + (c?.restartCount || 0), 0);
      totalRestarts += restarts;
      if (restarts > 0) restartingPods += 1;

      // Check for specific error conditions
      for (const c of cs) {
        if (c?.state?.waiting?.reason === 'CrashLoopBackOff') crashLoopCount += 1;
        if (
          c?.state?.waiting?.reason === 'ImagePullBackOff' ||
          c?.state?.waiting?.reason === 'ErrImagePull'
        )
          imagePullErrors += 1;
        if (c?.lastState?.terminated?.reason === 'OOMKilled') oomKilledPods += 1;
      }
    }

    // Enhanced deployment analysis
    let deploymentsNotReady = 0;
    let deploymentsProgressing = 0;
    for (const d of deployments) {
      const desired = d?.spec?.replicas ?? 0;
      const ready = d?.status?.readyReplicas ?? 0;
      const updated = d?.status?.updatedReplicas ?? 0;
      if (desired > 0 && ready < desired) deploymentsNotReady += 1;
      if (updated < desired) deploymentsProgressing += 1;
    }

    // StatefulSet analysis
    let statefulSetsNotReady = 0;
    for (const ss of statefulSets) {
      const desired = ss?.spec?.replicas ?? 0;
      const ready = ss?.status?.readyReplicas ?? 0;
      if (desired > 0 && ready < desired) statefulSetsNotReady += 1;
    }

    // DaemonSet analysis
    let daemonSetsNotReady = 0;
    for (const ds of daemonSets) {
      const desired = ds?.status?.desiredNumberScheduled ?? 0;
      const ready = ds?.status?.numberReady ?? 0;
      if (desired > 0 && ready < desired) daemonSetsNotReady += 1;
    }

    // Services analysis
    const serviceTypeCounts: Record<string, number> = {};
    let servicesWithoutEndpoints = 0;
    for (const s of services) {
      const t = s?.spec?.type || 'ClusterIP';
      serviceTypeCounts[t] = (serviceTypeCounts[t] || 0) + 1;
      // Note: We'd need to check endpoints separately for accurate counting
    }

    return {
      namespaces: namespaces.length,
      deployments: {
        total: deployments.length,
        notReady: deploymentsNotReady,
        progressing: deploymentsProgressing,
      },
      statefulSets: {
        total: statefulSets.length,
        notReady: statefulSetsNotReady,
      },
      daemonSets: {
        total: daemonSets.length,
        notReady: daemonSetsNotReady,
      },
      replicaSets: {
        total: replicaSets.length,
      },
      services: {
        total: services.length,
        byType: serviceTypeCounts,
        withoutEndpoints: servicesWithoutEndpoints,
      },
      pods: {
        total: pods.length,
        byPhase: podPhaseCounts,
        pending: pendingPods,
        restarting: restartingPods,
        totalRestarts,
        crashLoopBackOff: crashLoopCount,
        imagePullErrors,
        oomKilled: oomKilledPods,
      },
    };
  }

  private buildStorageSummary(
    pvAnalysis?: any,
    pvcAnalysis?: any,
  ): {
    persistentVolumes?: {
      total: number;
      byStatus: Record<string, number>;
      unbound: number;
      issues: number;
    };
    persistentVolumeClaims?: {
      total: number;
      byStatus: Record<string, number>;
      pending: number;
      issues: number;
    };
  } {
    const storage: any = {};
    if (pvAnalysis) {
      storage.persistentVolumes = {
        total: pvAnalysis.total,
        byStatus: pvAnalysis.byStatus || {},
        unbound: (pvAnalysis.unbound || []).length,
        issues: (pvAnalysis.issues || []).length,
      };
    }
    if (pvcAnalysis) {
      storage.persistentVolumeClaims = {
        total: pvcAnalysis.total,
        byStatus: pvcAnalysis.byStatus || {},
        pending: (pvcAnalysis.pending || []).length,
        issues: (pvcAnalysis.issues || []).length,
      };
    }
    return storage;
  }

  private async getMetricsHighlights(client: KubernetesClient): Promise<any> {
    try {
      const metricsOps = new MetricOperations(client);
      const {
        normalizedNodes = [],
        normalizedPods = [],
        error,
      } = await metricsOps.getMetricsWithOptions([], true);
      const summary = metricsOps.buildLLMSummary(normalizedNodes, normalizedPods, 5);
      return { ...summary, error };
    } catch (e: any) {
      return { error: e?.message || String(e) };
    }
  }

  private async getRecentWarningEvents(client: KubernetesClient, limit = 50): Promise<any> {
    try {
      const result = await client.core.listEventForAllNamespaces({
        fieldSelector: 'type=Warning',
        limit,
      });
      const events = (result?.items || [])
        .map((event: any) => ({
          namespace: event?.metadata?.namespace,
          timestamp: event?.lastTimestamp || event?.firstTimestamp,
          reason: event?.reason,
          message: event?.message,
          involvedObject: {
            kind: event?.involvedObject?.kind,
            name: event?.involvedObject?.name,
            namespace: event?.involvedObject?.namespace,
          },
        }))
        .sort(
          (a: any, b: any) =>
            new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime(),
        );
      return { total: events.length, items: events };
    } catch {
      return { total: 0, items: [] };
    }
  }

  /**
   * Analyze cluster health and detect common problems
   */
  private analyzeClusterHealth(
    nodes: any[],
    pods: any[],
    deployments: any[],
    _services: any[],
    _namespaces: any[],
    events: any[],
  ): any {
    const issues: any[] = [];
    const warnings: any[] = [];
    const criticalNamespaces = new Set(['kube-system', 'kube-public', 'default']);

    // Node health analysis
    const unhealthyNodes = nodes.filter((n) => {
      const conditions = n?.status?.conditions || [];
      const readyCond = conditions.find((c: any) => c.type === 'Ready');
      return !readyCond || readyCond.status !== 'True';
    });

    if (unhealthyNodes.length > 0) {
      issues.push({
        type: 'node_health',
        severity: 'critical',
        message: `${unhealthyNodes.length} nodes are not in Ready state`,
        details: unhealthyNodes.map((n: any) => ({
          name: n?.metadata?.name,
          conditions: n?.status?.conditions?.filter((c: any) => c.status !== 'True'),
        })),
        recommendation: 'Check node logs, ensure kubelet is running, verify network connectivity',
      });
    }

    // Critical system pods analysis
    const systemPodsIssues = pods.filter((p: any) => {
      const ns = p?.metadata?.namespace;
      const phase = p?.status?.phase;
      return criticalNamespaces.has(ns) && phase !== 'Running' && phase !== 'Succeeded';
    });

    if (systemPodsIssues.length > 0) {
      issues.push({
        type: 'system_pods',
        severity: 'critical',
        message: `${systemPodsIssues.length} critical system pods are not running`,
        details: systemPodsIssues.map((p: any) => ({
          name: p?.metadata?.name,
          namespace: p?.metadata?.namespace,
          phase: p?.status?.phase,
          reason: p?.status?.reason,
        })),
        recommendation: 'Investigate system pod failures immediately - cluster stability at risk',
      });
    }

    // Deployment readiness
    const failedDeployments = deployments.filter((d: any) => {
      const desired = d?.spec?.replicas ?? 0;
      const ready = d?.status?.readyReplicas ?? 0;
      return desired > 0 && ready === 0;
    });

    if (failedDeployments.length > 0) {
      warnings.push({
        type: 'failed_deployments',
        severity: 'warning',
        message: `${failedDeployments.length} deployments have zero ready replicas`,
        details: failedDeployments.map((d: any) => ({
          name: d?.metadata?.name,
          namespace: d?.metadata?.namespace,
          desired: d?.spec?.replicas,
          ready: d?.status?.readyReplicas,
        })),
        recommendation: 'Check deployment logs and pod status for failure reasons',
      });
    }

    // Event pattern analysis
    const criticalEventReasons = [
      'Failed',
      'FailedMount',
      'FailedScheduling',
      'Unhealthy',
      'BackOff',
    ];
    const recentCriticalEvents = events.filter((e: any) =>
      criticalEventReasons.some((reason) => e?.reason?.includes(reason)),
    );

    if (recentCriticalEvents.length > 10) {
      warnings.push({
        type: 'event_storm',
        severity: 'warning',
        message: `High volume of critical events detected (${recentCriticalEvents.length})`,
        details: {
          topReasons: this.getTopEventReasons(recentCriticalEvents),
          affectedNamespaces: [
            ...new Set(recentCriticalEvents.map((e: any) => e?.namespace).filter(Boolean)),
          ],
        },
        recommendation: 'Investigate recurring error patterns and affected resources',
      });
    }

    return {
      overallStatus: issues.length > 0 ? 'critical' : warnings.length > 0 ? 'warning' : 'healthy',
      issues,
      warnings,
      summary: {
        totalIssues: issues.length,
        totalWarnings: warnings.length,
        healthyNodes: nodes.length - unhealthyNodes.length,
        totalNodes: nodes.length,
        healthySystemPods: pods.filter(
          (p: any) =>
            criticalNamespaces.has(p?.metadata?.namespace) && p?.status?.phase === 'Running',
        ).length,
      },
    };
  }

  /**
   * Analyze security posture and common misconfigurations
   */
  private analyzeSecurityPosture(
    pods: any[],
    _services: any[],
    _secrets: any[],
    networkPolicies: any[],
    namespaces: any[],
  ): any {
    const issues: any[] = [];
    const warnings: any[] = [];

    // Privileged containers
    const privilegedPods = pods.filter((p: any) => {
      const containers = [...(p?.spec?.containers || []), ...(p?.spec?.initContainers || [])];
      return containers.some(
        (c: any) =>
          c?.securityContext?.privileged === true ||
          c?.securityContext?.allowPrivilegeEscalation === true,
      );
    });

    if (privilegedPods.length > 0) {
      warnings.push({
        type: 'privileged_containers',
        severity: 'warning',
        message: `${privilegedPods.length} pods running privileged containers`,
        details: privilegedPods.slice(0, 10).map((p: any) => ({
          name: p?.metadata?.name,
          namespace: p?.metadata?.namespace,
        })),
        recommendation: 'Review if privileged access is necessary, consider security policies',
      });
    }

    // Pods without resource limits
    const podsWithoutLimits = pods.filter((p: any) => {
      const containers = p?.spec?.containers || [];
      return containers.some(
        (c: any) => !c?.resources?.limits?.cpu || !c?.resources?.limits?.memory,
      );
    });

    if (podsWithoutLimits.length > pods.length * 0.5) {
      warnings.push({
        type: 'missing_resource_limits',
        severity: 'warning',
        message: `${podsWithoutLimits.length} pods lack resource limits`,
        recommendation: 'Set CPU and memory limits to prevent resource exhaustion',
      });
    }

    // Services without network policies
    const namespacesWithoutNetPol = namespaces
      .filter((ns: any) => {
        const nsName = ns?.metadata?.name;
        return !networkPolicies.some((np: any) => np?.metadata?.namespace === nsName);
      })
      .filter((ns: any) => !['kube-system', 'kube-public'].includes(ns?.metadata?.name));

    if (namespacesWithoutNetPol.length > 0) {
      warnings.push({
        type: 'missing_network_policies',
        severity: 'info',
        message: `${namespacesWithoutNetPol.length} namespaces lack network policies`,
        details: namespacesWithoutNetPol.slice(0, 5).map((ns: any) => ns?.metadata?.name),
        recommendation: 'Consider implementing network policies for traffic isolation',
      });
    }

    // Default service accounts in use
    const podsUsingDefaultSA = pods
      .filter((p: any) => !p?.spec?.serviceAccountName || p?.spec?.serviceAccountName === 'default')
      .filter((p: any) => !['kube-system'].includes(p?.metadata?.namespace));

    if (podsUsingDefaultSA.length > 0) {
      warnings.push({
        type: 'default_service_accounts',
        severity: 'info',
        message: `${podsUsingDefaultSA.length} pods using default service accounts`,
        recommendation: 'Create dedicated service accounts with minimal required permissions',
      });
    }

    return {
      overallStatus: issues.length > 0 ? 'critical' : warnings.length > 0 ? 'warning' : 'good',
      issues,
      warnings,
      summary: {
        privilegedPods: privilegedPods.length,
        podsWithoutLimits: podsWithoutLimits.length,
        namespacesWithNetworkPolicies: namespaces.length - namespacesWithoutNetPol.length,
        totalNamespaces: namespaces.length,
        podsWithCustomSA: pods.length - podsUsingDefaultSA.length,
      },
    };
  }

  /**
   * Analyze resource pressure and capacity planning
   */
  private analyzeResourcePressure(
    nodes: any[],
    pods: any[],
    _resourceQuotas: any[],
    _limitRanges: any[],
    hpas: any[],
  ): any {
    const issues: any[] = [];
    const warnings: any[] = [];

    // Node pressure analysis
    const nodesWithPressure = nodes.filter((n: any) => {
      const conditions = n?.status?.conditions || [];
      return conditions.some(
        (c: any) =>
          ['MemoryPressure', 'DiskPressure', 'PIDPressure'].includes(c.type) && c.status === 'True',
      );
    });

    if (nodesWithPressure.length > 0) {
      issues.push({
        type: 'node_pressure',
        severity: 'critical',
        message: `${nodesWithPressure.length} nodes experiencing resource pressure`,
        details: nodesWithPressure.map((n: any) => ({
          name: n?.metadata?.name,
          pressureTypes: n?.status?.conditions
            ?.filter(
              (c: any) =>
                ['MemoryPressure', 'DiskPressure', 'PIDPressure'].includes(c.type) &&
                c.status === 'True',
            )
            ?.map((c: any) => c.type),
        })),
        recommendation: 'Scale nodes or optimize resource usage immediately',
      });
    }

    // Pending pods due to resource constraints
    const pendingPods = pods.filter((p: any) => p?.status?.phase === 'Pending');
    const resourceConstrainedPods = pendingPods.filter((p: any) => {
      const conditions = p?.status?.conditions || [];
      return conditions.some(
        (c: any) =>
          c.reason === 'Unschedulable' &&
          (c.message?.includes('Insufficient') || c.message?.includes('resource')),
      );
    });

    if (resourceConstrainedPods.length > 0) {
      warnings.push({
        type: 'resource_constrained_pods',
        severity: 'warning',
        message: `${resourceConstrainedPods.length} pods pending due to insufficient resources`,
        recommendation: 'Scale cluster or optimize resource requests',
      });
    }

    // HPA at limits
    const hpasAtLimit = hpas.filter((hpa: any) => {
      const current = hpa?.status?.currentReplicas || 0;
      const max = hpa?.spec?.maxReplicas || 0;
      return current >= max;
    });

    if (hpasAtLimit.length > 0) {
      warnings.push({
        type: 'hpa_at_limits',
        severity: 'warning',
        message: `${hpasAtLimit.length} HPAs at maximum replica limits`,
        details: hpasAtLimit.map((hpa: any) => ({
          name: hpa?.metadata?.name,
          namespace: hpa?.metadata?.namespace,
          current: hpa?.status?.currentReplicas,
          max: hpa?.spec?.maxReplicas,
        })),
        recommendation: 'Review HPA limits and consider increasing max replicas or scaling nodes',
      });
    }

    return {
      overallStatus: issues.length > 0 ? 'critical' : warnings.length > 0 ? 'warning' : 'healthy',
      issues,
      warnings,
      summary: {
        nodesWithPressure: nodesWithPressure.length,
        pendingPods: pendingPods.length,
        resourceConstrainedPods: resourceConstrainedPods.length,
        hpasAtLimit: hpasAtLimit.length,
        totalHPAs: hpas.length,
      },
    };
  }

  /**
   * Generate actionable insights based on all analyses
   */
  private generateActionableInsights(
    healthAnalysis: any,
    securityAnalysis: any,
    resourceAnalysis: any,
    pvAnalysis?: any,
    _pvcAnalysis?: any,
  ): any {
    const insights: any[] = [];
    const priorities: any[] = [];

    // Critical priorities
    if (healthAnalysis.overallStatus === 'critical') {
      priorities.push({
        priority: 'critical',
        action: 'Investigate cluster health issues immediately',
        details: healthAnalysis.issues.map((i: any) => i.message),
        timeframe: 'immediate',
      });
    }

    if (resourceAnalysis.overallStatus === 'critical') {
      priorities.push({
        priority: 'critical',
        action: 'Address resource pressure and capacity issues',
        details: resourceAnalysis.issues.map((i: any) => i.message),
        timeframe: 'immediate',
      });
    }

    // Performance optimization opportunities
    if (resourceAnalysis.summary.hpasAtLimit > 0) {
      insights.push({
        type: 'performance',
        title: 'Scaling Bottlenecks Detected',
        description:
          'Some HPAs have reached their maximum limits, potentially constraining application scaling',
        action: 'Review and adjust HPA max replicas or add more cluster capacity',
        impact: 'medium',
      });
    }

    // Security recommendations
    if (securityAnalysis.summary.privilegedPods > 0) {
      insights.push({
        type: 'security',
        title: 'Privileged Container Usage',
        description: `${securityAnalysis.summary.privilegedPods} pods are running with privileged containers`,
        action: 'Audit privileged container usage and implement security policies',
        impact: 'medium',
      });
    }

    // Storage insights
    if (pvAnalysis?.issues?.length > 0) {
      insights.push({
        type: 'storage',
        title: 'Storage Issues Detected',
        description: `${pvAnalysis.issues.length} persistent volume issues found`,
        action: 'Review storage backend health and PV configurations',
        impact: 'high',
      });
    }

    return {
      priorities,
      insights,
      summary: {
        totalCriticalActions: priorities.filter((p: any) => p.priority === 'critical').length,
        totalOptimizations: insights.length,
        overallRecommendation: this.getOverallRecommendation(
          healthAnalysis,
          securityAnalysis,
          resourceAnalysis,
        ),
      },
    };
  }

  private getOverallRecommendation(
    healthAnalysis: any,
    _securityAnalysis: any,
    resourceAnalysis: any,
  ): string {
    if (
      healthAnalysis.overallStatus === 'critical' ||
      resourceAnalysis.overallStatus === 'critical'
    ) {
      return 'Immediate action required - cluster stability or performance at risk';
    }
    if (
      healthAnalysis.overallStatus === 'warning' ||
      resourceAnalysis.overallStatus === 'warning'
    ) {
      return 'Monitor closely and plan improvements - some issues detected';
    }
    return 'Cluster appears healthy - continue regular monitoring and consider optimizations';
  }

  private getTopEventReasons(events: any[]): Array<{ reason: string; count: number }> {
    const reasonCounts: Record<string, number> = {};
    events.forEach((e: any) => {
      const reason = e?.reason || 'Unknown';
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    });
    return Object.entries(reasonCounts)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }
}

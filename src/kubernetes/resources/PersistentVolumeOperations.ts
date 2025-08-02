import * as k8s from '@kubernetes/client-node';
import { V1PersistentVolume } from '@kubernetes/client-node';
import {
  BaseResourceOperations,
  ResourceOperationOptions,
  WatchCallback,
  WatchEventType,
} from '../BaseResourceOperations.js';
import { KubernetesClient } from '../KubernetesClient.js';

/**
 * PersistentVolume-specific operation options
 */
export interface PersistentVolumeOperationOptions extends ResourceOperationOptions {
  /**
   * Filter by storage class
   */
  storageClass?: string;

  /**
   * Filter by reclaim policy
   */
  reclaimPolicy?: string;

  /**
   * Filter by access mode
   */
  accessMode?: string;
}

/**
 * Represents a PV with usage information
 */
export interface PVWithUsage extends V1PersistentVolume {
  usage?: {
    capacity?: string;
    used?: string;
    available?: string;
    percentUsed?: number;
  };
}

/**
 * PV analysis result
 */
export interface PVAnalysisResult {
  total: number;
  byStatus: Record<string, number>;
  byStorageClass: Record<string, number>;
  byReclaimPolicy: Record<string, number>;
  unbound: V1PersistentVolume[];
  issues: Array<{
    pv: V1PersistentVolume;
    issue: string;
    severity: 'info' | 'warning' | 'error';
    recommendation?: string;
  }>;
}

/**
 * Operations for Kubernetes Persistent Volumes
 */
export class PersistentVolumeOperations extends BaseResourceOperations<V1PersistentVolume> {
  constructor(client: KubernetesClient) {
    super(client, 'PersistentVolume');
  }

  protected getResourceNamespaced(): boolean {
    return false; // PVs are cluster-scoped
  }

  /**
   * Create operation is not supported for this read-only tool
   */
  async create(
    _resource: V1PersistentVolume,
    _options?: ResourceOperationOptions,
  ): Promise<V1PersistentVolume> {
    throw new Error('Create operation is not supported for this read-only tool');
  }

  /**
   * Update operation is not supported for this read-only tool
   */
  async update(
    _resource: V1PersistentVolume,
    _options?: ResourceOperationOptions,
  ): Promise<V1PersistentVolume> {
    throw new Error('Update operation is not supported for this read-only tool');
  }

  /**
   * Patch operation is not supported for this read-only tool
   */
  async patch(
    _name: string,
    _patch: any,
    _options?: ResourceOperationOptions,
  ): Promise<V1PersistentVolume> {
    throw new Error('Patch operation is not supported for this read-only tool');
  }

  /**
   * Delete operation is not supported for this read-only tool
   */
  async delete(_name: string, _options?: ResourceOperationOptions): Promise<void> {
    throw new Error('Delete operation is not supported for this read-only tool');
  }

  /**
   * List all Persistent Volumes
   */
  async list(options?: PersistentVolumeOperationOptions): Promise<k8s.V1PersistentVolumeList> {
    try {
      const response = await this.client.core.listPersistentVolume(this.buildListOptions(options));

      // Apply additional filtering if needed
      if (options?.storageClass || options?.reclaimPolicy || options?.accessMode) {
        response.items = response.items.filter((pv) => {
          if (options.storageClass && pv.spec?.storageClassName !== options.storageClass) {
            return false;
          }
          if (
            options.reclaimPolicy &&
            pv.spec?.persistentVolumeReclaimPolicy !== options.reclaimPolicy
          ) {
            return false;
          }
          if (options.accessMode && !pv.spec?.accessModes?.includes(options.accessMode)) {
            return false;
          }
          return true;
        });
      }

      return response;
    } catch (error) {
      this.handleApiError(error, 'List', 'all PVs');
    }
  }

  /**
   * Get a specific Persistent Volume by name
   */
  async get(name: string, _options?: ResourceOperationOptions): Promise<V1PersistentVolume> {
    try {
      const response = await this.client.core.readPersistentVolume({ name });
      return response;
    } catch (error) {
      this.handleApiError(error, 'Get', name);
    }
  }

  /**
   * Watch Persistent Volumes for changes
   */
  watch(
    callback: WatchCallback<V1PersistentVolume>,
    options?: ResourceOperationOptions,
  ): () => void {
    const watch = new k8s.Watch(this.client.kubeConfig);
    let aborted = false;

    const startWatch = async () => {
      try {
        const req = await watch.watch(
          '/api/v1/persistentvolumes',
          this.buildListOptions(options),
          (type: string, obj: V1PersistentVolume) => {
            if (!aborted) {
              callback({
                type: type as WatchEventType,
                object: obj,
              });
            }
          },
          (err: any) => {
            if (!aborted) {
              this.logger?.error(`Watch error for PVs: ${err}`);
              callback({
                type: WatchEventType.ERROR,
                object: err,
              });
            }
          },
        );
        return req;
      } catch (error) {
        this.logger?.error(`Failed to start watch for PVs: ${error}`);
        throw error;
      }
    };

    let request: any;
    startWatch().then((req) => {
      request = req;
    });

    return () => {
      aborted = true;
      if (request) {
        request.abort();
      }
    };
  }

  /**
   * Analyze PV status and issues
   */
  async analyzePVs(options?: PersistentVolumeOperationOptions): Promise<PVAnalysisResult> {
    const pvList = await this.list(options);
    const analysis: PVAnalysisResult = {
      total: pvList.items.length,
      byStatus: {},
      byStorageClass: {},
      byReclaimPolicy: {},
      unbound: [],
      issues: [],
    };

    // Get all PVCs to cross-reference
    const pvcList = await this.client.core.listPersistentVolumeClaimForAllNamespaces();

    for (const pv of pvList.items) {
      const status = pv.status?.phase || 'Unknown';
      const storageClass = pv.spec?.storageClassName || 'default';
      const reclaimPolicy = pv.spec?.persistentVolumeReclaimPolicy || 'Unknown';

      // Count by status
      analysis.byStatus[status] = (analysis.byStatus[status] || 0) + 1;

      // Count by storage class
      analysis.byStorageClass[storageClass] = (analysis.byStorageClass[storageClass] || 0) + 1;

      // Count by reclaim policy
      analysis.byReclaimPolicy[reclaimPolicy] = (analysis.byReclaimPolicy[reclaimPolicy] || 0) + 1;

      // Track unbound PVs
      if (status === 'Available') {
        analysis.unbound.push(pv);
      }

      // Check for issues
      // Failed PVs
      if (status === 'Failed') {
        analysis.issues.push({
          pv,
          issue: 'PersistentVolume is in Failed state',
          severity: 'error',
          recommendation:
            'Check storage backend health and PV configuration. Consider recreating the PV if storage is accessible.',
        });
      }

      // Released PVs that should be reclaimed
      if (status === 'Released') {
        if (reclaimPolicy === 'Delete') {
          analysis.issues.push({
            pv,
            issue:
              'PersistentVolume is Released but has Delete reclaim policy - should have been automatically deleted',
            severity: 'warning',
            recommendation:
              'Check storage controller logs for deletion issues or manually delete the PV if safe',
          });
        } else if (reclaimPolicy === 'Recycle') {
          analysis.issues.push({
            pv,
            issue: 'PersistentVolume is Released and waiting for recycling (deprecated feature)',
            severity: 'warning',
            recommendation:
              'Recycle policy is deprecated. Consider changing to Retain or Delete policy and handle cleanup manually',
          });
        } else {
          // Retain policy - this might be expected but worth noting
          analysis.issues.push({
            pv,
            issue: 'PersistentVolume is Released with Retain policy and needs manual cleanup',
            severity: 'info',
            recommendation:
              'Remove claimRef from the PV spec to make it Available again, or delete if no longer needed',
          });
        }
      }

      // Zero capacity PVs
      if (pv.spec?.capacity?.storage) {
        const capacityBytes = this.parseStorageSize(pv.spec.capacity.storage);
        if (capacityBytes === 0) {
          analysis.issues.push({
            pv,
            issue: 'PersistentVolume has zero storage capacity',
            severity: 'error',
            recommendation: 'Set a valid storage capacity in the PV spec',
          });
        }
      } else {
        analysis.issues.push({
          pv,
          issue: 'PersistentVolume is missing storage capacity specification',
          severity: 'error',
          recommendation: 'Add storage capacity to the PV spec',
        });
      }

      // Bound PVs without corresponding PVCs
      if (status === 'Bound' && pv.spec?.claimRef) {
        const claimRef = pv.spec.claimRef;
        const boundPVC = pvcList.items.find(
          (pvc) =>
            pvc.metadata?.name === claimRef.name && pvc.metadata?.namespace === claimRef.namespace,
        );

        if (!boundPVC) {
          analysis.issues.push({
            pv,
            issue: `PersistentVolume is bound to PVC '${claimRef.namespace}/${claimRef.name}' which does not exist`,
            severity: 'warning',
            recommendation:
              'Clear the claimRef to make the PV available or investigate why the PVC is missing',
          });
        } else if (boundPVC.status?.phase !== 'Bound') {
          analysis.issues.push({
            pv,
            issue: `PV is bound but the referenced PVC is in '${boundPVC.status?.phase}' state`,
            severity: 'warning',
            recommendation: 'Check the PVC status and binding process',
          });
        }
      }

      // Available PVs with no storage class but default exists
      if (status === 'Available' && !pv.spec?.storageClassName) {
        analysis.issues.push({
          pv,
          issue: 'PersistentVolume is Available but has no storage class',
          severity: 'info',
          recommendation:
            'Consider setting a storage class for better organization and matching with PVCs',
        });
      }

      // Check for PVs with deprecated volume types or configurations
      if (pv.spec?.hostPath) {
        analysis.issues.push({
          pv,
          issue: 'PersistentVolume uses hostPath which is not recommended for production',
          severity: 'warning',
          recommendation: 'Consider using a more robust storage solution for production workloads',
        });
      }

      // Check for missing access modes
      if (!pv.spec?.accessModes || pv.spec.accessModes.length === 0) {
        analysis.issues.push({
          pv,
          issue: 'PersistentVolume has no access modes defined',
          severity: 'error',
          recommendation:
            'Define appropriate access modes (ReadWriteOnce, ReadOnlyMany, or ReadWriteMany)',
        });
      }

      // Check for node affinity issues (if nodeAffinity is set)
      if (pv.spec?.nodeAffinity?.required?.nodeSelectorTerms) {
        // This is a simplified check - we'd need to verify against actual nodes
        const terms = pv.spec.nodeAffinity.required.nodeSelectorTerms;
        if (
          terms.length === 0 ||
          terms.some((term) => !term.matchExpressions || term.matchExpressions.length === 0)
        ) {
          analysis.issues.push({
            pv,
            issue: 'PersistentVolume has nodeAffinity set but no valid selector terms',
            severity: 'warning',
            recommendation: 'Review nodeAffinity configuration to ensure proper node selection',
          });
        }
      }
    }

    return analysis;
  }

  /**
   * Parse storage size string to bytes for comparison
   * Supports common Kubernetes storage units (Ki, Mi, Gi, Ti, K, M, G, T)
   */
  private parseStorageSize(sizeStr: string): number {
    if (!sizeStr) return 0;

    const units: { [key: string]: number } = {
      Ki: 1024,
      Mi: 1024 * 1024,
      Gi: 1024 * 1024 * 1024,
      Ti: 1024 * 1024 * 1024 * 1024,
      K: 1000,
      M: 1000 * 1000,
      G: 1000 * 1000 * 1000,
      T: 1000 * 1000 * 1000 * 1000,
      '': 1, // bytes
    };

    const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]*)$/);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2] || '';
    const multiplier = units[unit] || 1;

    return Math.floor(value * multiplier);
  }

  /**
   * Get PV usage information (requires metrics or node stats)
   */
  async getPVUsage(pvName: string): Promise<PVWithUsage | null> {
    try {
      const pv = await this.get(pvName);
      const pvWithUsage: PVWithUsage = { ...pv };

      // Try to get usage information from node stats
      // This would typically require access to kubelet stats API
      // For now, we'll return the PV without usage info
      pvWithUsage.usage = {
        capacity: pv.spec?.capacity?.storage || 'Unknown',
        used: 'Unknown',
        available: 'Unknown',
        percentUsed: 0,
      };

      return pvWithUsage;
    } catch (error) {
      this.logger?.error(`Failed to get PV usage for ${pvName}: ${error}`);
      return null;
    }
  }
}

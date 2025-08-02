import * as k8s from '@kubernetes/client-node';
import { V1PersistentVolumeClaim } from '@kubernetes/client-node';
import {
  BaseResourceOperations,
  ResourceOperationOptions,
  WatchCallback,
  WatchEventType,
} from '../BaseResourceOperations.js';
import { KubernetesClient } from '../KubernetesClient.js';

/**
 * PersistentVolumeClaim-specific operation options
 */
export interface PersistentVolumeClaimOperationOptions extends ResourceOperationOptions {
  /**
   * Filter by storage class
   */
  storageClass?: string;

  /**
   * Filter by access mode
   */
  accessMode?: string;

  /**
   * Filter by volume mode
   */
  volumeMode?: string;
}

/**
 * Represents a PVC with usage information
 */
export interface PVCWithUsage extends V1PersistentVolumeClaim {
  usage?: {
    capacity?: string;
    used?: string;
    available?: string;
    percentUsed?: number;
  };
  boundPV?: string;
}

/**
 * PVC analysis result
 */
export interface PVCAnalysisResult {
  total: number;
  byStatus: Record<string, number>;
  byStorageClass: Record<string, number>;
  pending: V1PersistentVolumeClaim[];
  issues: Array<{
    pvc: V1PersistentVolumeClaim;
    issue: string;
    severity: 'info' | 'warning' | 'error';
    recommendation?: string;
  }>;
}

/**
 * Operations for Kubernetes Persistent Volume Claims
 */
export class PersistentVolumeClaimOperations extends BaseResourceOperations<V1PersistentVolumeClaim> {
  constructor(client: KubernetesClient) {
    super(client, 'PersistentVolumeClaim');
  }

  protected getResourceNamespaced(): boolean {
    return true; // PVCs are namespaced
  }

  /**
   * Create operation is not supported for this read-only tool
   */
  async create(
    _resource: V1PersistentVolumeClaim,
    _options?: ResourceOperationOptions,
  ): Promise<V1PersistentVolumeClaim> {
    throw new Error('Create operation is not supported for this read-only PVC analysis tool');
  }

  /**
   * Update operation is not supported for this read-only tool
   */
  async update(
    _resource: V1PersistentVolumeClaim,
    _options?: ResourceOperationOptions,
  ): Promise<V1PersistentVolumeClaim> {
    throw new Error('Update operation is not supported for this read-only PVC analysis tool');
  }

  /**
   * Patch operation is not supported for this read-only tool
   */
  async patch(
    _name: string,
    _patch: any,
    _options?: ResourceOperationOptions,
  ): Promise<V1PersistentVolumeClaim> {
    throw new Error('Patch operation is not supported for this read-only PVC analysis tool');
  }

  /**
   * Delete operation is not supported for this read-only tool
   */
  async delete(_name: string, _options?: ResourceOperationOptions): Promise<void> {
    throw new Error('Delete operation is not supported for this read-only PVC analysis tool');
  }

  /**
   * List Persistent Volume Claims
   */
  async list(
    options?: PersistentVolumeClaimOperationOptions,
  ): Promise<k8s.V1PersistentVolumeClaimList> {
    try {
      let response;
      if (options?.namespace) {
        response = await this.client.core.listNamespacedPersistentVolumeClaim({
          namespace: options.namespace,
          ...this.buildListOptions(options),
        });
      } else {
        response = await this.client.core.listPersistentVolumeClaimForAllNamespaces(
          this.buildListOptions(options),
        );
      }

      // Apply additional filtering if needed
      if (options?.storageClass || options?.accessMode || options?.volumeMode) {
        response.items = response.items.filter((pvc) => {
          if (options.storageClass && pvc.spec?.storageClassName !== options.storageClass) {
            return false;
          }
          if (options.accessMode && !pvc.spec?.accessModes?.includes(options.accessMode)) {
            return false;
          }
          if (options.volumeMode && pvc.spec?.volumeMode !== options.volumeMode) {
            return false;
          }
          return true;
        });
      }

      return response;
    } catch (error) {
      this.handleApiError(error, 'List', `PVCs in ${options?.namespace || 'all namespaces'}`);
    }
  }

  /**
   * Get a specific Persistent Volume Claim by name
   */
  async get(name: string, options?: ResourceOperationOptions): Promise<V1PersistentVolumeClaim> {
    try {
      const namespace = options?.namespace || 'default';
      const response = await this.client.core.readNamespacedPersistentVolumeClaim({
        name,
        namespace,
      });
      return response;
    } catch (error) {
      this.handleApiError(error, 'Get', name);
    }
  }

  /**
   * Watch Persistent Volume Claims for changes
   */
  watch(
    callback: WatchCallback<V1PersistentVolumeClaim>,
    options?: ResourceOperationOptions,
  ): () => void {
    const namespace = options?.namespace;
    const watch = new k8s.Watch(this.client.kubeConfig);
    let aborted = false;

    const startWatch = async () => {
      try {
        const path = namespace
          ? `/api/v1/namespaces/${namespace}/persistentvolumeclaims`
          : '/api/v1/persistentvolumeclaims';

        const req = await watch.watch(
          path,
          this.buildListOptions(options),
          (type: string, obj: V1PersistentVolumeClaim) => {
            if (!aborted) {
              callback({
                type: type as WatchEventType,
                object: obj,
              });
            }
          },
          (err: any) => {
            if (!aborted) {
              this.logger?.error(`Watch error for PVCs: ${err}`);
              callback({
                type: WatchEventType.ERROR,
                object: err,
              });
            }
          },
        );
        return req;
      } catch (error) {
        this.logger?.error(`Failed to start watch for PVCs: ${error}`);
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
   * Analyze PVC status and issues
   */
  async analyzePVCs(options?: PersistentVolumeClaimOperationOptions): Promise<PVCAnalysisResult> {
    const pvcList = await this.list(options);
    const analysis: PVCAnalysisResult = {
      total: pvcList.items.length,
      byStatus: {},
      byStorageClass: {},
      pending: [],
      issues: [],
    };

    // Get all PVs to cross-reference
    const pvList = await this.client.core.listPersistentVolume();

    for (const pvc of pvcList.items) {
      const status = pvc.status?.phase || 'Unknown';
      const storageClass = pvc.spec?.storageClassName || 'default';

      // Count by status
      analysis.byStatus[status] = (analysis.byStatus[status] || 0) + 1;

      // Count by storage class
      analysis.byStorageClass[storageClass] = (analysis.byStorageClass[storageClass] || 0) + 1;

      // Track pending PVCs
      if (status === 'Pending') {
        analysis.pending.push(pvc);

        // Analyze why PVC is pending
        const requestedSize = pvc.spec?.resources?.requests?.storage;
        const requestedAccessModes = pvc.spec?.accessModes || [];
        const requestedStorageClass = pvc.spec?.storageClassName;

        // Check if there are available PVs that could satisfy this PVC
        const availablePVs = pvList.items.filter((pv) => pv.status?.phase === 'Available');

        if (availablePVs.length === 0) {
          analysis.issues.push({
            pvc,
            issue: 'No available PersistentVolumes found in the cluster',
            severity: 'error',
            recommendation:
              'Create a new PersistentVolume or enable dynamic provisioning for the storage class',
          });
          continue;
        }

        const matchingPVs = availablePVs.filter((pv) => {
          // Check storage class
          if (requestedStorageClass && pv.spec?.storageClassName !== requestedStorageClass) {
            return false;
          }

          // Check access modes - PV must support at least one of the requested modes
          const pvAccessModes = pv.spec?.accessModes || [];
          const hasMatchingAccessMode = requestedAccessModes.some((mode) =>
            pvAccessModes.includes(mode),
          );
          if (!hasMatchingAccessMode) {
            return false;
          }

          // Enhanced capacity checking with proper size comparison
          if (requestedSize && pv.spec?.capacity?.storage) {
            const requestedBytes = this.parseStorageSize(requestedSize);
            const pvCapacityBytes = this.parseStorageSize(pv.spec.capacity.storage);

            if (requestedBytes > pvCapacityBytes) {
              return false;
            }
          }

          return true;
        });

        if (matchingPVs.length === 0) {
          // Determine specific reasons for no matches
          const storageClassMatches = availablePVs.filter(
            (pv) => !requestedStorageClass || pv.spec?.storageClassName === requestedStorageClass,
          );

          const accessModeMatches = availablePVs.filter((pv) => {
            const pvAccessModes = pv.spec?.accessModes || [];
            return requestedAccessModes.some((mode) => pvAccessModes.includes(mode));
          });

          const sizeMatches = availablePVs.filter((pv) => {
            if (!requestedSize || !pv.spec?.capacity?.storage) return true;
            const requestedBytes = this.parseStorageSize(requestedSize);
            const pvCapacityBytes = this.parseStorageSize(pv.spec.capacity.storage);
            return requestedBytes <= pvCapacityBytes;
          });

          let issueDetail = 'No available PersistentVolumes match the PVC requirements';
          let recommendation = 'Check PVC requirements and available PVs';

          if (storageClassMatches.length === 0) {
            issueDetail = `No PersistentVolumes with storage class '${requestedStorageClass}' are available`;
            recommendation = `Create a PV with storage class '${requestedStorageClass}' or check if the storage class supports dynamic provisioning`;
          } else if (accessModeMatches.length === 0) {
            issueDetail = `No PersistentVolumes support the requested access modes: ${requestedAccessModes.join(', ')}`;
            recommendation =
              'Create a PV with compatible access modes or modify the PVC access mode requirements';
          } else if (sizeMatches.length === 0) {
            issueDetail = `No PersistentVolumes have sufficient capacity (requested: ${requestedSize})`;
            recommendation = 'Create a larger PV or reduce the PVC storage request';
          }

          analysis.issues.push({
            pvc,
            issue: issueDetail,
            severity: 'warning',
            recommendation,
          });
        } else {
          // PVC is pending but there are matching PVs - possible binding delay
          analysis.issues.push({
            pvc,
            issue: `PVC is pending despite ${matchingPVs.length} matching PV(s) being available`,
            severity: 'warning',
            recommendation: 'Check PVC events and storage controller logs for binding delays',
          });
        }
      }

      // Check for lost claims
      if (status === 'Lost') {
        analysis.issues.push({
          pvc,
          issue: 'PersistentVolumeClaim has lost its bound volume',
          severity: 'error',
          recommendation: 'Investigate why the bound PV was lost and restore from backup if needed',
        });
      }

      // Check for bound PVCs without a corresponding PV
      if (status === 'Bound' && pvc.spec?.volumeName) {
        const boundPV = pvList.items.find((pv) => pv.metadata?.name === pvc.spec?.volumeName);
        if (!boundPV) {
          analysis.issues.push({
            pvc,
            issue: `PersistentVolumeClaim is bound to PV '${pvc.spec.volumeName}' which does not exist`,
            severity: 'error',
            recommendation:
              'Investigate why the bound PV is missing and consider recreating the PVC',
          });
        } else if (boundPV.status?.phase !== 'Bound') {
          analysis.issues.push({
            pvc,
            issue: `PVC is bound but the referenced PV is in '${boundPV.status?.phase}' state`,
            severity: 'warning',
            recommendation: 'Check the PV status and storage backend health',
          });
        }
      }

      // Check for resource quota issues
      if (status === 'Pending' && pvc.spec?.resources?.requests?.storage) {
        // This is a simplified check - in reality, we'd need to query resource quotas
        const requestedSize = pvc.spec.resources.requests.storage;
        if (this.parseStorageSize(requestedSize) === 0) {
          analysis.issues.push({
            pvc,
            issue: 'PVC has zero storage request',
            severity: 'error',
            recommendation: 'Set a valid storage request size in the PVC spec',
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
   * Get PVC usage information with node stats integration
   */
  async getPVCUsage(name: string, namespace: string): Promise<PVCWithUsage | null> {
    try {
      const pvc = await this.get(name, { namespace });
      const pvcWithUsage: PVCWithUsage = { ...pvc };

      // Add bound PV information
      if (pvc.spec?.volumeName) {
        pvcWithUsage.boundPV = pvc.spec.volumeName;
      }

      // Try to get usage information from node stats
      // This would typically require access to kubelet stats API
      // For now, we'll return the PVC without usage info
      pvcWithUsage.usage = {
        capacity:
          pvc.status?.capacity?.storage || pvc.spec?.resources?.requests?.storage || 'Unknown',
        used: 'Unknown',
        available: 'Unknown',
        percentUsed: 0,
      };

      return pvcWithUsage;
    } catch (error) {
      this.logger?.error(`Failed to get PVC usage for ${name} in ${namespace}: ${error}`);
      return null;
    }
  }

  /**
   * Check PVC to PV binding relationships
   */
  async checkBindingStatus(): Promise<{
    bound: number;
    pending: number;
    available: number;
    bindingIssues: Array<{
      pvc: V1PersistentVolumeClaim;
      issue: string;
    }>;
  }> {
    const pvcList = await this.list();
    const pvList = await this.client.core.listPersistentVolume();

    const result = {
      bound: 0,
      pending: 0,
      available: 0,
      bindingIssues: [] as Array<{ pvc: V1PersistentVolumeClaim; issue: string }>,
    };

    for (const pvc of pvcList.items) {
      const status = pvc.status?.phase || 'Unknown';

      switch (status) {
        case 'Bound':
          result.bound++;
          break;
        case 'Pending':
          result.pending++;
          break;
        default:
          result.available++;
      }

      // Check for binding issues
      if (status === 'Bound' && pvc.spec?.volumeName) {
        const boundPV = pvList.items.find((pv) => pv.metadata?.name === pvc.spec?.volumeName);
        if (!boundPV) {
          result.bindingIssues.push({
            pvc,
            issue: `Bound to non-existent PV: ${pvc.spec.volumeName}`,
          });
        } else if (boundPV.status?.phase !== 'Bound') {
          result.bindingIssues.push({
            pvc,
            issue: `Bound PV is not in Bound state: ${boundPV.status?.phase}`,
          });
        }
      }
    }

    return result;
  }
}

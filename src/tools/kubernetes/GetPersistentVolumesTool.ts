import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  BaseTool,
  CommonSchemas,
  formatResourceMetadata,
  formatResourceStatus,
} from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

/**
 * List and analyze Persistent Volumes in a Kubernetes cluster
 */
export class GetPersistentVolumesTool implements BaseTool {
  tool: Tool = {
    name: 'get_persistent_volumes',
    description:
      'List all Persistent Volume resources in the current Kubernetes cluster and optionally analyze their status (similar to `kubectl get pv`)',
    inputSchema: {
      type: 'object',
      properties: {
        labelSelector: CommonSchemas.labelSelector,
        fieldSelector: CommonSchemas.fieldSelector,
        storageClass: {
          type: 'string',
          description: 'Filter by storage class name',
          optional: true,
        },
        reclaimPolicy: {
          type: 'string',
          description: 'Filter by reclaim policy (Retain, Delete, Recycle)',
          optional: true,
        },
        accessMode: {
          type: 'string',
          description: 'Filter by access mode (ReadWriteOnce, ReadOnlyMany, ReadWriteMany)',
          optional: true,
        },
        analyze: {
          type: 'boolean',
          description: 'Include detailed analysis with issue detection and statistics',
          optional: true,
          default: true,
        },
      },
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    try {
      const {
        labelSelector,
        fieldSelector,
        storageClass,
        reclaimPolicy,
        accessMode,
        analyze = true,
      } = params || {};
      const pvOperations = client.resources.persistentVolumes;

      let analysis;
      if (analyze) {
        analysis = await pvOperations.analyzePVs({
          labelSelector,
          fieldSelector,
          storageClass,
          reclaimPolicy,
          accessMode,
        });
      }

      const res = await pvOperations.list({
        labelSelector,
        fieldSelector,
        storageClass,
        reclaimPolicy,
        accessMode,
      });

      const persistentVolumes = res.items.map((pv: any) => ({
        metadata: formatResourceMetadata(pv),
        spec: {
          capacity: pv.spec?.capacity,
          storageClassName: pv.spec?.storageClassName,
          accessModes: pv.spec?.accessModes,
          persistentVolumeReclaimPolicy: pv.spec?.persistentVolumeReclaimPolicy,
          volumeMode: pv.spec?.volumeMode,
          claimRef: pv.spec?.claimRef,
        },
        status: {
          ...formatResourceStatus(pv),
          phase: pv.status?.phase,
          message: pv.status?.message,
          reason: pv.status?.reason,
        },
      }));

      return {
        total: persistentVolumes.length,
        analysis,
        persistentVolumes,
      };
    } catch (error: any) {
      const errorMessage = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list persistent volumes: ${errorMessage}`);
    }
  }
}

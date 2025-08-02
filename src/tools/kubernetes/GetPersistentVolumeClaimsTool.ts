import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  BaseTool,
  CommonSchemas,
  formatResourceMetadata,
  formatResourceStatus,
} from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

/**
 * List and analyze Persistent Volume Claims in a Kubernetes cluster
 */
export class GetPersistentVolumeClaimsTool implements BaseTool {
  tool: Tool = {
    name: 'get_persistent_volume_claims',
    description:
      'List Persistent Volume Claim resources in the current Kubernetes cluster and optionally analyze their status (similar to `kubectl get pvc`)',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: CommonSchemas.namespace,
        labelSelector: CommonSchemas.labelSelector,
        fieldSelector: CommonSchemas.fieldSelector,
        storageClass: {
          type: 'string',
          description: 'Filter by storage class name',
          optional: true,
        },
        accessMode: {
          type: 'string',
          description: 'Filter by access mode (ReadWriteOnce, ReadOnlyMany, ReadWriteMany)',
          optional: true,
        },
        volumeMode: {
          type: 'string',
          description: 'Filter by volume mode (Filesystem, Block)',
          optional: true,
        },
        analyze: {
          type: 'boolean',
          description: 'Include detailed analysis with issue detection and binding status',
          optional: true,
          default: true,
        },
      },
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    try {
      const {
        namespace,
        labelSelector,
        fieldSelector,
        storageClass,
        accessMode,
        volumeMode,
        analyze = true,
      } = params || {};
      const pvcOperations = client.resources.persistentVolumeClaims;

      let analysis = {};
      if (analyze) {
        analysis = await pvcOperations.analyzePVCs({
          namespace,
          labelSelector,
          fieldSelector,
          storageClass,
          accessMode,
          volumeMode,
        });
      }

      const bindingStatus = await pvcOperations.checkBindingStatus();

      const res = await pvcOperations.list({
        namespace,
        labelSelector,
        fieldSelector,
        storageClass,
        accessMode,
        volumeMode,
      });

      const persistentVolumeClaims = res.items.map((pvc: any) => ({
        metadata: formatResourceMetadata(pvc),
        spec: {
          storageClassName: pvc.spec?.storageClassName,
          accessModes: pvc.spec?.accessModes,
          resources: pvc.spec?.resources,
          volumeMode: pvc.spec?.volumeMode,
          volumeName: pvc.spec?.volumeName,
        },
        status: {
          ...formatResourceStatus(pvc),
          phase: pvc.status?.phase,
          capacity: pvc.status?.capacity,
        },
      }));

      return {
        total: persistentVolumeClaims.length,
        namespace: namespace || 'all',
        analysis,
        bindingStatus,
        persistentVolumeClaims,
      };
    } catch (error: any) {
      const errorMessage = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list persistent volume claims: ${errorMessage}`);
    }
  }
}

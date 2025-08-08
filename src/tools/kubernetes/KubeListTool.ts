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

/**
 * Consolidated list tool for Kubernetes resources
 */
export class KubeListTool implements BaseTool {
  tool: Tool = {
    name: 'kube_get',
    description:
      'Get Kubernetes resources by type with common selectors (supports: [pod, service, deployment, node, namespace, persistentvolume, persistentvolumeclaim, secret, configmap]).',
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
      },
      required: ['resourceType'],
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    const { resourceType, namespace, labelSelector, fieldSelector } = params || {};

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
        const ops = new PersistentVolumeOperations(client);
        return ops.list();
      }
      case 'persistentvolumeclaim': {
        const ops = new PersistentVolumeClaimOperations(client);
        return ops.list({ namespace });
      }
      case 'node': {
        // Use core API directly for nodes
        const nodes = await client.core.listNode();
        return nodes?.items ?? [];
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
          `Listing for resourceType "${resourceType}" not implemented in kube_get yet`,
        );
      }
      default:
        throw new Error(`Unsupported resourceType: ${resourceType}`);
    }
  }
}

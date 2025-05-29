import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  BaseCommand,
  CommonSchemas,
  formatResourceMetadata,
  formatResourceStatus,
} from './BaseCommand.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

/**
 * List pods in a Kubernetes cluster
 */
export class ListPodsCommand implements BaseCommand {
  tool: Tool = {
    name: 'list_pods',
    description: 'List pods in the Kubernetes cluster',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: CommonSchemas.namespace,
        labelSelector: CommonSchemas.labelSelector,
        fieldSelector: CommonSchemas.fieldSelector,
      },
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    try {
      const { namespace, labelSelector, fieldSelector } = params || {};

      let result;
      if (namespace) {
        // List pods in specific namespace
        result = await client.core.listNamespacedPod({
          namespace,
          labelSelector,
          fieldSelector,
        });
      } else {
        // List pods in all namespaces
        result = await client.core.listPodForAllNamespaces({
          labelSelector,
          fieldSelector,
        });
      }

      const pods = result.items.map((pod: any) => ({
        metadata: formatResourceMetadata(pod),
        status: {
          ...formatResourceStatus(pod),
          phase: pod.status?.phase,
          podIP: pod.status?.podIP,
          hostIP: pod.status?.hostIP,
          startTime: pod.status?.startTime,
          containerStatuses:
            pod.status?.containerStatuses?.map((cs: any) => ({
              name: cs.name,
              image: cs.image,
              ready: cs.ready,
              restartCount: cs.restartCount,
              state: cs.state,
            })) || [],
        },
        spec: {
          nodeName: pod.spec?.nodeName,
          containers:
            pod.spec?.containers?.map((c: any) => ({
              name: c.name,
              image: c.image,
              ports: c.ports || [],
              resources: c.resources || {},
            })) || [],
        },
      }));

      return {
        total: pods.length,
        namespace: namespace || 'all',
        pods,
      };
    } catch (error: any) {
      const errorMessage = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list pods: ${errorMessage}`);
    }
  }
}

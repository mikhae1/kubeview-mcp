import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseCommand, CommonSchemas, formatResourceMetadata } from './BaseCommand.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

/**
 * List services in a Kubernetes cluster
 */
export class ListServicesCommand implements BaseCommand {
  tool: Tool = {
    name: 'list_services',
    description: 'List services in the Kubernetes cluster',
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
        // List services in specific namespace
        result = await client.core.listNamespacedService({
          namespace,
          labelSelector,
          fieldSelector,
        });
      } else {
        // List services in all namespaces
        result = await client.core.listServiceForAllNamespaces({
          labelSelector,
          fieldSelector,
        });
      }

      const services = result.items.map((service: any) => ({
        metadata: formatResourceMetadata(service),
        spec: {
          type: service.spec?.type,
          clusterIP: service.spec?.clusterIP,
          externalIPs: service.spec?.externalIPs || [],
          ports:
            service.spec?.ports?.map((port: any) => ({
              name: port.name,
              protocol: port.protocol,
              port: port.port,
              targetPort: port.targetPort,
              nodePort: port.nodePort,
            })) || [],
          selector: service.spec?.selector || {},
          sessionAffinity: service.spec?.sessionAffinity,
          loadBalancerIP: service.spec?.loadBalancerIP,
          externalName: service.spec?.externalName,
        },
        status: {
          loadBalancer: service.status?.loadBalancer,
        },
      }));

      return {
        total: services.length,
        namespace: namespace || 'all',
        services,
      };
    } catch (error: any) {
      const errorMessage = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to list services: ${errorMessage}`);
    }
  }
}

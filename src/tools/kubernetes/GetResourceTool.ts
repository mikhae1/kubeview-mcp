import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { ConfigMapOperations } from '../../kubernetes/resources/ConfigMapOperations.js';
import { PodOperations } from '../../kubernetes/resources/PodOperations.js';
import { ServiceOperations } from '../../kubernetes/resources/ServiceOperations.js';
import { DeploymentOperations } from '../../kubernetes/resources/DeploymentOperations.js';
import { SecretOperations } from '../../kubernetes/resources/SecretOperations.js';

/**
 * Get details of a specific Kubernetes resource
 */
export class GetResourceTool implements BaseTool {
  tool: Tool = {
    name: 'kube_describe',
    description:
      'Describe a single Kubernetes resource by type and name (supports: [pod, service, deployment, configmap, secret]). Returns a concise, LLM-friendly structure with metadata, spec highlights, and status.',
    inputSchema: {
      type: 'object',
      properties: {
        resourceType: {
          type: 'string',
          description: 'Type of resource (pod, service, deployment, configmap, secret)',
          enum: ['pod', 'service', 'deployment', 'configmap', 'secret'],
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
      },
      required: ['resourceType', 'name'],
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    try {
      const { resourceType, name, namespace = 'default', skipSanitize } = params;

      switch (resourceType) {
        case 'pod':
          return await new PodOperations(client).getFormatted(name, { namespace });
        case 'service':
          return await new ServiceOperations(client).getFormatted(name, { namespace });
        case 'deployment':
          return await new DeploymentOperations(client).getFormatted(name, { namespace });
        case 'configmap':
          return await this.getConfigMapDetails(client, name, namespace, skipSanitize);
        case 'secret':
          return await new SecretOperations(client).getFormatted(name, { namespace });
        default:
          throw new Error(`Unsupported resource type: ${resourceType}`);
      }
    } catch (error: any) {
      const errorMessage = error.response?.body?.message || error.message || 'Unknown error';
      throw new Error(`Failed to get resource details: ${errorMessage}`);
    }
  }

  private async getConfigMapDetails(
    client: KubernetesClient,
    name: string,
    namespace: string,
    skipSanitize?: boolean,
  ): Promise<any> {
    const configMapOperations = new ConfigMapOperations(client);
    const configMap = await configMapOperations.get(name, { namespace, skipSanitize });

    return {
      resourceType: 'configmap',
      metadata: {
        name: configMap.metadata?.name,
        namespace: configMap.metadata?.namespace,
        uid: configMap.metadata?.uid,
        resourceVersion: configMap.metadata?.resourceVersion,
        generation: configMap.metadata?.generation,
        creationTimestamp: configMap.metadata?.creationTimestamp,
        labels: configMap.metadata?.labels || {},
        annotations: configMap.metadata?.annotations || {},
      },
      data: configMap.data || {},
      binaryData: configMap.binaryData ? Object.keys(configMap.binaryData) : [],
    };
  }
}

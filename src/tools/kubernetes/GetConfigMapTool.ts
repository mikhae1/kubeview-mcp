import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { ConfigMapOperations } from '../../kubernetes/resources/ConfigMapOperations.js';

/**
 * List ConfigMaps in a Kubernetes cluster with optional data sanitization
 */
export class GetConfigMapsTool implements BaseTool {
  tool: Tool = {
    name: 'get_configmaps',
    description:
      'List all ConfigMap resources in the current Kubernetes cluster (similar to `kubectl get configmap`)',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: CommonSchemas.namespace,
        labelSelector: CommonSchemas.labelSelector,
        fieldSelector: CommonSchemas.fieldSelector,
        skipSanitize: {
          type: 'boolean',
          description:
            'Skip sanitizing sensitive data in ConfigMap values (default: false, meaning sanitization is enabled by default)',
          optional: true,
        },
      },
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    return await new ConfigMapOperations(client).list(params);
  }
}

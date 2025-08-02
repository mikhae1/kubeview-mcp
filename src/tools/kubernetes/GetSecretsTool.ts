import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { SecretOperations } from '../../kubernetes/resources/SecretOperations.js';

/**
 * List Secret in a Kubernetes cluster with optional data sanitization
 */
export class GetSecretsTool implements BaseTool {
  tool: Tool = {
    name: 'get_secrets',
    description:
      'List all Secret resources in the current Kubernetes cluster (similar to `kubectl get secrets`)',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: CommonSchemas.namespace,
        labelSelector: CommonSchemas.labelSelector,
        fieldSelector: CommonSchemas.fieldSelector,
        skipSanitize: {
          type: 'boolean',
          description:
            'Skip sanitizing sensitive data in Secret values (default: false, meaning sanitization is enabled by default)',
          optional: true,
        },
      },
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    try {
      const { namespace, labelSelector, fieldSelector, skipSanitize } = params || {};

      const secretOperations = new SecretOperations(client);

      let res;
      if (namespace) {
        res = await secretOperations.list({
          namespace,
          labelSelector,
          fieldSelector,
          skipSanitize,
        });
      } else {
        res = await secretOperations.list({ labelSelector, fieldSelector, skipSanitize });
      }

      return res;
    } catch (error: any) {
      return {
        error: `Failed to get secrets: ${error.message}`,
      };
    }
  }
}

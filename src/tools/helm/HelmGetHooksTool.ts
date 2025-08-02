import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { HelmBaseTool, HelmCommonSchemas, executeHelmCommand } from './BaseTool.js';

/**
 * Get hooks for a Helm release
 */
export class HelmGetHooksTool implements HelmBaseTool {
  tool: Tool = {
    name: 'helm_get_hooks',
    description: 'Get the hooks for a named release (similar to `helm get hooks`)',
    inputSchema: {
      type: 'object',
      properties: {
        releaseName: HelmCommonSchemas.releaseName,
        namespace: HelmCommonSchemas.namespace,
        revision: HelmCommonSchemas.revision,
      },
      required: ['releaseName'],
    },
  };

  async execute(params: any): Promise<any> {
    try {
      const args = ['get', 'hooks', params.releaseName];

      // Add namespace parameter
      if (params.namespace) {
        args.push('--namespace', params.namespace);
      }

      // Add revision parameter
      if (params.revision) {
        args.push('--revision', params.revision.toString());
      }

      const result = await executeHelmCommand(args);
      return result;
    } catch (error: any) {
      throw new Error(
        `Failed to get hooks for Helm release '${params.releaseName}': ${error.message}`,
      );
    }
  }
}

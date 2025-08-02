import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { HelmBaseTool, HelmCommonSchemas, executeHelmCommand } from './BaseTool.js';

/**
 * Get manifest for a Helm release
 */
export class HelmGetManifestTool implements HelmBaseTool {
  tool: Tool = {
    name: 'helm_get_manifest',
    description: 'Get the manifest for a named release (similar to `helm get manifest`)',
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
      const args = ['get', 'manifest', params.releaseName];

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
        `Failed to get manifest for Helm release '${params.releaseName}': ${error.message}`,
      );
    }
  }
}

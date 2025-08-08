import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { HelmBaseTool, HelmCommonSchemas, executeHelmCommand } from './BaseTool.js';

/**
 * Consolidated Helm release tool for status and history.
 */
export class HelmReleaseTool implements HelmBaseTool {
  tool: Tool = {
    name: 'helm_release',
    description: 'Get Helm release status or history',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['status', 'history'] },
        releaseName: HelmCommonSchemas.releaseName,
        namespace: HelmCommonSchemas.namespace,
        outputFormat: { ...HelmCommonSchemas.outputFormat, optional: true },
      },
      required: ['operation', 'releaseName'],
    },
  };

  async execute(params: any): Promise<any> {
    const { operation, releaseName, namespace, outputFormat } = params || {};
    switch (operation) {
      case 'status': {
        const args = ['status', releaseName];
        if (namespace) args.push('--namespace', namespace);
        if (outputFormat) args.push('--output', outputFormat);
        return executeHelmCommand(args);
      }
      case 'history': {
        const args = ['history', releaseName];
        if (namespace) args.push('--namespace', namespace);
        if (outputFormat) args.push('--output', outputFormat);
        return executeHelmCommand(args);
      }
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
  }
}

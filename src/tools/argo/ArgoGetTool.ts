import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ArgoBaseTool, ArgoCommonSchemas, executeArgoCommand } from './BaseTool.js';

/**
 * Get details of an Argo workflow
 */
export class ArgoGetTool implements ArgoBaseTool {
  tool: Tool = {
    name: 'argo_get',
    description: 'Get details of an Argo workflow (similar to `argo get <workflow-name>`)',
    inputSchema: {
      type: 'object',
      properties: {
        workflowName: ArgoCommonSchemas.workflowName,
        namespace: ArgoCommonSchemas.namespace,
        outputFormat: {
          type: 'string',
          description: 'Output format for workflow details. Supports: json, yaml, wide',
          enum: ['json', 'yaml', 'wide'],
          optional: true,
          default: 'json',
        },
        showParameters: {
          type: 'boolean',
          description: 'Show workflow parameters',
          optional: true,
        },
        showArtifacts: {
          type: 'boolean',
          description: 'Show workflow artifacts',
          optional: true,
        },
        showEvents: {
          type: 'boolean',
          description: 'Show workflow events',
          optional: true,
        },
        nodeFieldSelector: {
          type: 'string',
          description: 'Field selector to filter nodes',
          optional: true,
        },
      },
      required: ['workflowName'],
    },
  };

  async execute(params: any): Promise<any> {
    const args = ['get', params.workflowName];

    // Add namespace specification
    if (params.namespace) {
      args.push('-n', params.namespace);
    }

    // Add output format
    if (params.outputFormat) {
      args.push('-o', params.outputFormat);
    } else {
      args.push('-o', 'json');
    }

    // Add optional flags
    if (params.showParameters) {
      args.push('--show-parameters');
    }

    if (params.showArtifacts) {
      args.push('--show-artifacts');
    }

    if (params.showEvents) {
      args.push('--show-events');
    }

    if (params.nodeFieldSelector) {
      args.push('--node-field-selector', params.nodeFieldSelector);
    }

    try {
      const result = await executeArgoCommand(args);
      return result;
    } catch (error) {
      throw new Error(
        `Failed to get Argo workflow ${params.workflowName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

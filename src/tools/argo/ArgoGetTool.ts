import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { toMcpToolResult } from '../../utils/McpToolResult.js';
import {
  ArgoBaseTool,
  ArgoCommonSchemas,
  executeArgoCommand,
  validateArgoCLI,
  isRecoverableK8sError,
  markTransport,
} from './BaseTool.js';

async function getWorkflowViaK8s(params: any, client: KubernetesClient): Promise<any> {
  await client.refreshCurrentContext();

  const group = 'argoproj.io';
  const version = 'v1alpha1';
  const plural = 'workflows';
  const namespace = params?.namespace || 'argo';
  const workflowName = params?.workflowName;

  const resp = (await client.customObjects.getNamespacedCustomObject({
    group,
    version,
    namespace,
    plural,
    name: workflowName,
  })) as any;
  return (resp?.body ?? resp) as any;
}

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

  async execute(params: any, client?: KubernetesClient): Promise<any> {
    const outputFormat = params?.outputFormat || 'json';
    if (outputFormat === 'json' && client) {
      // Try Kubernetes API first if client is available
      try {
        const result = await getWorkflowViaK8s(params, client);
        return toMcpToolResult(markTransport(result, 'k8s'));
      } catch (error: any) {
        if (!isRecoverableK8sError(error)) {
          // Non-recoverable error, fallback to CLI
        }
        // Recoverable error (404, 403, etc.), fallback to CLI
      }
    }

    const args = ['get', params.workflowName];

    // Add namespace specification
    if (params.namespace) {
      args.push('-n', params.namespace);
    }

    // Add output format
    if (outputFormat) {
      args.push('-o', outputFormat);
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
      await validateArgoCLI();
      const result = await executeArgoCommand(args);
      const output =
        typeof result === 'object' && result !== null && 'output' in result
          ? (result as any).output
          : result;
      return toMcpToolResult(markTransport(output, 'cli'));
    } catch (error) {
      throw new Error(
        `Failed to get Argo workflow ${params.workflowName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import {
  ArgoBaseTool,
  ArgoCommonSchemas,
  executeArgoCommand,
  validateArgoCLI,
} from './BaseTool.js';

function buildKubernetesClientFromEnv(): KubernetesClient {
  const context = process.env.MCP_KUBE_CONTEXT;
  const skipTlsEnv = process.env.MCP_K8S_SKIP_TLS_VERIFY;
  const skipTlsVerify = skipTlsEnv === 'true' || skipTlsEnv === '1';

  return new KubernetesClient({
    context: context && context.trim().length > 0 ? context.trim() : undefined,
    skipTlsVerify,
  });
}

function isRecoverableK8sError(error: any): boolean {
  const statusCode = error?.statusCode ?? error?.response?.statusCode;
  if (statusCode === 404 || statusCode === 403 || statusCode === 401) return true;
  const code = error?.body?.code;
  if (code === 404 || code === 403 || code === 401) return true;
  const reason = error?.body?.reason;
  if (reason === 'NotFound' || reason === 'Forbidden' || reason === 'Unauthorized') return true;
  return false;
}

async function getWorkflowViaK8s(params: any): Promise<any> {
  const client = buildKubernetesClientFromEnv();
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

  async execute(params: any): Promise<any> {
    const outputFormat = params?.outputFormat || 'json';
    if (outputFormat === 'json') {
      try {
        return await getWorkflowViaK8s(params);
      } catch (error: any) {
        if (!isRecoverableK8sError(error)) {
          throw new Error(
            `Failed to get Argo workflow ${params.workflowName} via Kubernetes API: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
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
      if (typeof result === 'object' && result !== null && 'output' in result) {
        return (result as any).output;
      }
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

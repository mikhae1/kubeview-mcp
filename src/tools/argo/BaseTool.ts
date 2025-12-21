import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeCliCommand, validateCli } from '../../utils/CliUtils.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

/**
 * Base interface for all Argo MCP tool commands
 */
export interface ArgoBaseTool {
  /**
   * The tool definition for MCP registration
   */
  tool: Tool;

  /**
   * Execute the command with given parameters
   * @param params Command parameters
   * @param client Optional Kubernetes client (provided by plugin when available)
   */
  execute(params: any, client?: KubernetesClient): Promise<any>;
}

/**
 * Common parameter schemas used across multiple Argo commands
 */
export const ArgoCommonSchemas = {
  namespace: {
    type: 'string',
    description: 'Kubernetes namespace (defaults to argo namespace if not specified)',
    optional: true,
  },
  labelSelector: {
    type: 'string',
    description: 'Label selector to filter resources (e.g., "app=myapp")',
    optional: true,
  },
  workflowName: {
    type: 'string',
    description: 'Name of the Argo workflow',
  },
  cronWorkflowName: {
    type: 'string',
    description: 'Name of the Argo cron workflow',
  },
  outputFormat: {
    type: 'string',
    description: 'Output format (json, yaml, name, wide)',
    enum: ['json', 'yaml', 'name', 'wide'],
    optional: true,
  },
  selector: {
    type: 'string',
    description: 'Selector (label query) to filter on',
    optional: true,
  },
  allNamespaces: {
    type: 'boolean',
    description: 'List workflows across all namespaces',
    optional: true,
  },
};

/**
 * Executes an argo command using the argo CLI
 * @param args Array of command arguments
 * @param argoExecutable Optional argo executable path (for fallback scenarios)
 * @returns Promise with the command output
 */
export async function executeArgoCommand(args: string[], argoExecutable = 'argo'): Promise<any> {
  return executeCliCommand('argo', args, argoExecutable, 'ARGO_TIMEOUT');
}

/**
 * Validates that argo CLI is available with fallback detection
 */
export async function validateArgoCLI(): Promise<void> {
  return validateCli('argo', ['version'], 'ARGO_TIMEOUT');
}

/**
 * Check if a Kubernetes API error is recoverable (should trigger fallback to CLI)
 */
export function isRecoverableK8sError(error: any): boolean {
  const statusCode = error?.statusCode ?? error?.response?.statusCode;
  if (statusCode === 404 || statusCode === 403 || statusCode === 401) return true;
  const code = error?.body?.code;
  if (code === 404 || code === 403 || code === 401) return true;
  const reason = error?.body?.reason;
  if (reason === 'NotFound' || reason === 'Forbidden' || reason === 'Unauthorized') return true;
  return false;
}

/**
 * Mark the transport method used (k8s, cli) in the result
 */
export function markTransport<T>(value: T, transport: 'k8s' | 'cli'): T {
  if (value && typeof value === 'object') {
    Object.defineProperty(value as any, '__transport', {
      value: transport,
      enumerable: false,
      configurable: true,
    });
  }
  return value;
}

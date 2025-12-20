import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeCliCommand, validateCli } from '../../utils/CliUtils.js';

/**
 * Base interface for all ArgoCD MCP tool commands
 */
export interface ArgoCDBaseTool {
  /**
   * The tool definition for MCP registration
   */
  tool: Tool;

  /**
   * Execute the command with given parameters
   */
  execute(params: any): Promise<any>;
}

/**
 * Common parameter schemas used across multiple ArgoCD commands
 */
export const ArgoCDCommonSchemas = {
  namespace: {
    type: 'string',
    description: 'Kubernetes namespace (defaults to argocd namespace if not specified)',
    optional: true,
  },
  labelSelector: {
    type: 'string',
    description: 'Label selector to filter resources (e.g., "app=myapp")',
    optional: true,
  },
  appName: {
    type: 'string',
    description: 'Name of the ArgoCD application',
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
  server: {
    type: 'string',
    description: 'ArgoCD server address',
    optional: true,
  },
  grpcWeb: {
    type: 'boolean',
    description: 'Use gRPC-Web protocol',
    optional: true,
  },
  plaintext: {
    type: 'boolean',
    description: 'Use plaintext connection (no TLS)',
    optional: true,
  },
  insecure: {
    type: 'boolean',
    description: 'Skip server certificate and domain verification',
    optional: true,
  },
};

/**
 * Executes an argocd command using the argocd CLI
 * @param args Array of command arguments
 * @param argoCDExecutable Optional argocd executable path (for fallback scenarios)
 * @returns Promise with the command output
 */
export async function executeArgoCDCommand(
  args: string[],
  argoCDExecutable = 'argocd',
): Promise<any> {
  return executeCliCommand('argocd', args, argoCDExecutable, 'ARGOCD_TIMEOUT');
}

/**
 * Validates that argocd CLI is available with fallback detection
 */
export async function validateArgoCDCLI(): Promise<void> {
  return validateCli('argocd', ['version', '--client'], 'ARGOCD_TIMEOUT');
}

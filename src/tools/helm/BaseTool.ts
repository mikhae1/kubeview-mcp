import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { executeCliCommand, validateCli } from '../../utils/CliUtils.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

/**
 * Base interface for all Helm MCP tool commands
 */
export interface HelmBaseTool {
  /**
   * The tool definition for MCP registration
   */
  tool: Tool;

  /**
   * Execute the command with given parameters
   */
  execute(params: any, client?: KubernetesClient): Promise<any>;
}

/**
 * Common parameter schemas used across multiple Helm commands
 */
export const HelmCommonSchemas = {
  namespace: {
    type: 'string',
    description: 'Kubernetes namespace (defaults to all namespaces if not specified)',
    optional: true,
  },
  releaseName: {
    type: 'string',
    description: 'Name of the Helm release',
  },
  revision: {
    type: 'number',
    description: 'Revision number of the release',
    optional: true,
  },
  outputFormat: {
    type: 'string',
    description: 'Output format (json, yaml, table)',
    enum: ['json', 'yaml', 'table'],
    optional: true,
  },
};

/**
 * Executes a helm command using the helm CLI
 * @param args Array of command arguments
 * @param helmExecutable Optional helm executable path (for fallback scenarios)
 * @returns Promise with the command output
 */
export async function executeHelmCommand(args: string[], helmExecutable = 'helm'): Promise<any> {
  return executeCliCommand('helm', args, helmExecutable, 'HELM_TIMEOUT');
}

/**
 * Validates that helm CLI is available with fallback detection
 */
export async function validateHelmCLI(): Promise<void> {
  return validateCli('helm', ['version', '--short'], 'HELM_TIMEOUT');
}

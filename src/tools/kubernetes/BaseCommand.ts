import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';

/**
 * Base interface for all Kubernetes MCP tool commands
 */
export interface BaseCommand {
  /**
   * The tool definition for MCP registration
   */
  tool: Tool;

  /**
   * Execute the command with given parameters
   */
  execute(params: any, client: KubernetesClient): Promise<any>;
}

/**
 * Common parameter schemas used across multiple commands
 */
export const CommonSchemas = {
  namespace: {
    type: 'string',
    description: 'Kubernetes namespace (defaults to all namespaces if not specified)',
    optional: true,
  },
  labelSelector: {
    type: 'string',
    description: 'Label selector to filter resources (e.g., "app=nginx")',
    optional: true,
  },
  fieldSelector: {
    type: 'string',
    description: 'Field selector to filter resources (e.g., "status.phase=Running")',
    optional: true,
  },
  name: {
    type: 'string',
    description: 'Name of the resource',
  },
};

/**
 * Format resource metadata for consistent output
 */
export function formatResourceMetadata(resource: any): any {
  return {
    name: resource.metadata?.name,
    namespace: resource.metadata?.namespace,
    uid: resource.metadata?.uid,
    creationTimestamp: resource.metadata?.creationTimestamp,
    labels: resource.metadata?.labels || {},
    annotations: resource.metadata?.annotations || {},
  };
}

/**
 * Format resource status with common fields
 */
export function formatResourceStatus(resource: any): any {
  const status: any = {
    phase: resource.status?.phase,
    conditions: resource.status?.conditions || [],
  };

  // Add resource-specific status fields if they exist
  if (resource.status?.readyReplicas !== undefined) {
    status.readyReplicas = resource.status.readyReplicas;
  }
  if (resource.status?.replicas !== undefined) {
    status.replicas = resource.status.replicas;
  }

  return status;
}

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { HelmBaseTool, HelmCommonSchemas, executeHelmCommand } from './BaseTool.js';

/**
 * Get Kubernetes resources for a Helm release using helm get manifest and parse them
 */
export class HelmGetResourcesTool implements HelmBaseTool {
  tool: Tool = {
    name: 'helm_get_resources',
    description: 'Get Kubernetes resources created by a Helm release with resource analysis',
    inputSchema: {
      type: 'object',
      properties: {
        releaseName: HelmCommonSchemas.releaseName,
        namespace: HelmCommonSchemas.namespace,
        revision: HelmCommonSchemas.revision,
        resourceType: {
          type: 'string',
          description:
            'Filter by specific Kubernetes resource type (e.g., Pod, Service, Deployment)',
          optional: true,
        },
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

      // Parse the YAML manifest to extract resource information
      const manifestText = result.output || result;
      const resources = this.parseKubernetesManifest(manifestText, params.resourceType);

      return {
        releaseName: params.releaseName,
        namespace: params.namespace,
        revision: params.revision,
        totalResources: resources.length,
        resourceTypes: this.getResourceTypeSummary(resources),
        resources,
      };
    } catch (error: any) {
      throw new Error(
        `Failed to get resources for Helm release '${params.releaseName}': ${error.message}`,
      );
    }
  }

  private parseKubernetesManifest(manifestText: string, filterType?: string): any[] {
    const resources: any[] = [];

    if (!manifestText || typeof manifestText !== 'string') {
      return resources;
    }

    // Split by YAML document separator
    const documents = manifestText.split('---').filter((doc) => doc.trim());

    for (const doc of documents) {
      try {
        // Simple YAML parsing for basic resource information
        const resource = this.parseYamlDocument(doc);
        if (resource && resource.kind && resource.metadata) {
          // Filter by resource type if specified
          if (!filterType || resource.kind.toLowerCase() === filterType.toLowerCase()) {
            resources.push({
              kind: resource.kind,
              apiVersion: resource.apiVersion,
              name: resource.metadata.name,
              namespace: resource.metadata.namespace,
              labels: resource.metadata.labels || {},
              annotations: resource.metadata.annotations || {},
            });
          }
        }
      } catch {
        // Skip invalid YAML documents
        continue;
      }
    }

    return resources;
  }

  private parseYamlDocument(yamlText: string): any {
    // Simple YAML parser for basic fields - this is a basic implementation
    // In a production environment, you'd want to use a proper YAML library
    const lines = yamlText.trim().split('\n');
    const resource: any = { metadata: {} };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed.startsWith('kind:')) {
        resource.kind = trimmed.split(':')[1].trim();
      } else if (trimmed.startsWith('apiVersion:')) {
        resource.apiVersion = trimmed.split(':')[1].trim();
      } else if (trimmed.includes('name:') && !trimmed.includes('namespace:')) {
        // Try to capture metadata.name
        const match = trimmed.match(/name:\s*(.+)/);
        if (match) {
          resource.metadata.name = match[1].trim();
        }
      } else if (trimmed.includes('namespace:')) {
        const match = trimmed.match(/namespace:\s*(.+)/);
        if (match) {
          resource.metadata.namespace = match[1].trim();
        }
      }
    }

    return resource.kind ? resource : null;
  }

  private getResourceTypeSummary(resources: any[]): Record<string, number> {
    const summary: Record<string, number> = {};

    for (const resource of resources) {
      const kind = resource.kind;
      summary[kind] = (summary[kind] || 0) + 1;
    }

    return summary;
  }
}

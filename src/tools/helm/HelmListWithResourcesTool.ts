import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { HelmBaseTool, HelmCommonSchemas, executeHelmCommand } from './BaseTool.js';

/**
 * List Helm releases with detailed Kubernetes resource information
 */
export class HelmListWithResourcesTool implements HelmBaseTool {
  tool: Tool = {
    name: 'helm_list_with_resources',
    description: 'List Helm releases with detailed Kubernetes resource breakdown',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: HelmCommonSchemas.namespace,
        allNamespaces: {
          type: 'boolean',
          description: 'List releases across all namespaces',
          optional: true,
        },
        outputFormat: {
          ...HelmCommonSchemas.outputFormat,
          default: 'json',
        },
        includeResources: {
          type: 'boolean',
          description: 'Include detailed resource information for each release',
          default: true,
          optional: true,
        },
      },
    },
  };

  async execute(params: any): Promise<any> {
    try {
      // First get the basic release list
      const listArgs = ['list'];

      // Add namespace parameter
      if (params.namespace) {
        listArgs.push('--namespace', params.namespace);
      } else if (params.allNamespaces) {
        listArgs.push('--all-namespaces');
      }

      // Add output format
      const outputFormat = params.outputFormat || 'json';
      listArgs.push('--output', outputFormat);

      const listResult = await executeHelmCommand(listArgs);
      const releases = Array.isArray(listResult) ? listResult : listResult.releases || [];

      // If resource details are requested, enrich each release
      if (params.includeResources !== false && releases.length > 0) {
        for (const release of releases) {
          try {
            // Get manifest for each release to analyze resources
            const manifestArgs = ['get', 'manifest', release.name];
            if (release.namespace) {
              manifestArgs.push('--namespace', release.namespace);
            }

            const manifestResult = await executeHelmCommand(manifestArgs);
            const manifestText = manifestResult.output || manifestResult;
            const resources = this.parseKubernetesManifest(manifestText);

            release.resources = {
              total: resources.length,
              byType: this.getResourceTypeSummary(resources),
              details: resources,
            };
          } catch (error: any) {
            // If we can't get resources for a release, just note the error
            release.resources = {
              error: `Failed to get resources: ${error.message}`,
            };
          }
        }
      }

      return {
        totalReleases: releases.length,
        releases,
        summary: this.generateSummary(releases),
      };
    } catch (error: any) {
      throw new Error(`Failed to list Helm releases with resources: ${error.message}`);
    }
  }

  private parseKubernetesManifest(manifestText: string): any[] {
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
          resources.push({
            kind: resource.kind,
            apiVersion: resource.apiVersion,
            name: resource.metadata.name,
            namespace: resource.metadata.namespace,
          });
        }
      } catch {
        // Skip invalid YAML documents
        continue;
      }
    }

    return resources;
  }

  private parseYamlDocument(yamlText: string): any {
    // Simple YAML parser for basic fields
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

  private generateSummary(releases: any[]): any {
    const summary = {
      totalReleases: releases.length,
      byStatus: {} as Record<string, number>,
      byNamespace: {} as Record<string, number>,
      totalResources: 0,
      resourceTypes: {} as Record<string, number>,
    };

    for (const release of releases) {
      // Count by status
      const status = release.status || 'unknown';
      summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;

      // Count by namespace
      const namespace = release.namespace || 'default';
      summary.byNamespace[namespace] = (summary.byNamespace[namespace] || 0) + 1;

      // Aggregate resource information
      if (release.resources && release.resources.total) {
        summary.totalResources += release.resources.total;

        if (release.resources.byType) {
          for (const [type, count] of Object.entries(release.resources.byType)) {
            summary.resourceTypes[type] = (summary.resourceTypes[type] || 0) + (count as number);
          }
        }
      }
    }

    return summary;
  }
}

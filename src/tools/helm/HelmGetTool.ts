import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { HelmBaseTool, HelmCommonSchemas, executeHelmCommand } from './BaseTool.js';

/**
 * Helm "get" tool covering values, manifest, notes, hooks, and resources.
 */
export class HelmGetTool implements HelmBaseTool {
  tool: Tool = {
    name: 'helm_get',
    description: 'Get Helm release data: values, manifest, notes, hooks, or parsed resources.',
    inputSchema: {
      type: 'object',
      properties: {
        what: {
          type: 'string',
          enum: ['values', 'manifest', 'notes', 'hooks', 'resources'],
        },
        releaseName: HelmCommonSchemas.releaseName,
        namespace: HelmCommonSchemas.namespace,
        revision: HelmCommonSchemas.revision,
        outputFormat: {
          ...HelmCommonSchemas.outputFormat,
          optional: true,
        },
        allValues: {
          type: 'boolean',
          description: 'Dump all (computed) values, not just provided values (for what=values).',
          optional: true,
        },
        resourceType: {
          type: 'string',
          description: 'Filter resources by Kubernetes kind when what=resources',
          optional: true,
        },
      },
      required: ['what', 'releaseName'],
    },
  };

  async execute(params: any): Promise<any> {
    const { what, releaseName, namespace, revision, outputFormat, allValues, resourceType } =
      params || {};

    const args = ['get'];
    switch (what) {
      case 'values':
        args.push('values', releaseName);
        if (namespace) args.push('--namespace', namespace);
        if (revision) args.push('--revision', String(revision));
        if (outputFormat) args.push('--output', outputFormat);
        if (allValues) args.push('--all');
        return executeHelmCommand(args);
      case 'manifest':
        args.push('manifest', releaseName);
        if (namespace) args.push('--namespace', namespace);
        if (revision) args.push('--revision', String(revision));
        return executeHelmCommand(args);
      case 'notes':
        args.push('notes', releaseName);
        if (namespace) args.push('--namespace', namespace);
        if (revision) args.push('--revision', String(revision));
        return executeHelmCommand(args);
      case 'hooks':
        args.push('hooks', releaseName);
        if (namespace) args.push('--namespace', namespace);
        if (revision) args.push('--revision', String(revision));
        return executeHelmCommand(args);
      case 'resources': {
        args.push('manifest', releaseName);
        if (namespace) args.push('--namespace', namespace);
        if (revision) args.push('--revision', String(revision));
        const result = await executeHelmCommand(args);
        const manifestText = result.output || result;
        return this.parseKubernetesManifest(manifestText, resourceType);
      }
      default:
        throw new Error(`Unsupported what: ${what}`);
    }
  }

  private parseKubernetesManifest(manifestText: string, filterType?: string): any[] {
    // Very light YAML splitter by '---' boundaries; minimal parse
    const docs = String(manifestText)
      .split(/^---\s*$/m)
      .map((s) => s.trim())
      .filter(Boolean);
    const out: any[] = [];
    for (const d of docs) {
      // Heuristic parse to capture kind/name/namespace without full YAML parser
      const kindMatch = d.match(/\n?kind:\s*(.+)\n/i) || d.match(/^kind:\s*(.+)$/im);
      const nsMatch = d.match(/\n?namespace:\s*(.+)\n/i) || d.match(/^namespace:\s*(.+)$/im);
      const nameMatch = d.match(/\n?name:\s*(.+)\n/i) || d.match(/^name:\s*(.+)$/im);
      const kind = kindMatch ? kindMatch[1].trim() : undefined;
      const namespace = nsMatch ? nsMatch[1].trim() : undefined;
      const name = nameMatch ? nameMatch[1].trim() : undefined;
      if (!kind) continue;
      if (filterType && kind.toLowerCase() !== filterType.toLowerCase()) continue;
      out.push({ kind, namespace, name, manifest: d });
    }
    return out;
  }
}

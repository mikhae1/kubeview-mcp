import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { HelmBaseTool, HelmCommonSchemas, executeHelmCommand } from './BaseTool.js';
import { isSensitiveMaskEnabled, maskTextForSensitiveValues } from '../../utils/SensitiveData.js';

/**
 * Helm "get" tool covering values, manifest, notes, hooks, and resources.
 */
export class HelmGetTool implements HelmBaseTool {
  tool: Tool = {
    name: 'helm_get',
    description:
      'Get Helm release data: values, manifest, notes, hooks, resources, status, or history.',
    inputSchema: {
      type: 'object',
      properties: {
        what: {
          type: 'string',
          enum: ['values', 'manifest', 'notes', 'hooks', 'resources', 'status', 'history'],
          description:
            'One of: values (release values), manifest (rendered YAML), notes (chart notes), hooks (hook manifests), resources (parsed resources; filter with resourceType), status (release status; supports showResources), history (revision history).',
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
        showResources: {
          type: 'boolean',
          description: 'Show the resources this release created (only for what=status)',
          optional: true,
        },
      },
      required: ['what', 'releaseName'],
    },
  };

  async execute(params: any): Promise<any> {
    const {
      what,
      releaseName,
      namespace,
      revision,
      outputFormat,
      allValues,
      resourceType,
      showResources,
    } = params || {};

    const args = ['get'];
    switch (what) {
      case 'values':
        args.push('values', releaseName);
        if (namespace) args.push('--namespace', namespace);
        if (revision) args.push('--revision', String(revision));
        if (outputFormat) args.push('--output', outputFormat);
        if (allValues) args.push('--all');
        {
          const res = await executeHelmCommand(args);
          if (!isSensitiveMaskEnabled()) return res;
          const out = res?.output ?? res;
          if (typeof out === 'string') {
            return { output: maskTextForSensitiveValues(out) };
          }
          return res;
        }
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
      case 'status': {
        const sArgs = ['status', releaseName];
        if (namespace) sArgs.push('--namespace', namespace);
        if (outputFormat) sArgs.push('--output', outputFormat);
        if (showResources) sArgs.push('--show-resources');
        return executeHelmCommand(sArgs);
      }
      case 'history': {
        const hArgs = ['history', releaseName];
        if (namespace) hArgs.push('--namespace', namespace);
        if (outputFormat) hArgs.push('--output', outputFormat);
        return executeHelmCommand(hArgs);
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

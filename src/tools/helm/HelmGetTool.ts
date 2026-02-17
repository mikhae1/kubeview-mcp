import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { HelmReleaseOperations } from '../../kubernetes/resources/HelmReleaseOperations.js';
import { parseManifestResources } from '../../utils/HelmDataParser.js';
import {
  HelmBaseTool,
  HelmCommonSchemas,
  executeHelmCommand,
  validateHelmCLI,
} from './BaseTool.js';
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

  async execute(params: any, client?: KubernetesClient): Promise<any> {
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

    let apiError: Error | undefined;

    if (client) {
      try {
        await client.refreshCurrentContext();
        const resolvedNamespace = namespace || client.getCurrentNamespace();
        const helmOps = new HelmReleaseOperations(client);

        switch (what) {
          case 'values': {
            if (!this.supportsApiOutputFormat(outputFormat)) {
              break;
            }
            const values = await helmOps.getReleaseValues(
              { releaseName, namespace: resolvedNamespace, revision },
              !!allValues,
            );
            return this.maskValuesIfNeeded(values);
          }
          case 'manifest':
            return {
              output: await helmOps.getReleaseManifest({
                releaseName,
                namespace: resolvedNamespace,
                revision,
              }),
            };
          case 'notes':
            return {
              output: await helmOps.getReleaseNotes({
                releaseName,
                namespace: resolvedNamespace,
                revision,
              }),
            };
          case 'hooks':
            return await helmOps.getReleaseHooks({
              releaseName,
              namespace: resolvedNamespace,
              revision,
            });
          case 'resources': {
            const manifest = await helmOps.getReleaseManifest({
              releaseName,
              namespace: resolvedNamespace,
              revision,
            });
            return parseManifestResources(manifest, resourceType);
          }
          case 'status': {
            if (!this.supportsApiOutputFormat(outputFormat)) {
              break;
            }
            const release = await helmOps.getRelease({
              releaseName,
              namespace: resolvedNamespace,
              revision,
            });
            const status = {
              ...release.summary,
              description: release.release.info?.description || '',
              notes: release.release.info?.notes || '',
            } as any;
            if (showResources) {
              status.resources = parseManifestResources(release.release.manifest || '');
            }
            return status;
          }
          case 'history': {
            if (!this.supportsApiOutputFormat(outputFormat)) {
              break;
            }
            return await helmOps.getReleaseHistory({ releaseName, namespace: resolvedNamespace });
          }
          default:
            throw new Error(`Unsupported what: ${what}`);
        }
      } catch (error) {
        apiError = error instanceof Error ? error : new Error(String(error));
      }
    }

    const args = ['get'];
    try {
      switch (what) {
        case 'values':
          args.push('values', releaseName);
          if (namespace) args.push('--namespace', namespace);
          if (revision) args.push('--revision', String(revision));
          if (outputFormat) args.push('--output', outputFormat);
          if (allValues) args.push('--all');
          {
            await validateHelmCLI();
            const res = await executeHelmCommand(args);
            return this.maskValuesIfNeeded(res);
          }
        case 'manifest':
          args.push('manifest', releaseName);
          if (namespace) args.push('--namespace', namespace);
          if (revision) args.push('--revision', String(revision));
          await validateHelmCLI();
          return await executeHelmCommand(args);
        case 'notes':
          args.push('notes', releaseName);
          if (namespace) args.push('--namespace', namespace);
          if (revision) args.push('--revision', String(revision));
          await validateHelmCLI();
          return await executeHelmCommand(args);
        case 'hooks':
          args.push('hooks', releaseName);
          if (namespace) args.push('--namespace', namespace);
          if (revision) args.push('--revision', String(revision));
          await validateHelmCLI();
          return await executeHelmCommand(args);
        case 'resources': {
          args.push('manifest', releaseName);
          if (namespace) args.push('--namespace', namespace);
          if (revision) args.push('--revision', String(revision));
          await validateHelmCLI();
          const result = await executeHelmCommand(args);
          const manifestText = result.output || result;
          return parseManifestResources(manifestText, resourceType);
        }
        case 'status': {
          const sArgs = ['status', releaseName];
          if (namespace) sArgs.push('--namespace', namespace);
          if (outputFormat) sArgs.push('--output', outputFormat);
          if (showResources) sArgs.push('--show-resources');
          await validateHelmCLI();
          return await executeHelmCommand(sArgs);
        }
        case 'history': {
          const hArgs = ['history', releaseName];
          if (namespace) hArgs.push('--namespace', namespace);
          if (outputFormat) hArgs.push('--output', outputFormat);
          await validateHelmCLI();
          return await executeHelmCommand(hArgs);
        }
        default:
          throw new Error(`Unsupported what: ${what}`);
      }
    } catch (error: any) {
      if (apiError) {
        throw new Error(
          `Failed to get Helm release data via Kubernetes API (${apiError.message}) and CLI fallback (${error.message})`,
        );
      }
      throw error;
    }
  }

  private supportsApiOutputFormat(outputFormat?: string): boolean {
    return !outputFormat || outputFormat === 'json';
  }

  private maskValuesIfNeeded(result: any): any {
    if (!isSensitiveMaskEnabled()) {
      return result;
    }

    const out = result?.output ?? result;
    if (typeof out === 'string') {
      return { output: maskTextForSensitiveValues(out) };
    }

    if (out && typeof out === 'object') {
      const json = JSON.stringify(out, null, 2);
      const masked = maskTextForSensitiveValues(json);
      try {
        return JSON.parse(masked);
      } catch {
        return { output: masked };
      }
    }

    return result;
  }
}

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import * as https from 'https';
import { ArgoCDBaseTool, ArgoCDCommonSchemas, executeArgoCDCommand } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { PodOperations } from '../../kubernetes/resources/PodOperations.js';

/**
 * Get logs of an ArgoCD application
 */
export class ArgoCDAppLogsTool implements ArgoCDBaseTool {
  tool: Tool = {
    name: 'argocd_app_logs',
    description:
      'Get logs of an ArgoCD application (similar to `argocd app logs <app-name>`). Tries to fetch via Kubernetes API first, then falls back to ArgoCD API/CLI.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: {
          ...ArgoCDCommonSchemas.appName,
          optional: false,
        },
        container: {
          type: 'string',
          description: 'Container name to get logs from',
          optional: true,
        },
        follow: {
          type: 'boolean',
          description: 'Follow log output (stream logs)',
          optional: true,
        },
        group: {
          type: 'string',
          description: 'Resource group',
          optional: true,
        },
        kind: {
          type: 'string',
          description: 'Resource kind (e.g., Pod, Deployment)',
          optional: true,
        },
        name: {
          type: 'string',
          description: 'Resource name',
          optional: true,
        },
        namespace: {
          type: 'string',
          description: 'Resource namespace',
          optional: true,
        },
        previous: {
          type: 'boolean',
          description: 'Get logs from previous instance',
          optional: true,
        },
        since: {
          type: 'string',
          description: 'Show logs since duration (e.g., 1h, 30m, 10s)',
          optional: true,
        },
        sinceTime: {
          type: 'string',
          description: 'Show logs since timestamp (RFC3339)',
          optional: true,
        },
        tail: {
          type: 'number',
          description: 'Number of lines to show from the end of the logs',
          optional: true,
        },
        tailLines: {
          type: 'number',
          description: 'Alias for tail',
          optional: true,
        },
        timestamps: {
          type: 'boolean',
          description: 'Include timestamps in log output',
          optional: true,
        },
        server: ArgoCDCommonSchemas.server,
        authToken: {
          type: 'string',
          description: 'Authentication token',
          optional: true,
        },
        grpcWeb: ArgoCDCommonSchemas.grpcWeb,
        plaintext: ArgoCDCommonSchemas.plaintext,
        insecure: ArgoCDCommonSchemas.insecure,
      },
      required: ['appName'],
    },
  };

  /**
   * Parse duration string (e.g., "5m", "1h", "30s") to seconds
   */
  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) {
      // If just a number, assume seconds
      if (/^\d+$/.test(duration)) {
        return parseInt(duration, 10);
      }
      throw new Error(`Invalid duration format: ${duration}. Use format like "5m", "1h", "30s"`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 3600;
      case 'd':
        return value * 86400;
      default:
        throw new Error(`Unknown duration unit: ${unit}`);
    }
  }

  private async fetchLogsViaK8s(params: any): Promise<string> {
    const client = new KubernetesClient();
    const podOps = new PodOperations(client);

    // Default fallback values
    const namespace = params.namespace;
    const appName = params.appName;

    let pods: any[] = [];

    // 1. If specific pod name provided
    if (params.name && (!params.kind || params.kind === 'Pod')) {
      if (namespace) {
        // Verify it exists in the namespace
        try {
          const pod = await podOps.get(params.name, { namespace });
          if (pod) pods = [pod];
        } catch {
          // ignore not found
        }
      } else {
        // Search for pod by name in all namespaces
        const allPodsList = await podOps.list();
        const found = allPodsList.items.find((p: any) => p.metadata?.name === params.name);
        if (found) pods = [found];
      }
    } else {
      // 2. Search for pods matching the application
      const labelSelector = `app.kubernetes.io/instance=${appName}`;
      const listOptions = {
        namespace,
        labelSelector,
      };

      const res = await podOps.list(listOptions);
      pods = res.items;
    }

    if (pods.length === 0) {
      throw new Error(
        `No pods found for application "${appName}" via Kubernetes API (label selector: app.kubernetes.io/instance=${appName})`,
      );
    }

    // Fetch logs
    const logPromises = pods.map(async (pod: any) => {
      const name = pod.metadata?.name;
      const ns = pod.metadata?.namespace;
      if (!name || !ns) return '';

      let sinceSeconds: number | undefined;
      try {
        if (params.since) {
          sinceSeconds = this.parseDuration(params.since);
        }
      } catch {
        // ignore invalid duration
      }

      try {
        // Use PodOperations which now supports sinceSeconds
        const logContent = await podOps.getLogs(name, {
          namespace: ns,
          container: params.container || undefined,
          follow: params.follow || false,
          tailLines: params.tail,
          sinceSeconds: sinceSeconds,
          previous: params.previous,
          timestamps: params.timestamps,
        });

        if (pods.length > 1) {
          return `Pod: ${name}\n${logContent}\n-------------------\n`;
        }
        return logContent;
      } catch (error: any) {
        const msg = error?.response?.body?.message || error.message || String(error);
        return `Failed to fetch logs for pod ${name}: ${msg}\n`;
      }
    });

    const logs = await Promise.all(logPromises);
    return logs.join('\n');
  }

  private async fetchLogsViaApi(params: any): Promise<string> {
    const server = params.server || process.env.ARGOCD_SERVER;
    const token = params.authToken || process.env.ARGOCD_AUTH_TOKEN;

    if (!server || !token) {
      throw new Error('Server and token are required for API access');
    }

    const protocol = params.insecure || params.plaintext ? 'http' : 'https';
    const baseUrl = `${protocol}://${server}`;
    const agent = new https.Agent({
      rejectUnauthorized: !params.insecure,
    });

    const headers = {
      Authorization: `Bearer ${token}`,
    };

    // Helper to fetch logs for a specific pod
    const fetchPodLogs = async (podName: string, namespace: string): Promise<string> => {
      const queryParams = new URLSearchParams();
      if (params.container) queryParams.append('container', params.container);
      if (params.tail) queryParams.append('tailLines', params.tail.toString());
      if (params.since) queryParams.append('sinceSeconds', params.since); // Simplified mapping
      if (params.sinceTime) queryParams.append('sinceTime', params.sinceTime);
      if (params.previous) queryParams.append('previous', 'true');
      if (params.timestamps) queryParams.append('timestamps', 'true');
      if (namespace) queryParams.append('namespace', namespace);

      const url = `${baseUrl}/api/v1/applications/${params.appName}/pods/${podName}/logs?${queryParams.toString()}`;

      try {
        const response = await fetch(url, {
          headers,
          agent: params.insecure ? agent : undefined,
        } as any);
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`API Error ${response.status}: ${text}`);
        }
        return await response.text();
      } catch (error) {
        console.error(`Failed to fetch logs for pod ${podName}:`, error);
        return `Error fetching logs for ${podName}: ${error instanceof Error ? error.message : String(error)}`;
      }
    };

    // If resource name is provided, try to fetch logs directly
    if (params.name && (!params.kind || params.kind === 'Pod')) {
      return await fetchPodLogs(params.name, params.namespace || '');
    }

    // Otherwise, we need to discover pods for the app
    const treeUrl = `${baseUrl}/api/v1/applications/${params.appName}/resource-tree`;
    const treeResponse = await fetch(treeUrl, {
      headers,
      agent: params.insecure ? agent : undefined,
    } as any);

    if (!treeResponse.ok) {
      throw new Error(`Failed to fetch resource tree: ${treeResponse.statusText}`);
    }

    const treeData = (await treeResponse.json()) as any;
    const nodes = treeData.nodes || [];

    // Filter for Pods
    const pods = nodes.filter(
      (node: any) =>
        node.kind === 'Pod' &&
        (!params.group || node.group === params.group) &&
        (!params.namespace || node.namespace === params.namespace),
    );

    if (pods.length === 0) {
      return 'No pods found for application.';
    }

    // Fetch logs for all pods concurrently
    const logs = await Promise.all(pods.map((pod: any) => fetchPodLogs(pod.name, pod.namespace)));

    return logs.join('\n');
  }

  async execute(params: any): Promise<any> {
    const tailLines = params?.tailLines ?? params?.tail;

    // 1. Try Kubernetes API first (Direct access, no ArgoCD auth needed if we have kubeconfig)
    try {
      const text = await this.fetchLogsViaK8s({ ...params, tail: tailLines });
      const logLines = String(text)
        .split('\n')
        .map((l) => l.trimEnd())
        .filter((l) => l.length > 0);
      return {
        appName: params.appName,
        namespace: params.namespace,
        container: params.container,
        lineCount: logLines.length,
        logs: logLines,
        options: {
          follow: Boolean(params.follow),
          previous: Boolean(params.previous),
          since: params.since,
          sinceTime: params.sinceTime,
          tailLines,
          timestamps: Boolean(params.timestamps),
          group: params.group,
          kind: params.kind,
          name: params.name,
        },
        transport: 'k8s',
      };
    } catch {
      // Ignore k8s error and fallback to ArgoCD API/CLI
    }

    // 2. Try ArgoCD API
    try {
      const text = await this.fetchLogsViaApi({ ...params, tail: tailLines });
      const logLines = String(text)
        .split('\n')
        .map((l) => l.trimEnd())
        .filter((l) => l.length > 0);
      return {
        appName: params.appName,
        namespace: params.namespace,
        container: params.container,
        lineCount: logLines.length,
        logs: logLines,
        options: {
          follow: Boolean(params.follow),
          previous: Boolean(params.previous),
          since: params.since,
          sinceTime: params.sinceTime,
          tailLines,
          timestamps: Boolean(params.timestamps),
          group: params.group,
          kind: params.kind,
          name: params.name,
        },
        transport: 'api',
      };
    } catch {
      // If API fails (including missing config), fall back to CLI
      console.error('ArgoCD API log fetch failed, falling back to CLI');
    }

    // 3. Fallback to CLI
    const args = ['app', 'logs', params.appName];

    // Add container specification
    if (params.container) {
      args.push('--container', params.container);
    }

    // Add follow option
    if (params.follow) {
      args.push('--follow');
    }

    // Add resource specification
    if (params.group) {
      args.push('--group', params.group);
    }

    if (params.kind) {
      args.push('--kind', params.kind);
    }

    if (params.name) {
      args.push('--name', params.name);
    }

    if (params.namespace) {
      args.push('--namespace', params.namespace);
    }

    // Add previous logs option
    if (params.previous) {
      args.push('--previous');
    }

    // Add time-based filters
    if (params.since) {
      args.push('--since', params.since);
    }

    if (params.sinceTime) {
      args.push('--since-time', params.sinceTime);
    }

    // Add tail option
    if (typeof tailLines === 'number') {
      args.push('--tail', tailLines.toString());
    }

    // Add timestamps option
    if (params.timestamps) {
      args.push('--timestamps');
    }

    // Add server configuration
    if (params.server) {
      args.push('--server', params.server);
    }

    if (params.grpcWeb) {
      args.push('--grpc-web');
    }

    if (params.plaintext) {
      args.push('--plaintext');
    }

    if (params.insecure) {
      args.push('--insecure');
    }

    try {
      const result = await executeArgoCDCommand(args);
      // ArgoCD CLI via CliUtils returns { output: string }
      // We want to return raw text to mirror "argocd app logs" behavior
      const text =
        typeof result === 'object' && result !== null && 'output' in result
          ? String((result as any).output || '')
          : typeof result === 'string'
            ? result
            : JSON.stringify(result);
      const logLines = text
        .split('\n')
        .map((l) => l.trimEnd())
        .filter((l) => l.length > 0);
      return {
        appName: params.appName,
        namespace: params.namespace,
        container: params.container,
        lineCount: logLines.length,
        logs: logLines,
        options: {
          follow: Boolean(params.follow),
          previous: Boolean(params.previous),
          since: params.since,
          sinceTime: params.sinceTime,
          tailLines,
          timestamps: Boolean(params.timestamps),
          group: params.group,
          kind: params.kind,
          name: params.name,
          server: params.server,
          grpcWeb: Boolean(params.grpcWeb),
          plaintext: Boolean(params.plaintext),
          insecure: Boolean(params.insecure),
        },
        transport: 'cli',
      };
    } catch (error) {
      throw new Error(
        `Failed to get ArgoCD application logs for "${params.appName}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

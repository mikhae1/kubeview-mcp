import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import * as k8s from '@kubernetes/client-node';
import { PodOperations } from '../../kubernetes/resources/PodOperations.js';

type OwnerKind = 'Deployment' | 'DaemonSet' | 'Job';

interface JsonPathFilter {
  path: string;
  equals?: string;
  regex?: string;
}

interface KubeLogLine {
  type: 'log' | 'event';
  ts: string;
  namespace: string;
  pod: string;
  container?: string;
  message: string;
  json?: any;
}

export class KubeLogTool implements BaseTool {
  tool: Tool = {
    name: 'kube_log',
    description:
      'Tail logs from multiple pods/containers with dynamic discovery, filters, and merged Kubernetes events. ' +
      'REQUIRED: Provide at least one pod identification method: podName (specific pod), labelSelector (e.g., "app=myapp"), ' +
      'or ownerKind+ownerName (e.g., Deployment name). For a single pod, prefer kube_logs tool with podName.',
    inputSchema: {
      type: 'object',
      properties: {
        podName: {
          type: 'string',
          description:
            'Specific pod name to fetch logs from. Can be used alone or combined with other filters. ' +
            'For single pod logs, consider using kube_logs tool instead.',
          optional: true,
        },
        namespace: {
          ...CommonSchemas.namespace,
          description: 'Namespace scope (defaults to current context or "default")',
        },
        labelSelector: {
          ...CommonSchemas.labelSelector,
          description:
            'Label selector to find pods (e.g., "app=myapp,env=prod"). ' +
            'At least one of: podName, labelSelector, or ownerKind+ownerName must be provided.',
        },
        ownerKind: {
          type: 'string',
          description:
            'Owner resource kind to select pods from. Must be used with ownerName. ' +
            'Example: Use ownerKind="Deployment" and ownerName="my-deployment" to get logs from all pods owned by that deployment.',
          enum: ['Deployment', 'DaemonSet', 'Job'],
          optional: true,
        },
        ownerName: {
          type: 'string',
          description:
            'Owner resource name when ownerKind is provided. Must be used with ownerKind. ' +
            'Example: Use ownerKind="Deployment" and ownerName="my-deployment" to get logs from all pods owned by that deployment.',
          optional: true,
        },
        podRegex: {
          type: 'string',
          description:
            'Regex or substring filter applied to pod names (used after pod discovery). ' +
            'Example: "myapp-.*" to match pods starting with "myapp-". This is a filter, not a discovery method.',
          optional: true,
        },
        containerRegex: {
          type: 'string',
          description: 'Regex or substring filter applied to container names',
          optional: true,
        },
        messageRegex: {
          type: 'string',
          description: 'Regex or substring filter applied to log message',
          optional: true,
        },
        excludeRegex: {
          type: 'string',
          description: 'Regex to exclude matching log messages',
          optional: true,
        },
        jsonPaths: {
          type: 'array',
          description:
            'Filters applied to parsed JSON log lines: [{ path: "level", equals: "error" }]',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              equals: { type: 'string', optional: true },
              regex: { type: 'string', optional: true },
            },
          },
          optional: true,
        },
        tailLines: {
          type: 'number',
          description: 'Number of lines from end to start with',
          optional: true,
        },
        since: {
          type: 'string',
          description: 'Show logs since this duration (e.g., "5m", "1h")',
          optional: true,
        },
        sinceTime: {
          type: 'string',
          description: 'Show logs since this RFC3339 timestamp',
          optional: true,
        },
        timestamps: {
          type: 'boolean',
          description: 'Include timestamps in returned log lines',
          optional: true,
        },
        previous: {
          type: 'boolean',
          description: 'Include logs from previous container instance (one-shot)',
          optional: true,
        },
        durationSeconds: {
          type: 'number',
          description: 'Maximum time to stream before returning (default 0 = no wait)',
          optional: true,
        },
        maxLines: {
          type: 'number',
          description: 'Stop after collecting this many merged lines',
          optional: true,
        },
        includeEvents: {
          type: 'boolean',
          description: 'Stream Kubernetes Events alongside logs',
          optional: true,
        },
        eventType: {
          type: 'string',
          description: 'Filter events by type',
          enum: ['Normal', 'Warning', 'All'],
          optional: true,
        },
        structure: {
          type: 'string',
          description: 'Output structure: object (default) or text',
          enum: ['object', 'text'],
          optional: true,
        },
      },
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    const namespace: string = params.namespace || client.getCurrentNamespace() || 'default';
    const podNameParam: string | undefined = params.podName;
    const ownerKind: OwnerKind | undefined = params.ownerKind;
    const ownerName: string | undefined = params.ownerName;
    const labelSelectorOverride: string | undefined = params.labelSelector;
    const podRegexStr: string | undefined = params.podRegex;
    const containerRegexStr: string | undefined = params.containerRegex;
    const messageRegexStr: string | undefined = params.messageRegex;
    const excludeRegexStr: string | undefined = params.excludeRegex;
    const jsonPaths: JsonPathFilter[] = Array.isArray(params.jsonPaths) ? params.jsonPaths : [];
    const tailLines: number | undefined = isFiniteNumber(params.tailLines)
      ? params.tailLines
      : undefined;
    const since: string | undefined = params.since;
    const sinceTimeInput: string | undefined = params.sinceTime;
    const includeTimestamps: boolean = Boolean(params.timestamps);
    const previous: boolean = Boolean(params.previous);
    const durationSeconds: number = isFiniteNumber(params.durationSeconds)
      ? params.durationSeconds
      : 0;
    const maxLines: number | undefined = isFiniteNumber(params.maxLines)
      ? params.maxLines
      : undefined;
    const includeEvents: boolean = params.includeEvents !== false; // default true
    const eventType: 'Normal' | 'Warning' | 'All' = params.eventType || 'All';
    const structure: 'object' | 'text' = params.structure || 'object';

    // Validate that at least one pod identification method is provided
    if (!podNameParam && !labelSelectorOverride && !(ownerKind && ownerName)) {
      throw new Error(
        'At least one pod identification method is required. Provide one of:\n' +
          '  - podName: specific pod name (e.g., "my-pod-123")\n' +
          '  - labelSelector: label selector (e.g., "app=myapp")\n' +
          '  - ownerKind + ownerName: owner resource (e.g., ownerKind="Deployment", ownerName="my-deployment")\n' +
          'For single pod logs, consider using kube_logs tool with podName parameter.',
      );
    }

    // Validate ownerKind and ownerName are used together
    if ((ownerKind && !ownerName) || (!ownerKind && ownerName)) {
      throw new Error(
        'ownerKind and ownerName must be provided together. ' +
          'Example: {"ownerKind": "Deployment", "ownerName": "my-deployment"}',
      );
    }

    // One-shot mode: when tailLines is requested and no explicit duration provided
    // One-shot mode: if durationSeconds <= 0, do not wait; return immediately with available logs
    const isOneShot: boolean = !durationSeconds || durationSeconds <= 0;

    // Pre-compile regexes
    const podRegex = safeBuildRegex(podRegexStr);
    const containerRegex = safeBuildRegex(containerRegexStr);
    const messageRegex = safeBuildRegex(messageRegexStr);
    const excludeRegex = safeBuildRegex(excludeRegexStr);

    const podOps = new PodOperations(client);

    // State
    const targetPods = new Map<string, k8s.V1Pod>();
    const activeLoops = new Map<string, { stop: () => void }>(); // key: pod|container
    const lines: KubeLogLine[] = [];
    let droppedLines = 0;

    // Resolve label selector from owner if provided (needed for both paths)
    const ownerLabelSelector =
      ownerKind && ownerName
        ? await this.buildSelectorForOwner(client, namespace, ownerKind, ownerName)
        : undefined;

    const effectiveLabelSelector =
      [ownerLabelSelector, labelSelectorOverride].filter(Boolean).join(',') || undefined;

    // Discovery: If podName is provided, fetch that specific pod
    if (podNameParam) {
      try {
        const pod = await podOps.get(podNameParam, { namespace });
        if (pod && pod.metadata?.name) {
          const name = pod.metadata.name;
          if (!this.podMatches(pod, podRegex)) {
            throw new Error(
              `Pod "${name}" found but does not match podRegex filter "${podRegexStr || ''}"`,
            );
          }
          targetPods.set(name, pod);
        } else {
          throw new Error(`Pod "${podNameParam}" not found in namespace "${namespace}"`);
        }
      } catch (error: any) {
        const errorMsg = error.response?.body?.message || error.message || 'Unknown error';
        if (errorMsg.includes('not found')) {
          throw new Error(
            `Pod "${podNameParam}" not found in namespace "${namespace}". ` +
              `Verify the pod name and namespace are correct.`,
          );
        }
        throw new Error(`Failed to fetch pod "${podNameParam}": ${errorMsg}`);
      }
    } else {
      // Discovery via label selector or owner
      try {
        const initialList = await podOps.list({
          namespace,
          labelSelector: effectiveLabelSelector,
        });
        for (const pod of initialList.items || []) {
          const podName = pod.metadata?.name;
          if (!podName || !this.podMatches(pod, podRegex)) continue;
          targetPods.set(podName, pod);
        }
      } catch (error: any) {
        const errorMsg = error.response?.body?.message || error.message || 'Unknown error';
        throw new Error(`Failed to list pods: ${errorMsg}`);
      }
    }

    // Validate that at least one pod was found
    if (targetPods.size === 0) {
      const methods = [];
      if (podNameParam) methods.push(`podName="${podNameParam}"`);
      if (labelSelectorOverride) methods.push(`labelSelector="${labelSelectorOverride}"`);
      if (ownerKind && ownerName)
        methods.push(`ownerKind="${ownerKind}", ownerName="${ownerName}"`);
      if (podRegexStr) methods.push(`podRegex="${podRegexStr}"`);

      throw new Error(
        `No pods found matching the provided criteria in namespace "${namespace}".\n` +
          `Criteria used: ${methods.join(', ')}\n` +
          `Suggestions:\n` +
          `  - Verify the namespace is correct\n` +
          `  - Check that pods exist: use kube_list with resourceType="pod" and the same namespace\n` +
          `  - If using labelSelector, verify labels match: use kube_get to inspect pod labels\n` +
          `  - If using ownerKind/ownerName, verify the owner resource exists and has pods`,
      );
    }

    if (isOneShot) {
      // One-shot: fetch last N lines once, don't watch/poll
      const fetchPromises: Promise<void>[] = [];
      const errors: string[] = [];
      for (const pod of targetPods.values()) {
        const podName = pod.metadata?.name;
        if (!podName) {
          errors.push('Pod found but missing metadata.name');
          continue;
        }
        const containers = (pod.spec?.containers || []).map((c) => c.name).filter(Boolean);
        if (containers.length === 0) {
          errors.push(`Pod "${podName}" has no containers`);
          continue;
        }
        for (const c of containers) {
          if (containerRegex && !containerRegex.test(c)) continue;
          fetchPromises.push(
            (async () => {
              try {
                if (!podName || !c) {
                  errors.push(`Invalid pod/container: podName="${podName}", container="${c}"`);
                  return;
                }
                const res = (await client.core.readNamespacedPodLog({
                  namespace,
                  name: podName,
                  container: c,
                  previous,
                  follow: false,
                  tailLines,
                  timestamps: true,
                })) as unknown as string;
                this.processLogsToLines({
                  logText: res,
                  namespace,
                  podName,
                  container: c,
                  includeTimestampsOutput: includeTimestamps,
                  messageRegex,
                  excludeRegex,
                  jsonPaths,
                  onLine: (line) => lines.push(line),
                  onLastTimestamp: () => undefined,
                });
              } catch (error: any) {
                const errorMsg = error.response?.body?.message || error.message || 'Unknown error';
                const containerInfo = `${namespace}/${podName}/${c}`;
                if (errorMsg.includes('not found')) {
                  errors.push(`Container "${c}" not found in pod "${podName}"`);
                } else if (errorMsg.includes('Required parameter name')) {
                  errors.push(
                    `Invalid parameters for ${containerInfo}: pod name or container name is missing`,
                  );
                } else {
                  errors.push(`Failed to fetch logs from ${containerInfo}: ${errorMsg}`);
                }
              }
            })(),
          );
        }
      }
      await Promise.all(fetchPromises);

      // If no logs were fetched and we have errors, throw a helpful error
      if (lines.length === 0 && errors.length > 0) {
        throw new Error(
          `Failed to fetch logs from any container:\n${errors.map((e) => `  - ${e}`).join('\n')}\n` +
            `Suggestions:\n` +
            `  - Verify pod names and containers exist\n` +
            `  - Check container names match (use kube_get to inspect pod spec)\n` +
            `  - For single pod logs, consider using kube_logs tool instead`,
        );
      }

      // One-shot events (optional): list events and filter to involved pods
      if (includeEvents) {
        try {
          const eList: any = await client.core.listNamespacedEvent({ namespace });
          const items: any[] = (eList?.items || []) as any[];
          const cutoffMs = sinceTimeInput
            ? Date.parse(sinceTimeInput)
            : since
              ? Date.now() - this.parseDuration(since) * 1000
              : undefined;
          const podNames = new Set(targetPods.keys());
          const eventsPerPod: Map<string, any[]> = new Map();
          for (const e of items) {
            const ts = e?.lastTimestamp || e?.eventTime || e?.firstTimestamp;
            const kind = e?.involvedObject?.kind;
            const name = e?.involvedObject?.name || '';
            if (eventType !== 'All' && e?.type && e.type !== eventType) continue;
            if (kind !== 'Pod' || !podNames.has(name)) continue;
            if (cutoffMs && Date.parse(ts || 0) < cutoffMs) continue;
            const arr = eventsPerPod.get(name) || [];
            arr.push(e);
            eventsPerPod.set(name, arr);
          }
          // Limit to last tailLines events per pod (if tailLines provided), else keep last 10 per pod by default
          const perPodLimit = tailLines && tailLines > 0 ? tailLines : 10;
          for (const [podNameKey, arr] of eventsPerPod.entries()) {
            const sorted = arr.sort((a: any, b: any) => {
              const ta = Date.parse(a?.lastTimestamp || a?.eventTime || a?.firstTimestamp || 0);
              const tb = Date.parse(b?.lastTimestamp || b?.eventTime || b?.firstTimestamp || 0);
              return tb - ta; // newest first
            });
            for (const e of sorted.slice(0, perPodLimit)) {
              const ts = e?.lastTimestamp || e?.eventTime || e?.firstTimestamp;
              lines.push({
                type: 'event',
                ts: ts || new Date().toISOString(),
                namespace: e?.metadata?.namespace || namespace,
                pod: podNameKey,
                message: `${e?.reason ? `[${e.reason}] ` : ''}${e?.message || ''}`.trim(),
              });
            }
          }
        } catch {
          // ignore event list errors
        }
      }

      // Sort and return immediately
      lines.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
      if (structure === 'text') {
        const text = lines
          .map((l) => {
            const ts = includeTimestamps ? `${l.ts} ` : '';
            const scope =
              l.type === 'event'
                ? `[event] ${l.namespace}/${l.pod}`
                : `${l.namespace}/${l.pod}${l.container ? ' ' + l.container : ''}`;
            return `${ts}${scope}: ${l.message}`;
          })
          .join('\n');
        return text;
      }
      return {
        namespace,
        stats: {
          pods: targetPods.size,
          containers: 0,
          lines: lines.length,
          droppedLines: 0,
        },
        lines,
      };
    }

    // Start log loops for initial pods (streaming mode)
    for (const pod of targetPods.values()) {
      const podName = pod.metadata?.name;
      if (!podName) continue;
      const containers = (pod.spec?.containers || []).map((c) => c.name).filter((n) => !!n);
      for (const c of containers) {
        if (containerRegex && !containerRegex.test(c)) continue;
        const key = `${podName}|${c}`;
        if (!activeLoops.has(key)) {
          const stopper = this.startPollingLogLoop({
            client,
            namespace,
            podName,
            container: c,
            tailLines,
            since,
            sinceTime: sinceTimeInput,
            previous,
            includeTimestampsInternal: true, // always request ts to support sinceTime progression
            includeTimestampsOutput: includeTimestamps,
            messageRegex,
            excludeRegex,
            jsonPaths,
            onLine: (line) => {
              if (maxLines && lines.length >= maxLines) return; // soft guard
              lines.push(line);
            },
          });
          activeLoops.set(key, stopper);
        }
      }
    }

    // Events watch
    const eventWatchStop = includeEvents
      ? this.startEventsWatch({
          client,
          namespace,
          targetPods,
          ownerKind,
          ownerName,
          eventType,
          since,
          sinceTime: sinceTimeInput,
          onEvent: (e) => {
            if (maxLines && lines.length >= maxLines) return;
            lines.push(e);
          },
        })
      : () => undefined;

    // Pod watch for dynamic discovery
    const stopPodWatch = podOps.watch(
      (evt) => {
        try {
          const podObj = evt.object as k8s.V1Pod;
          const name = podObj?.metadata?.name || '';
          if (!name) return;
          switch (evt.type) {
            case 'ADDED':
            case 'MODIFIED': {
              if (!this.podMatches(podObj, podRegex)) return;
              targetPods.set(name, podObj);
              const containers = (podObj.spec?.containers || []).map((c) => c.name).filter(Boolean);
              for (const c of containers) {
                if (containerRegex && !containerRegex.test(c)) continue;
                const key = `${name}|${c}`;
                if (!activeLoops.has(key)) {
                  const stopper = this.startPollingLogLoop({
                    client,
                    namespace,
                    podName: name,
                    container: c,
                    tailLines,
                    since,
                    sinceTime: sinceTimeInput,
                    previous,
                    includeTimestampsInternal: true,
                    includeTimestampsOutput: includeTimestamps,
                    messageRegex,
                    excludeRegex,
                    jsonPaths,
                    onLine: (line) => {
                      if (maxLines && lines.length >= maxLines) return;
                      lines.push(line);
                    },
                  });
                  activeLoops.set(key, stopper);
                }
              }
              break;
            }
            case 'DELETED': {
              targetPods.delete(name);
              const keys = Array.from(activeLoops.keys()).filter((k) => k.startsWith(`${name}|`));
              for (const k of keys) {
                try {
                  activeLoops.get(k)?.stop();
                } catch {
                  // ignore
                }
                activeLoops.delete(k);
              }
              break;
            }
          }
        } catch {
          // ignore watch errors
        }
      },
      { namespace, labelSelector: effectiveLabelSelector },
    );

    // Termination controls
    const startedAt = Date.now();
    const endAt = startedAt + durationSeconds * 1000;

    // Wait loop until timeout or maxLines reached
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (Date.now() >= endAt || (maxLines && lines.length >= maxLines)) {
          clearInterval(timer);
          resolve();
        }
      }, 250);
    });

    // Cleanup
    try {
      stopPodWatch();
    } catch {
      // ignore
    }
    try {
      eventWatchStop();
    } catch {
      // ignore
    }
    for (const s of activeLoops.values()) {
      try {
        s.stop();
      } catch {
        // ignore
      }
    }
    activeLoops.clear();

    // Sort and shape output
    lines.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    if (structure === 'text') {
      const text = lines
        .map((l) => {
          const ts = includeTimestamps ? `${l.ts} ` : '';
          const scope =
            l.type === 'event'
              ? `[event] ${l.namespace}/${l.pod}`
              : `${l.namespace}/${l.pod}${l.container ? ' ' + l.container : ''}`;
          return `${ts}${scope}: ${l.message}`;
        })
        .join('\n');
      return text;
    }

    return {
      namespace,
      stats: {
        pods: targetPods.size,
        containers: new Set(Array.from(activeLoops.keys()).map((k) => k.split('|')[1])).size,
        lines: lines.length,
        droppedLines,
      },
      lines,
    };
  }

  private podMatches(pod: k8s.V1Pod, podRegex?: RegExp | null): boolean {
    const name = pod.metadata?.name || '';
    if (!podRegex) return true;
    return podRegex.test(name);
  }

  private async buildSelectorForOwner(
    client: KubernetesClient,
    namespace: string,
    kind: OwnerKind,
    name: string,
  ): Promise<string> {
    try {
      if (kind === 'Deployment') {
        const dep = await client.apps.readNamespacedDeployment({ namespace, name });
        const labels = dep?.spec?.selector?.matchLabels || {};
        return this.labelsToSelector(labels);
      }
      if (kind === 'DaemonSet') {
        const ds = await client.apps.readNamespacedDaemonSet({ namespace, name });
        const labels = ds?.spec?.selector?.matchLabels || {};
        return this.labelsToSelector(labels);
      }
      if (kind === 'Job') {
        // Jobs propagate label job-name to pods
        return `job-name=${name}`;
      }
    } catch (e: any) {
      const msg = e?.response?.body?.message || e?.message || 'Unknown owner lookup error';
      throw new Error(`Failed to resolve owner selector for ${kind}/${name}: ${msg}`);
    }
    throw new Error(`Unsupported owner kind: ${kind}`);
  }

  private labelsToSelector(labels: Record<string, string>): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(labels || {})) {
      parts.push(`${k}=${v}`);
    }
    return parts.join(',');
  }

  private startPollingLogLoop(args: {
    client: KubernetesClient;
    namespace: string;
    podName: string;
    container: string;
    tailLines?: number;
    since?: string;
    sinceTime?: string;
    previous: boolean;
    includeTimestampsInternal: boolean;
    includeTimestampsOutput: boolean;
    messageRegex: RegExp | null;
    excludeRegex: RegExp | null;
    jsonPaths: JsonPathFilter[];
    onLine: (line: KubeLogLine) => void;
  }): { stop: () => void } {
    const {
      client,
      namespace,
      podName,
      container,
      tailLines,
      since,
      sinceTime,
      previous,
      includeTimestampsInternal,
      includeTimestampsOutput,
      messageRegex,
      excludeRegex,
      jsonPaths,
      onLine,
    } = args;

    let stopped = false;
    let lastSinceTime: string | undefined =
      sinceTime || (since ? this.sinceToRfc3339(since) : undefined);

    // One-shot fetch for previous instance if requested
    const fetchOnce = async (prev: boolean) => {
      try {
        // Compute sinceSeconds dynamically from lastSinceTime or static since
        let sinceSeconds: number | undefined;
        if (lastSinceTime) {
          const diffMs = Date.now() - Date.parse(lastSinceTime);
          // Add 1s cushion to avoid re-reading lines at the exact same second boundary
          sinceSeconds = Math.max(1, Math.floor(diffMs / 1000) + 1);
        } else if (since) {
          sinceSeconds = Math.max(1, this.parseDuration(since));
        }

        const res = (await client.core.readNamespacedPodLog({
          namespace,
          name: podName,
          container,
          previous: prev,
          follow: false,
          tailLines,
          timestamps: includeTimestampsInternal,
          sinceSeconds,
        })) as unknown as string;
        // Deduplicate across polls using a simple per-container signature
        const containerSigKey = `${namespace}|${podName}|${container}`;
        if (!(this as any)._lastSigByContainer) {
          (this as any)._lastSigByContainer = new Map<string, string>();
        }
        const sigMap: Map<string, string> = (this as any)._lastSigByContainer;
        let lastSig = sigMap.get(containerSigKey);

        this.processLogsToLines({
          logText: res,
          namespace,
          podName,
          container,
          includeTimestampsOutput,
          messageRegex,
          excludeRegex,
          jsonPaths,
          onLine,
          onLastTimestamp: (ts) => (lastSinceTime = ts),
          canEmit: (sig) => {
            if (lastSig && sig <= lastSig) return false;
            lastSig = sig;
            sigMap.set(containerSigKey, sig);
            return true;
          },
        });
      } catch {
        // ignore single read errors
      }
    };

    // initial previous
    const init = async () => {
      if (previous) {
        await fetchOnce(true);
      }
      await fetchOnce(false);
    };

    void init();

    // polling loop
    const interval = setInterval(async () => {
      if (stopped) return;
      await fetchOnce(false);
    }, 1000);

    const stop = () => {
      stopped = true;
      try {
        clearInterval(interval);
      } catch {
        // ignore
      }
    };

    return { stop };
  }

  private processLogsToLines(args: {
    logText: string;
    namespace: string;
    podName: string;
    container: string;
    includeTimestampsOutput: boolean;
    messageRegex: RegExp | null;
    excludeRegex: RegExp | null;
    jsonPaths: JsonPathFilter[];
    onLine: (line: KubeLogLine) => void;
    onLastTimestamp: (ts: string | undefined) => void;
    canEmit?: (sig: string) => boolean; // optional dedupe guard
  }): void {
    const {
      logText,
      namespace,
      podName,
      container,
      includeTimestampsOutput,
      messageRegex,
      excludeRegex,
      jsonPaths,
      onLine,
      onLastTimestamp,
      canEmit,
    } = args;

    if (!logText) return;
    const rawLines = String(logText)
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);

    let lastTs: string | undefined;

    for (const raw of rawLines) {
      let tsStr: string | undefined;
      let msg = raw;
      // If timestamps were requested in log fetch, each line begins with RFC3339 timestamp and a space
      const spaceIdx = raw.indexOf(' ');
      const maybeTs = spaceIdx >= 0 ? raw.slice(0, spaceIdx) : '';
      if (this.looksLikeRfc3339(maybeTs)) {
        tsStr = maybeTs;
        msg = raw.slice(spaceIdx + 1);
      }

      // If no timestamp found, synthesize
      if (!tsStr) tsStr = new Date().toISOString();

      // Try parse JSON
      let parsed: any | undefined = undefined;
      const first = msg.trim()[0];
      if (first === '{' || first === '[') {
        try {
          parsed = JSON.parse(msg);
        } catch {
          // not JSON, continue
        }
      }

      // Filters
      if (messageRegex && !messageRegex.test(msg)) continue;
      if (excludeRegex && excludeRegex.test(msg)) continue;
      if (parsed && jsonPaths.length > 0) {
        let ok = true;
        for (const jp of jsonPaths) {
          const value = this.resolveJsonPath(parsed, jp.path);
          if (jp.equals !== undefined && String(value) !== String(jp.equals)) {
            ok = false;
            break;
          }
          if (jp.regex) {
            const re = safeBuildRegex(jp.regex);
            if (re && !re.test(String(value))) {
              ok = false;
              break;
            }
          }
        }
        if (!ok) continue;
      }

      lastTs = tsStr;

      const line: KubeLogLine = {
        type: 'log',
        ts: tsStr,
        namespace,
        pod: podName,
        container,
        message: msg,
      };
      if (parsed !== undefined) line.json = parsed;

      // Dedupe across polls based on (ts|message)
      const signature = `${tsStr}|${msg}`;
      if (typeof canEmit === 'function' && !canEmit(signature)) {
        continue;
      }

      // If user did not request timestamps in output, we still keep ts field for structured output
      if (!includeTimestampsOutput) {
        // no-op: consumer can ignore ts; for text formatting we drop later
      }

      onLine(line);
    }

    onLastTimestamp(lastTs);
  }

  private startEventsWatch(args: {
    client: KubernetesClient;
    namespace: string;
    targetPods: Map<string, k8s.V1Pod>;
    ownerKind?: OwnerKind;
    ownerName?: string;
    eventType: 'Normal' | 'Warning' | 'All';
    since?: string;
    sinceTime?: string;
    onEvent: (line: KubeLogLine) => void;
  }): () => void {
    const {
      client,
      namespace,
      targetPods,
      ownerKind,
      ownerName,
      eventType,
      since,
      sinceTime,
      onEvent,
    } = args;
    const watch = new k8s.Watch(client.kubeConfig);
    let aborted = false;

    // Build fieldSelector when possible
    const fieldSelectors: string[] = [];
    if (ownerKind && ownerName) {
      fieldSelectors.push(`involvedObject.kind=${ownerKind}`);
      fieldSelectors.push(`involvedObject.name=${ownerName}`);
    }
    const fieldSelector = fieldSelectors.length > 0 ? fieldSelectors.join(',') : undefined;

    let request: any;
    const path = `/api/v1/namespaces/${namespace}/events`;
    const params: any = { fieldSelector };
    void watch
      .watch(
        path,
        params,
        (_type: string, obj: any) => {
          if (aborted) return;
          try {
            const e = obj as any;
            const involved = e?.involvedObject || {};
            const evtNs = e?.metadata?.namespace || namespace;
            const ts =
              e?.lastTimestamp || e?.eventTime || e?.firstTimestamp || new Date().toISOString();

            // Time filter
            const sinceCutoff = sinceTime
              ? Date.parse(sinceTime)
              : since
                ? Date.now() - this.parseDuration(since) * 1000
                : undefined;
            if (sinceCutoff && Date.parse(ts) < sinceCutoff) return;

            // Type filter
            if (eventType !== 'All' && e?.type && e.type !== eventType) return;

            // Scope filter: include events if they directly refer to the owner, or a pod in target set
            let include = false;
            if (ownerKind && ownerName) {
              if (involved?.kind === ownerKind && involved?.name === ownerName) include = true;
            }
            if (!include) {
              if (involved?.kind === 'Pod' && targetPods.has(involved?.name)) include = true;
            }
            if (!include) return;

            const line: KubeLogLine = {
              type: 'event',
              ts,
              namespace: evtNs,
              pod: involved?.name || '-',
              message: `${e?.reason ? `[${e.reason}] ` : ''}${e?.message || ''}`.trim(),
            };
            onEvent(line);
          } catch {
            // ignore
          }
        },
        () => {
          // ignore errors; watch is best-effort in this tool
        },
      )
      .then((req) => (request = req))
      .catch(() => void 0);

    return () => {
      aborted = true;
      try {
        request?.abort?.();
      } catch {
        // ignore
      }
    };
  }

  private parseDuration(duration: string): number {
    const match = duration
      ?.toString()
      .trim()
      .match(/^(\d+)([smhd])$/);
    if (!match) return 0;
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
        return 0;
    }
  }

  private sinceToRfc3339(since: string): string | undefined {
    const seconds = this.parseDuration(since);
    if (!seconds) return undefined;
    const date = new Date(Date.now() - seconds * 1000);
    return date.toISOString();
  }

  private looksLikeRfc3339(s: string): boolean {
    if (!s || s.length < 20) return false;
    // Very loose check: YYYY-MM-DDTHH:MM:SS
    return /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s);
  }

  private resolveJsonPath(obj: any, path: string): any {
    if (!path) return undefined;
    const parts = path.split('.');
    let cur: any = obj;
    for (const p of parts) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
        cur = cur[p];
      } else {
        return undefined;
      }
    }
    return cur;
  }
}

function isFiniteNumber(n: any): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function safeBuildRegex(expr?: string): RegExp | null {
  if (!expr || typeof expr !== 'string' || expr.trim().length === 0) return null;
  try {
    // If user did not wrap with /.../ flags, treat as plain pattern without flags
    return new RegExp(expr);
  } catch {
    // Try substring-like fallback by escaping
    try {
      return new RegExp(escapeRegExp(expr));
    } catch {
      return null;
    }
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

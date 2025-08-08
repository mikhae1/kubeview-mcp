import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import * as k8s from '@kubernetes/client-node';
import { Readable, Writable } from 'node:stream';

/**
 * Execute a command in a container within a Kubernetes pod using the Kubernetes API (no kubectl)
 */
export class ExecTool implements BaseTool {
  tool: Tool = {
    name: 'kube_exec',
    description:
      'Execute a command in a container of a pod via the Kubernetes API (no kubectl). Captures stdout/stderr and returns them when the command completes.',
    inputSchema: {
      type: 'object',
      properties: {
        podName: {
          type: 'string',
          description: 'Name of the target Pod',
        },
        namespace: {
          type: 'string',
          description: 'Kubernetes namespace (defaults to "default")',
          optional: true,
        },
        container: {
          type: 'string',
          description: 'Container name (optional; defaults to first container)',
          optional: true,
        },
        command: {
          type: 'string',
          description:
            'Shell command to run. Defaults to trying /bin/bash first, then /bin/sh, then other common shells. Provide this OR args[].',
          optional: true,
        },
        args: {
          type: 'array',
          description:
            'Exact argv to execute without a shell, e.g., ["/bin/ls","-la"]. Provide this OR command.',
          items: { type: 'string' },
          optional: true,
        },
        argv: {
          type: 'string',
          description:
            'Whitespace-separated argv to execute without a shell (e.g., "/usr/bin/env printenv"). Convenience for CLI; prefer args[] when possible.',
          optional: true,
        },
        stdin: {
          type: 'string',
          description: 'Optional data to write to process stdin before closing it',
          optional: true,
        },
        tty: {
          type: 'boolean',
          description: 'Allocate a TTY (default false)',
          optional: true,
        },
        timeoutSeconds: {
          type: 'number',
          description: 'Maximum time to wait for command completion (default 60s)',
          optional: true,
        },
        shell: {
          type: 'string',
          description: 'Shell binary used when command is provided (default /bin/sh)',
          optional: true,
        },
      },
      required: ['podName'],
    },
  };

  async execute(params: any, client: KubernetesClient): Promise<any> {
    const namespace: string = params.namespace || 'default';
    const podName: string = params.podName;
    let container: string | undefined = params.container;
    const tty: boolean = Boolean(params.tty);
    const timeoutSeconds: number =
      typeof params.timeoutSeconds === 'number' ? params.timeoutSeconds : 60;
    const shell: string | undefined = params.shell;

    if (!podName || typeof podName !== 'string') {
      throw new Error('podName is required');
    }

    const args: string[] | undefined = Array.isArray(params.args)
      ? (params.args as string[])
      : undefined;
    const argvString: string | undefined =
      typeof params.argv === 'string' ? params.argv : undefined;
    const commandText: string | undefined =
      typeof params.command === 'string' ? params.command : undefined;

    if ((!args || args.length === 0) && !argvString && !commandText) {
      throw new Error('Provide args[] (preferred), argv (string), or command (shell)');
    }
    // Ensure container is resolved (default to the first container in the pod if not provided)
    if (!container) {
      try {
        const pod: any = await client.core.readNamespacedPod({ name: podName, namespace });
        container = pod?.spec?.containers?.[0]?.name;
      } catch (e: any) {
        const msg = e?.response?.body?.message || e?.message || 'Unknown error fetching pod';
        throw new Error(`Failed to resolve default container for pod '${podName}': ${msg}`);
      }

      if (!container) {
        throw new Error(
          `No container specified and failed to determine default container for pod '${podName}'`,
        );
      }
    }

    // Helper to run one exec attempt and capture output and status
    const runOnce = async (argv: string[]) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      const stdoutStream = new Writable({
        write(chunk, _enc, cb) {
          stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          cb();
        },
      });
      const stderrStream = new Writable({
        write(chunk, _enc, cb) {
          stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          cb();
        },
      });

      let stdinStream: Readable | null = null;
      if (typeof params.stdin === 'string') {
        stdinStream = Readable.from([params.stdin]);
      }

      const execApi = new (k8s as any).Exec(client.kubeConfig) as k8s.Exec;
      let statusObject: any = null;
      let wsOrCloser: any;
      const execPromise = (execApi as any)
        .exec(
          namespace,
          podName,
          container as string,
          argv,
          stdoutStream,
          stderrStream,
          stdinStream,
          tty,
          (status: any) => {
            statusObject = status;
          },
        )
        .then((ret: any) => {
          wsOrCloser = ret;
        })
        .catch((err: any) => {
          const msg = err?.response?.body?.message || err?.message || 'Unknown exec error';
          throw new Error(`Exec failed: ${msg}`);
        });

      let timeoutHandle: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error('Exec timed out')),
          timeoutSeconds * 1000,
        );
      });

      try {
        await Promise.race([execPromise, timeoutPromise]);
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }

      const waitForFinish = (stream: Writable) =>
        new Promise<void>((resolve) => {
          let resolved = false;
          let safetyTimer: NodeJS.Timeout | undefined;
          const done = () => {
            if (!resolved) {
              resolved = true;
              if (safetyTimer) clearTimeout(safetyTimer);
              resolve();
            }
          };
          stream.once('finish', done);
          stream.once('close', done);
          safetyTimer = setTimeout(done, 200);
        });

      await Promise.all([waitForFinish(stdoutStream), waitForFinish(stderrStream)]);

      // Attempt to close websocket if the client returned a close handle
      try {
        if (typeof wsOrCloser === 'function') {
          const ws = wsOrCloser();
          ws?.close?.();
        } else if (wsOrCloser && typeof wsOrCloser.close === 'function') {
          wsOrCloser.close();
        }
      } catch {
        // ignore
      }

      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      // Ensure no dangling handles
      stdoutStream.removeAllListeners();
      stderrStream.removeAllListeners();
      stdoutStream.destroy();
      stderrStream.destroy();
      return { argv, stdout, stderr, statusObject };
    };

    // Determine argv candidates
    const candidates: string[][] = [];
    if (args && args.length > 0) {
      candidates.push(args);
    } else if (argvString) {
      candidates.push(argvString.trim().split(/\s+/));
    } else {
      // shell mode
      if (shell) {
        candidates.push([shell, '-c', commandText as string]);
      } else {
        const fallbacks = [
          '/bin/bash',
          '/usr/bin/bash',
          '/bin/sh',
          '/usr/bin/sh',
          '/bin/ash',
          '/usr/bin/ash',
          '/busybox/sh',
        ];
        for (const sh of fallbacks) {
          candidates.push([sh, '-c', commandText as string]);
        }
      }
    }

    // Try candidates until one runs without shell-not-found error
    let lastResult: any = null;
    for (const argv of candidates) {
      const result = await runOnce(argv);
      lastResult = result;
      const status = result.statusObject;
      const message = status?.message || '';
      const shellPath = argv[0];
      const shellMissing =
        typeof message === 'string' &&
        message.includes('no such file or directory') &&
        message.includes(shellPath);
      if (!shellMissing) {
        return {
          namespace,
          podName,
          container,
          command: argv,
          tty,
          stdout: result.stdout,
          stderr: result.stderr,
          status: status || undefined,
          stdoutBytes: Buffer.byteLength(result.stdout || '', 'utf8'),
          stderrBytes: Buffer.byteLength(result.stderr || '', 'utf8'),
        };
      }
      // else continue to next candidate
    }

    // All candidates failed due to missing shell
    return {
      namespace,
      podName,
      container,
      command: lastResult?.argv,
      tty,
      stdout: lastResult?.stdout ?? '',
      stderr: lastResult?.stderr ?? '',
      status: lastResult?.statusObject || undefined,
      stdoutBytes: Buffer.byteLength(lastResult?.stdout || '', 'utf8'),
      stderrBytes: Buffer.byteLength(lastResult?.stderr || '', 'utf8'),
    };
  }
}

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { spawn } from 'child_process';
import * as net from 'net';

/**
 * Temporary port-forward to a pod or service for local probing.
 * Uses `kubectl port-forward` under the hood and auto-stops after a timeout.
 */
export class PortForwardTool implements BaseTool {
  tool: Tool = {
    name: 'port_forward',
    description: 'Temporary port-forward to a pod/service for local probing (runs with a timeout).',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: {
          ...CommonSchemas.namespace,
          description: 'Kubernetes namespace (defaults to "default")',
        },
        podName: {
          type: 'string',
          description: 'Target Pod name (mutually exclusive with serviceName)',
          optional: true,
        },
        serviceName: {
          type: 'string',
          description: 'Target Service name (mutually exclusive with podName)',
          optional: true,
        },
        remotePort: {
          type: 'number',
          description: 'Remote container/service port to forward to (required)',
        },
        localPort: {
          type: 'number',
          description: 'Local port to bind. If omitted, a free ephemeral port is chosen',
          optional: true,
        },
        address: {
          type: 'string',
          description: 'Local address to bind (default 127.0.0.1)',
          optional: true,
        },
        timeoutSeconds: {
          type: 'number',
          description:
            'How long to keep the port-forward alive before auto-terminating (default 60s)',
          optional: true,
        },
        readinessTimeoutSeconds: {
          type: 'number',
          description:
            'How long to wait for port-forward to become ready before failing (default 10s)',
          optional: true,
        },
      },
      required: ['remotePort'],
    },
  };

  async execute(params: any, _client: KubernetesClient): Promise<any> {
    const namespace: string = params.namespace || 'default';
    const podName: string | undefined = params.podName;
    const serviceName: string | undefined = params.serviceName;
    const remotePort: number = params.remotePort;
    const localPort: number = params.localPort || (await this.findFreePort());
    const address: string = params.address || '127.0.0.1';
    const timeoutSeconds: number = params.timeoutSeconds ?? 60;
    const readinessTimeout: number = params.readinessTimeoutSeconds ?? 10;

    if (!podName && !serviceName) {
      throw new Error('Either podName or serviceName must be provided');
    }
    if (podName && serviceName) {
      throw new Error('Specify only one of podName or serviceName');
    }
    if (!remotePort || typeof remotePort !== 'number') {
      throw new Error('remotePort must be a number');
    }

    const resource = podName ? `pod/${podName}` : `svc/${serviceName}`;
    const args = [
      '-n',
      namespace,
      'port-forward',
      resource,
      `${localPort}:${remotePort}`,
      '--address',
      address,
    ];

    const startedAt = new Date();
    const willStopAt = new Date(startedAt.getTime() + timeoutSeconds * 1000);

    // Spawn kubectl port-forward
    const child = spawn('kubectl', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let ready = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const cleanup = () => {
      child.removeAllListeners();
      if (!child.killed) {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
      }
    };

    // Auto-stop after timeoutSeconds
    const stopTimer = setTimeout(() => {
      cleanup();
    }, timeoutSeconds * 1000);

    // Resolve when ready line appears or timeout expires
    const readiness = new Promise<void>((resolve, reject) => {
      const onData = (data: Buffer) => {
        stdoutBuffer += data.toString();
        if (/Forwarding from /.test(stdoutBuffer)) {
          ready = true;
          child.stdout?.off('data', onData);
          resolve();
        }
      };
      const onErr = (data: Buffer) => {
        stderrBuffer += data.toString();
        // Some kubectl versions write readiness to stderr; accept either
        if (/Forwarding from /.test(stderrBuffer)) {
          ready = true;
          child.stderr?.off('data', onErr);
          resolve();
        }
      };
      const onClose = (code: number | null) => {
        if (!ready) {
          reject(new Error(`kubectl port-forward exited prematurely with code ${code}`));
        }
      };

      child.stdout?.on('data', onData);
      child.stderr?.on('data', onErr);
      child.once('close', onClose);

      setTimeout(() => {
        if (!ready) {
          reject(new Error('Timed out waiting for port-forward readiness'));
        }
      }, readinessTimeout * 1000);
    });

    try {
      await readiness;
    } catch (error: any) {
      clearTimeout(stopTimer);
      cleanup();
      const hint = stderrBuffer || stdoutBuffer;
      const message = error?.message || 'Failed to start port-forward';
      throw new Error(`${message}${hint ? `\nDetails: ${hint}` : ''}`);
    }

    return {
      resource,
      namespace,
      localAddress: address,
      localPort,
      remotePort,
      processId: child.pid,
      startedAt: startedAt.toISOString(),
      willStopAt: willStopAt.toISOString(),
      notes:
        'Port-forward started via kubectl and will be auto-terminated after timeoutSeconds. Use the local address/port until then.',
    };
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr && 'port' in addr) {
          const port = addr.port as number;
          server.close(() => resolve(port));
        } else {
          server.close(() => reject(new Error('Failed to allocate free port')));
        }
      });
    });
  }
}

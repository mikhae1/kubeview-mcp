import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, CommonSchemas } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import * as k8s from '@kubernetes/client-node';
import * as net from 'net';
import { PassThrough } from 'node:stream';

/**
 * Temporary port-forward to a pod or service for local probing.
 * Implements port-forward purely via Kubernetes API (no kubectl) and auto-stops after a timeout.
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

  async execute(params: any, client: KubernetesClient): Promise<any> {
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

    // Resolve target pod and container port
    const { targetPodName, targetContainerPort } = await this.resolveTargetPodAndPort(
      client,
      namespace,
      podName,
      serviceName,
      remotePort,
    );

    const resource = `pod/${targetPodName}`;

    const startedAt = new Date();
    const willStopAt = new Date(startedAt.getTime() + timeoutSeconds * 1000);

    const portForward = new k8s.PortForward(client.kubeConfig);
    const activeConnections: Array<{ socket: net.Socket; closeWs: () => void }> = [];

    // Create local TCP server which forwards each incoming TCP stream via Kubernetes PortForward
    const server = net.createServer((socket) => {
      const errStream = new PassThrough();
      errStream.on('data', () => {
        // Swallow remote error stream; socket 'error' will fire on failures
        void 0;
      });

      portForward
        .portForward(namespace, targetPodName, [targetContainerPort], socket, errStream, socket)
        .then((result: any) => {
          let closeWs: () => void = () => undefined;
          if (typeof result === 'function') {
            closeWs = () => {
              try {
                const ws = result();
                ws?.close();
              } catch {
                void 0;
              }
            };
          } else if (result && typeof result.close === 'function') {
            closeWs = () => {
              try {
                result.close();
              } catch {
                void 0;
              }
            };
          }

          activeConnections.push({ socket, closeWs });
          const remove = () => {
            const idx = activeConnections.findIndex((c) => c.socket === socket);
            if (idx >= 0) activeConnections.splice(idx, 1);
            try {
              closeWs();
            } catch {
              void 0;
            }
          };
          socket.once('close', remove);
          socket.once('error', remove);
        })
        .catch((_err) => {
          try {
            socket.destroy();
          } catch {
            void 0;
          }
        });
    });

    const serverReady = new Promise<void>((resolve, reject) => {
      const readyTimer = setTimeout(() => {
        reject(new Error('Timed out waiting for port-forward server readiness'));
      }, readinessTimeout * 1000);

      server.once('listening', () => {
        clearTimeout(readyTimer);
        resolve();
      });
      server.once('error', (err) => {
        clearTimeout(readyTimer);
        reject(err);
      });
    });

    server.listen(localPort, address);

    // Auto-stop after timeoutSeconds
    const stopTimer = setTimeout(() => {
      try {
        server.close();
      } catch {
        void 0;
      }
      for (const { socket, closeWs } of activeConnections.splice(0)) {
        try {
          closeWs();
        } catch {
          void 0;
        }
        try {
          socket.destroy();
        } catch {
          void 0;
        }
      }
    }, timeoutSeconds * 1000);

    try {
      await serverReady;
    } catch (error: any) {
      clearTimeout(stopTimer);
      try {
        server.close();
      } catch {
        void 0;
      }
      throw new Error(error?.message || 'Failed to start port-forward server');
    }

    return {
      resource,
      namespace,
      localAddress: address,
      localPort,
      remotePort: targetContainerPort,
      startedAt: startedAt.toISOString(),
      willStopAt: willStopAt.toISOString(),
      notes:
        'Port-forward started via Kubernetes API and will be auto-terminated after timeoutSeconds. Connect to the local address/port until then.',
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

  private async resolveTargetPodAndPort(
    client: KubernetesClient,
    namespace: string,
    podName: string | undefined,
    serviceName: string | undefined,
    servicePortOrTarget: number,
  ): Promise<{ targetPodName: string; targetContainerPort: number }> {
    if (podName) {
      // Direct pod forwarding to the specified target port
      return { targetPodName: podName, targetContainerPort: servicePortOrTarget };
    }

    // Resolve service -> pod and container port using Endpoints
    if (!serviceName) {
      throw new Error('Either podName or serviceName must be provided');
    }

    // Fetch Service to identify port name mapping (optional but helpful)
    let service: any | undefined;
    try {
      service = await client.resources.service.get(serviceName, { namespace });
    } catch {
      // continue; we'll rely on Endpoints if possible
    }

    const endpoints = await client.resources.service.getEndpoints(serviceName, { namespace });
    if (!endpoints || !endpoints.subsets || endpoints.subsets.length === 0) {
      throw new Error(`Service '${serviceName}' has no ready endpoints`);
    }

    // Determine the service port name that matches the requested servicePortOrTarget
    let desiredPortName: string | undefined;
    let directTargetPort: number | undefined;
    if (service?.spec?.ports?.length) {
      const match = service.spec.ports.find((p: any) => p?.port === servicePortOrTarget);
      if (match) {
        desiredPortName = match.name;
        if (typeof match.targetPort === 'number') {
          directTargetPort = match.targetPort;
        }
      }
    }

    for (const subset of endpoints.subsets) {
      const readyAddresses = subset.addresses || [];
      if (!readyAddresses.length) continue;

      // Choose port: prefer matching by name, otherwise use directTargetPort, otherwise first port
      let chosenPort: number | undefined;
      if (desiredPortName && subset.ports) {
        const epPort = subset.ports.find((p: any) => p?.name === desiredPortName);
        if (epPort?.port) chosenPort = epPort.port;
      }
      if (!chosenPort && typeof directTargetPort === 'number') {
        chosenPort = directTargetPort;
      }
      if (!chosenPort && subset.ports && subset.ports.length > 0) {
        // As a last resort, try to match the numeric service port to an endpoint port
        const numericMatch = subset.ports.find((p: any) => p?.port === servicePortOrTarget);
        chosenPort = numericMatch?.port ?? subset.ports[0].port;
      }

      // Find a targetRef Pod to forward to
      const addressWithPod = readyAddresses.find((a: any) => a?.targetRef?.kind === 'Pod');
      const targetPodName = addressWithPod?.targetRef?.name;
      if (targetPodName && chosenPort) {
        return { targetPodName, targetContainerPort: chosenPort };
      }
    }

    throw new Error(
      `Failed to resolve a target Pod/port for service '${serviceName}' on port ${servicePortOrTarget}`,
    );
  }
}

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool } from './BaseTool.js';
import { KubernetesClient } from '../../kubernetes/KubernetesClient.js';
import { ExecTool } from './ExecTool.js';

interface NetToolParams {
  sourcePod: string;
  namespace?: string;
  container?: string;
  // Optional connectivity targets
  targetPod?: string;
  targetPodNamespace?: string;
  targetService?: string;
  targetServiceNamespace?: string;
  targetPort?: number;
  externalHost?: string;
  externalPort?: number;
  dnsNames?: string[];
  // Toggle checks (new parameter names)
  runDnsTest?: boolean;
  runInternetTest?: boolean;
  runPodConnectivityTest?: boolean;
  runServiceConnectivityTest?: boolean;
  // Timeouts
  timeoutSeconds?: number;
}

type ExecResult = {
  command: string[] | string | undefined;
  stdout: string;
  stderr: string;
  status?: any;
  // Indicates the exec call itself failed (e.g., no shell available)
  execError?: boolean;
};

export class KubeNetTool implements BaseTool {
  tool: Tool = {
    name: 'kube_net',
    description:
      'Network diagnostics from a source pod: DNS resolution, internet egress, and pod/service connectivity checks with robust fallbacks.',
    inputSchema: {
      type: 'object',
      properties: {
        sourcePod: {
          type: 'string',
          description: 'Name of the source Pod to run diagnostics from',
        },
        namespace: {
          type: 'string',
          description: 'Namespace of the source Pod (defaults to "default")',
          optional: true,
        },
        container: {
          type: 'string',
          description: 'Container name in the source Pod (defaults to first container)',
          optional: true,
        },
        targetPod: {
          type: 'string',
          description: 'Optional target Pod name for pod-to-pod connectivity test',
          optional: true,
        },
        targetPodNamespace: {
          type: 'string',
          description: 'Namespace of the target Pod (defaults to source namespace)',
          optional: true,
        },
        targetService: {
          type: 'string',
          description: 'Optional Service name for service connectivity test',
          optional: true,
        },
        targetServiceNamespace: {
          type: 'string',
          description: 'Namespace of the target Service (defaults to source namespace)',
          optional: true,
        },
        targetPort: {
          type: 'number',
          description: 'Port to use for TCP connectivity tests (defaults to 80)',
          optional: true,
        },
        externalHost: {
          type: 'string',
          description: 'External host to test internet egress (defaults to www.google.com)',
          optional: true,
        },
        externalPort: {
          type: 'number',
          description: 'Port on external host for TCP test (defaults to 443)',
          optional: true,
        },
        dnsNames: {
          type: 'array',
          description: 'List of domain names to resolve during DNS check',
          items: { type: 'string' },
          optional: true,
        },
        runDnsTest: {
          type: 'boolean',
          description: 'Enable DNS resolution checks',
          optional: true,
        },
        runInternetTest: {
          type: 'boolean',
          description: 'Enable internet egress checks',
          optional: true,
        },
        runPodConnectivityTest: {
          type: 'boolean',
          description: 'Enable pod-to-pod connectivity test (requires targetPod)',
          optional: true,
        },
        runServiceConnectivityTest: {
          type: 'boolean',
          description: 'Enable service connectivity test (requires targetService)',
          optional: true,
        },
        timeoutSeconds: {
          type: 'number',
          description: 'Per-check timeout in seconds (defaults to 20)',
          optional: true,
        },
      },
      required: ['sourcePod'],
    },
  };

  async execute(params: NetToolParams, client: KubernetesClient): Promise<any> {
    const namespace = params.namespace || client.getCurrentNamespace?.() || 'default';
    const sourcePod = params.sourcePod;
    const container = params.container;
    const timeoutSeconds = typeof params.timeoutSeconds === 'number' ? params.timeoutSeconds : 20;
    const targetPort = typeof params.targetPort === 'number' ? params.targetPort : 80;
    const externalHost = params.externalHost || 'www.google.com';
    const externalPort = typeof params.externalPort === 'number' ? params.externalPort : 443;
    const dnsNames =
      Array.isArray(params.dnsNames) && params.dnsNames.length > 0
        ? params.dnsNames
        : ['kubernetes.default', 'kube-dns.kube-system.svc.cluster.local', 'www.google.com'];

    if (!sourcePod || typeof sourcePod !== 'string') {
      throw new Error('sourcePod is required');
    }

    const execTool = new ExecTool();
    const runShell = async (script: string, overrideContainer?: string): Promise<ExecResult> => {
      try {
        const result = await execTool.execute(
          {
            podName: sourcePod,
            namespace,
            container: overrideContainer || container,
            command: script,
            timeoutSeconds,
          },
          client,
        );
        return {
          command: result.command,
          stdout: result.stdout,
          stderr: result.stderr,
          status: result.status,
        } as ExecResult;
      } catch {
        return {
          command: undefined,
          stdout: '',
          stderr: '',
          status: { message: 'exec_error' },
          execError: true,
        } as ExecResult;
      }
    };

    const isExecFailed = (res: ExecResult): boolean => {
      if (!res) return true;
      if ((res as any).execError) return true;
      const msg: string = (res.status?.message as string) || '';
      return (
        /no such file or directory/i.test(msg) &&
        /(\/bin\/|\bsh\b|\bbash\b|\bash\b|busybox)/i.test(msg)
      );
    };

    const checks: any[] = [];
    // Determine explicit mode: user provided any boolean flags (true or false)
    const explicitMode =
      typeof params.runDnsTest === 'boolean' ||
      typeof params.runInternetTest === 'boolean' ||
      typeof params.runPodConnectivityTest === 'boolean' ||
      typeof params.runServiceConnectivityTest === 'boolean';

    // DNS resolution check
    const dnsEnabled = explicitMode ? params.runDnsTest === true : params.runDnsTest !== false; // default true unless explicit selection
    if (dnsEnabled) {
      const domainsArg = dnsNames.map((d) => `'${String(d).replace(/'/g, "'\\''")}'`).join(' ');
      const dnsScript = (
        `echo "[dns] resolv.conf:"\n` +
        `cat /etc/resolv.conf || true\n` +
        `for d in ${domainsArg}; do\n` +
        `  echo "[dns] resolving: $d"\n` +
        `  getent hosts "$d" 2>/dev/null || nslookup "$d" 2>/dev/null || busybox nslookup "$d" 2>/dev/null || dig +short "$d" 2>/dev/null || echo "RESOLVE_FAIL $d"\n` +
        `done`
      ).trim();

      const res = await runShell(dnsScript);
      const execFailed = isExecFailed(res);
      const hasIp = /(^|\s)(\d{1,3}\.){3}\d{1,3}(\s|$)/.test(res.stdout);
      const resolveFailures = /RESOLVE_FAIL /.test(res.stdout);
      // If none of the resolvers are present, stderr may contain many 'not found' lines; normalize to exec error
      const resolversMissing =
        /getent: not found|nslookup: not found|busybox: not found|dig: not found/i.test(
          res.stderr,
        ) && !hasIp;
      checks.push({
        name: 'dns',
        target: { domains: dnsNames },
        success: execFailed ? false : hasIp && !resolveFailures,
        probes: { dnsLookup: hasIp && !resolveFailures },
        output: res.stdout,
        error: execFailed || resolversMissing ? 'Failed to execute command in the pod' : res.stderr,
      });
    }

    // Internet egress check to external host:port using multiple fallbacks
    const internetEnabled = explicitMode
      ? params.runInternetTest === true
      : params.runInternetTest !== false; // default true unless explicit selection
    if (internetEnabled) {
      const host = externalHost;
      const port = externalPort;
      const internetScript = (
        `host='${host.replace(/'/g, "'\\''")}'; port=${port}; ok=0;\n` +
        `if command -v nc >/dev/null 2>&1 && nc -z -w5 "$host" "$port" >/dev/null 2>&1; then echo NC_OK; ok=1; fi;\n` +
        `if [ $ok -eq 0 ] && command -v curl >/dev/null 2>&1; then code=$(curl -skm5 -o /dev/null -w '%{http_code}' "https://$host:$port" 2>/dev/null || echo 000); echo CURL_CODE:$code; if [ "$code" != "000" ]; then ok=1; fi; fi;\n` +
        `if [ $ok -eq 0 ] && command -v wget >/dev/null 2>&1; then if wget --no-check-certificate -q --timeout=5 -O- "https://$host:$port" >/dev/null 2>&1; then echo WGET_OK; ok=1; fi; fi;\n` +
        `if [ $ok -eq 0 ] && command -v ping >/dev/null 2>&1; then if ping -c1 -W5 "$host" >/dev/null 2>&1 || ping -c1 -w5 "$host" >/dev/null 2>&1; then echo PING_OK; ok=1; fi; fi;\n` +
        `if [ $ok -eq 0 ] && command -v nc >/dev/null 2>&1; then if nc -z -w5 "$host" "$port" >/dev/null 2>&1; then echo NC_TCP_OK; ok=1; fi; fi;\n` +
        `if [ $ok -eq 0 ] && command -v bash >/dev/null 2>&1; then if bash -lc "</dev/tcp/$host/$port" >/dev/null 2>&1; then echo BASH_TCP_OK; ok=1; fi; fi;\n` +
        `if [ $ok -eq 1 ]; then echo CONNECT_OK; else echo CONNECT_FAIL; fi`
      ).trim();

      // Try the specified container first; if not provided, try all containers in the pod
      let internetSuccess = false;
      let finalStdout = '';
      let finalStderr = '';
      let anyExecFailed = false;
      const triedContainers: Array<{ container?: string; ok: boolean; stdoutLen: number }> = [];

      const tryContainer = async (c?: string) => {
        const res = await runShell(internetScript, c);
        const execFailed = isExecFailed(res);
        if (execFailed) anyExecFailed = true;
        const ok = /CONNECT_OK/.test(res.stdout) && !/CONNECT_FAIL/.test(res.stdout);
        triedContainers.push({ container: c, ok, stdoutLen: res.stdout?.length || 0 });
        if (ok) {
          internetSuccess = true;
          finalStdout = res.stdout;
          finalStderr = res.stderr;
          return true;
        }
        // Track last output even if failed for diagnostics
        finalStdout = res.stdout;
        finalStderr = res.stderr;
        return false;
      };

      if (container) {
        await tryContainer(container);
      } else {
        try {
          const pod: any = await client.core.readNamespacedPod({ name: sourcePod, namespace });
          const containers: string[] = (pod?.spec?.containers || []).map((c: any) => c.name);
          for (const c of containers) {
            const ok = await tryContainer(c);
            if (ok) break;
          }
        } catch {
          // fallback single attempt
          const res = await runShell(internetScript);
          const execFailed = isExecFailed(res);
          if (execFailed) anyExecFailed = true;
          finalStdout = res.stdout;
          finalStderr = res.stderr;
          internetSuccess = /CONNECT_OK/.test(res.stdout) && !/CONNECT_FAIL/.test(res.stdout);
        }
      }

      // Parse probe signals from output for consistent format
      const ncOk = /\bNC_OK\b|\bNC_TCP_OK\b/.test(finalStdout);
      const curlCodeMatch = finalStdout.match(/CURL_CODE:(\d{1,6})/);
      const curlCode = curlCodeMatch ? Number(curlCodeMatch[1]) : undefined;
      const curlOk = typeof curlCode === 'number' && curlCode >= 200 && curlCode < 400;
      const wgetOk = /\bWGET_OK\b/.test(finalStdout);
      const pingOkInet = /\bPING_OK\b/.test(finalStdout);
      const bashTcpOk = /\bBASH_TCP_OK\b/.test(finalStdout);
      checks.push({
        name: 'internet',
        target: { host, port },
        success: internetSuccess,
        probes: {
          nc: ncOk,
          curl: curlOk,
          wget: wgetOk,
          ping: pingOkInet,
          bashTcp: bashTcpOk,
          curlCode,
        },
        triedContainers,
        output: finalStdout,
        error:
          !internetSuccess && anyExecFailed ? 'Failed to execute command in the pod' : finalStderr,
      });
    }

    // Pod-to-pod connectivity
    const wantPodConnectivity = explicitMode
      ? params.runPodConnectivityTest === true
      : Boolean(params.targetPod);
    if (wantPodConnectivity && params.targetPod) {
      const targetNs = params.targetPodNamespace || namespace;
      let podIp = '';
      try {
        const pod: any = await client.core.readNamespacedPod({
          name: params.targetPod,
          namespace: targetNs,
        });
        podIp = pod?.status?.podIP || '';
      } catch (e: any) {
        checks.push({
          name: 'pod_connectivity',
          success: false,
          detail: `Failed to get target pod IP for ${params.targetPod} in ${targetNs}: ${e?.response?.body?.message || e?.message || 'unknown error'}`,
        });
        podIp = '';
      }

      if (podIp) {
        const port = targetPort;
        const podScript = (
          `ip='${podIp}'; port=${port};\n` +
          // Emit explicit markers when required commands are missing so we can surface a clear error message
          `if command -v ping >/dev/null 2>&1; then (ping -c1 -W5 "$ip" >/dev/null 2>&1 || ping -c1 -w5 "$ip" >/dev/null 2>&1) && echo PING_OK; else echo PING_CMD_NOT_FOUND; fi;\n` +
          `if command -v nc >/dev/null 2>&1; then if nc -z -w5 "$ip" "$port" >/dev/null 2>&1; then echo TCP_OK; fi; else echo NC_CMD_NOT_FOUND; fi;\n` +
          `scheme=$( [ "$port" -eq 443 ] && echo https || echo http );\n` +
          `if command -v curl >/dev/null 2>&1; then code=$(curl -skm5 -o /dev/null -w '%{http_code}' "$scheme://$ip:$port" 2>/dev/null || echo 000); echo CURL_CODE:$code; case "$code" in 2*|3*) echo TCP_OK;; esac; fi;\n` +
          `if command -v bash >/dev/null 2>&1; then if bash -lc "</dev/tcp/$ip/$port" >/dev/null 2>&1; then echo TCP_OK; fi; fi`
        ).trim();

        const res = await runShell(podScript);
        const execFailed = isExecFailed(res);
        const pingOk = /PING_OK/.test(res.stdout);
        const tcpOk = /TCP_OK/.test(res.stdout);
        const success = execFailed ? false : pingOk || tcpOk;
        checks.push({
          name: 'pod_connectivity',
          target: { podName: params.targetPod, namespace: targetNs, ip: podIp, port },
          success,
          probes: { ping: pingOk, tcp: tcpOk },
          pingOk,
          tcpOk,
          output: res.stdout,
          error: execFailed ? 'Failed to execute command in the pod' : res.stderr,
        });
      }
    }

    // Service connectivity
    const wantServiceConnectivity = explicitMode
      ? params.runServiceConnectivityTest === true
      : Boolean(params.targetService);
    if (wantServiceConnectivity && params.targetService) {
      const svcNs = params.targetServiceNamespace || namespace;
      let svcPort = targetPort;
      let svcClusterIP = '';
      const svcFqdn = `${params.targetService}.${svcNs}.svc.cluster.local`;
      try {
        const svc: any = await client.core.readNamespacedService({
          name: params.targetService,
          namespace: svcNs,
        });
        svcClusterIP = svc?.spec?.clusterIP || '';
        const ports = (svc?.spec?.ports || []) as Array<any>;
        if (!params.targetPort && ports.length > 0) {
          svcPort = Number(ports[0].port) || svcPort;
        }
      } catch (e: any) {
        checks.push({
          name: 'service_connectivity',
          success: false,
          detail: `Failed to get service ${params.targetService} in ${svcNs}: ${e?.response?.body?.message || e?.message || 'unknown error'}`,
        });
      }

      // Only attempt runtime checks if we could read service
      if (svcClusterIP) {
        const svcScript = (
          `host='${svcFqdn.replace(/'/g, "'\\''")}'; port=${svcPort}; cip='${svcClusterIP}';\n` +
          `echo "[svc] resolving: $host";\n` +
          `getent hosts "$host" || nslookup "$host" || busybox nslookup "$host" || dig +short "$host" || echo "RESOLVE_FAIL $host";\n` +
          `scheme=$( [ "$port" -eq 443 ] && echo https || echo http );\n` +
          // DNS name TCP connectivity with robust fallbacks
          `ok=0;\n` +
          `if command -v nc >/dev/null 2>&1; then if nc -z -w5 "$host" "$port" >/dev/null 2>&1; then echo DNS_TCP_OK; ok=1; fi; fi;\n` +
          `if [ $ok -eq 0 ] && command -v curl >/dev/null 2>&1; then code=$(curl -skm5 -o /dev/null -w '%{http_code}' "$scheme://$host:$port" 2>/dev/null || echo 000); case "$code" in 2*|3*) echo DNS_TCP_OK; ok=1;; esac; fi;\n` +
          `if [ $ok -eq 0 ] && command -v wget >/dev/null 2>&1; then if wget --no-check-certificate -q --timeout=5 -O- "$scheme://$host:$port" >/dev/null 2>&1; then echo DNS_TCP_OK; ok=1; fi; fi;\n` +
          `if [ $ok -eq 0 ] && command -v bash >/dev/null 2>&1; then if bash -lc "</dev/tcp/$host/$port" >/dev/null 2>&1; then echo DNS_TCP_OK; ok=1; fi; fi;\n` +
          `if [ $ok -eq 0 ]; then echo DNS_TCP_FAIL; fi;\n` +
          // ClusterIP TCP connectivity with robust fallbacks
          `ok=0;\n` +
          `if command -v nc >/dev/null 2>&1; then if nc -z -w5 "$cip" "$port" >/dev/null 2>&1; then echo IP_TCP_OK; ok=1; fi; fi;\n` +
          `if [ $ok -eq 0 ] && command -v curl >/dev/null 2>&1; then code=$(curl -skm5 -o /dev/null -w '%{http_code}' "$scheme://$cip:$port" 2>/dev/null || echo 000); case "$code" in 2*|3*) echo IP_TCP_OK; ok=1;; esac; fi;\n` +
          `if [ $ok -eq 0 ] && command -v wget >/dev/null 2>&1; then if wget --no-check-certificate -q --timeout=5 -O- "$scheme://$cip:$port" >/dev/null 2>&1; then echo IP_TCP_OK; ok=1; fi; fi;\n` +
          `if [ $ok -eq 0 ] && command -v bash >/dev/null 2>&1; then if bash -lc "</dev/tcp/$cip/$port" >/dev/null 2>&1; then echo IP_TCP_OK; ok=1; fi; fi;\n` +
          `if [ $ok -eq 0 ]; then echo IP_TCP_FAIL; fi;`
        ).trim();

        const res = await runShell(svcScript);
        const execFailed = isExecFailed(res);
        const dnsTcpOk = /DNS_TCP_OK/.test(res.stdout);
        const ipTcpOk = /IP_TCP_OK/.test(res.stdout);
        const dnsResolved =
          /(\d{1,3}\.){3}\d{1,3}/.test(res.stdout) && !/RESOLVE_FAIL/.test(res.stdout);
        checks.push({
          name: 'service_connectivity',
          target: {
            serviceName: params.targetService,
            namespace: svcNs,
            clusterIP: svcClusterIP,
            port: svcPort,
            fqdn: svcFqdn,
          },
          success: execFailed ? false : dnsResolved && (dnsTcpOk || ipTcpOk),
          probes: { dnsLookup: dnsResolved, dnsTcp: dnsTcpOk, ipTcp: ipTcpOk },
          dnsResolved,
          dnsTcpOk,
          ipTcpOk,
          output: res.stdout,
          error: execFailed ? 'Failed to execute command in the pod' : res.stderr,
        });
      }
    }

    // Compile summary
    // Compute overall success: if user explicitly requested any checks, only those determine success;
    // otherwise, require all executed checks to succeed (legacy behavior)
    const computeOverallSuccess = (): boolean => {
      if (explicitMode) {
        const considered = checks.filter((c) => {
          if (c.name === 'dns') return params.runDnsTest === true;
          if (c.name === 'internet') return params.runInternetTest === true;
          if (c.name === 'pod_connectivity') return params.runPodConnectivityTest === true;
          if (c.name === 'service_connectivity') return params.runServiceConnectivityTest === true;
          return false;
        });
        if (considered.length === 0) return true;
        return considered.every((c) => c.success !== false);
      }
      return checks.every((c) => c.success !== false);
    };

    const summary = {
      namespace,
      sourcePod,
      container: container || undefined,
      settings: {
        timeoutSeconds,
        targetPort,
        externalHost,
        externalPort,
        dnsNames,
      },
      checks,
      overallSuccess: computeOverallSuccess(),
    };

    return summary;
  }
}

# KubeView MCP – Kubernetes Model Context Protocol Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue)](https://www.typescriptlang.org/)

KubeView MCP is a read-only Model Context Protocol (MCP) server that exposes AI-friendly tools for safe Kubernetes, Helm, Argo Workflows, and Argo CD introspection. It pairs with Cursor IDE, Claude Code/Desktop, and other MCP clients to let you inspect, diagnose, and debug clusters via natural language and without any change operations.

---

## ✨ Features

- **Kubernetes tools (read-only)**: list, get/describe, metrics, single-pod logs, multi-pod streaming logs with event merge, exec (read-only), port-forward, and in-cluster network diagnostics
- **Cluster overview**: one-shot, LLM-optimized diagnostics across nodes, workloads, storage, events, and security posture
- **Helm integration**: list releases; fetch values, manifest, notes, hooks, history, status, and parsed resources
- **Argo Workflows**: list/get workflows and fetch workflow logs
- **Argo CD**: list/get app details, resources, history, logs, and status via a single multi-operation tool
- **Sensitive data masking**: global redaction for secrets/tokens in ConfigMaps, Secrets, and Helm values
- **Zero write access**: designed to be safe in production from day one

---

## 🚀 Quick Start

### Zero-install via npx

```bash
npx -y https://github.com/mikhae1/kubeview-mcp
```

Add to your MCP client config (for Cursor, `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "kubeview-mcp": {
      "command": "npx",
      "args": ["-y", "https://github.com/mikhae1/kubeview-mcp"],
      "env": {
        "KUBECONFIG": "$HOME/.kube/config"
      }
    }
  }
}
```

### Prerequisites

- Node.js ≥ 18
- Access to a Kubernetes cluster (kubeconfig)
- Optional CLIs on PATH when using those plugins: `helm`, `argo`, `argocd`

### Local install

```bash
git clone https://github.com/mikhae1/kubeview-mcp.git
cd kubeview-mcp
npm install

# Generate local MCP config entries for Cursor and/or Claude Desktop
npm run setup
```

### Run

```bash
# Build and start
npm run build
npm start

# Or use the bundled binary wrapper
kubeview-mcp serve
```

---

## 📟 Tool Index (CLI)

Invoke tools with the helper:

```bash
npm run command -- <tool_name> [--param=value ...]
```

### Kubernetes

- **kube_list**: List resources or, when no `resourceType` is provided, return a cluster diagnostics overview
  - Params: `resourceType`, `namespace`, `labelSelector`, `fieldSelector`
  - Supported `resourceType` for listing: `pod`, `service`, `deployment`, `node`, `namespace`, `persistentvolume`, `persistentvolumeclaim`, `secret`, `configmap`, `role`, `clusterrole`, `rolebinding`, `clusterrolebinding`
- **kube_get**: Describe a single resource or list a type using plural, kind, shortname, or fully-qualified `group/version/resource`
  - Params: `resourceType` (required), `name`, `namespace`, `includeEvents`, `includeDiagnostics`, `eventsLimit`, `restartThreshold`, `skipSanitize` (for ConfigMaps)
- **kube_metrics**: Node and pod CPU/memory metrics, optional Prometheus enrichment and diagnostics
  - Params: `scope` (`all|nodes|pods`), `namespace`, `podName`, `includeSummary`, `diagnostics`, `prometheusQueries[]`, `fetchPodSpecs`, thresholds (`topN`, `cpuSaturationThreshold`, `memorySaturationThreshold`, `podRestartThreshold`, `podLimitPressureThreshold`)
- **kube_logs**: Pod/container logs (like `kubectl logs`)
  - Params: `podName` (required), `namespace`, `container`, `tailLines`, `since`, `previous`, `timestamps`
- **kube_log**: Multi-pod & multi-container log tail with dynamic discovery and merged Events
  - Selectors: `namespace`, `labelSelector`, `ownerKind` (`Deployment|DaemonSet|Job`), `ownerName`
  - Filters: `podRegex`, `containerRegex`, `messageRegex`, `excludeRegex`, `jsonPaths` (e.g., `[{"path":"level","equals":"error"}]`)
  - Time/tail: `tailLines`, `since` (e.g., `15m`), `sinceTime` (RFC3339), `timestamps`, `previous`
  - Session bounds: `durationSeconds` (default 30), `maxLines`
  - Events: `includeEvents` (default true), `eventType` (`Normal|Warning|All`)
  - Output: `structure` (`object|text`). In object mode each line has `type: 'log'|'event'`. In text mode events are prefixed with `[event]`.
- **kube_exec**: Execute a command in a container via Kubernetes API only; returns stdout/stderr
  - Params: `podName` (required), `namespace`, `container`, `args[]` | `argv` | `command`, `stdin`, `tty`, `timeoutSeconds`, `shell`
- **kube_port**: Temporary port-forward to a pod or service (auto-terminates)
  - Params: `namespace`, `podName` | `serviceName`, `remotePort` (required), `localPort`, `address`, `timeoutSeconds`, `readinessTimeoutSeconds`
- **kube_net**: In-pod network diagnostics (DNS resolution, internet egress, pod/service connectivity)
  - Params: `sourcePod` (required), `namespace`, `container`, `targetPod`, `targetPodNamespace`, `targetService`, `targetServiceNamespace`, `targetPort`, `externalHost`, `externalPort`, `dnsNames[]`, toggles: `runDnsTest`, `runInternetTest`, `runPodConnectivityTest`, `runServiceConnectivityTest`, `timeoutSeconds`

### Helm

- **helm_list**: List Helm releases
  - Params: `namespace`, `allNamespaces`, `outputFormat`, `selector`, `maxReleases`, `deployed`, `failed`, `pending`, `superseded`, `uninstalled`, `uninstalling`
- **helm_get**: Get release data
  - Params: `what` (`values|manifest|notes|hooks|resources|status|history`), `releaseName` (required), `namespace`, `revision`, `outputFormat`, `allValues`, `resourceType`, `showResources`

### Argo Workflows

- **argo_list**: List workflows with rich filters
  - Params: `namespace`, `allNamespaces`, `outputFormat`, `selector`, status flags (`running|succeeded|failed|pending|completed|status`), `since`, `chunked`, `maxWorkflows`
- **argo_get**: Get workflow details
  - Params: `workflowName` (required), `namespace`, `outputFormat`, `showParameters`, `showArtifacts`, `showEvents`, `nodeFieldSelector`
- **argo_logs**: Get workflow logs
  - Params: `workflowName` (required), `namespace`, `container`, `follow`, `previous`, `since`, `sinceTime`, `tail`, `timestamps`, `grep`, `noColor`

### Argo CD

- **argocd_app**: Multi-operation tool for Argo CD apps
  - Params: `operation` (`list|get|resources|logs|history|status`) plus operation-specific flags (`appName`, `outputFormat`, `selector`, `project`, `cluster`, `namespace`, `repo`, `health`, `sync`, `server`, `grpcWeb`, `plaintext`, `insecure`, `refresh`, `hardRefresh`, `group`, `kind`, `name`, `container`, `follow`, `previous`, `since`, `sinceTime`, `tail`, `timestamps`)

---

## ⚙️ Configuration

Provide env vars via your MCP client config or shell.

- **KUBECONFIG**: Path to kubeconfig (default: `$HOME/.kube/config`)
- **MCP_LOG_LEVEL**: `error|warn|info|debug`
- **MCP_LOG_ENABLE**: `true|1` to enable server file logging (default: disabled)
- **MCP_LOG_FILE**: Path to server log file (default when enabled: `kubeview-mcp.log`)
- **MCP_TIMEOUT**: Global per-tool timeout in ms (applies to all tools)
- CLI timeouts: **MCP_HELM_TIMEOUT**, **MCP_ARGO_TIMEOUT**, **MCP_ARGOCD_TIMEOUT** (ms)
- CLI executable overrides: **MCP_HELM_PATH**, **MCP_ARGO_PATH**, **MCP_ARGOCD_PATH**
- Plugin toggles: **MCP_DISABLE_KUBERNETES_PLUGIN**, **MCP_DISABLE_HELM_PLUGIN**, **MCP_DISABLE_ARGO_PLUGIN**, **MCP_DISABLE_ARGOCD_PLUGIN** (`true|1` to disable)
- Kubernetes options: **MCP_KUBE_CONTEXT**, **MCP_K8S_SKIP_TLS_VERIFY** (`true|1`)

Example (Cursor `mcp.json`):

```json
{
  "mcpServers": {
    "kubeview-mcp": {
      "command": "npx",
      "args": ["-y", "https://github.com/mikhae1/kubeview-mcp"],
      "env": {
        "KUBECONFIG": "$HOME/.kube/config",
        "MCP_LOG_LEVEL": "info",
        "MCP_HELM_TIMEOUT": "45000",
        "MCP_DISABLE_ARGO_PLUGIN": "1"
      }
    }
  }
}
```

---

## 🔒 Sensitive Data Masking

Global masking prevents accidental disclosure of secrets (enabled when any of the flags below are set):

- Enable: `MCP_HIDE_SENSITIVE` or `MCP_HIDE_SENSITIVE_DATA` or `MCP_MASK_SENSITIVE_DATA` → `true|1|yes|on`
- Mask text override: `MCP_SENSITIVE_MASK` (default: `*** FILTERED ***`)

Effects:

- ConfigMaps: values redacted by key/value heuristics; forcing `skipSanitize=true` on `kube_get` will still be overridden by global masking
- Secrets: list/describe returns only key names; values are masked
- Helm: `helm_get` with `what=values` applies masking on returned text

---

## 💡 Examples

```bash
# Cluster diagnostics overview (no resourceType)
npm run command -- kube_list

# Pods in a namespace
npm run command -- kube_list --resourceType=pod --namespace=default

# Describe a deployment with events and diagnostics
npm run command -- kube_get --resourceType=deployment --name=web --namespace=prod

# Metrics summary with diagnostics
npm run command -- kube_metrics --includeSummary=true --diagnostics=true

# Logs from a pod (last 200 lines)
npm run command -- kube_logs --podName=nginx-123 --namespace=default --tailLines=200

# Stream logs across pods by owner with events (10 minutes back)
npm run command -- kube_log --namespace=prod --ownerKind=Deployment --ownerName=api --since=10m --includeEvents=true --durationSeconds=20

# Filter by labels and container name, text output
npm run command -- kube_log --namespace=default --labelSelector='app=db,tier=api' --containerRegex='^(main|sidecar)$' --structure=text --durationSeconds=15

# Only errors from JSON logs
npm run command -- kube_log --namespace=prod --labelSelector='app=my-api' --jsonPaths='[{"path":"level","equals":"error"}]' --messageRegex='timeout|exception' --since=30m --durationSeconds=20

# Only events (text mode)
npm run command -- kube_log --namespace=default --includeEvents=true --structure=text --messageRegex='^\\[event\\]' --durationSeconds=10

# Port-forward service 80 -> local 8080 for 90s
npm run command -- kube_port --serviceName=my-svc --namespace=default --remotePort=80 --localPort=8080 --timeoutSeconds=90

# Network diagnostics from a pod
npm run command -- kube_net --sourcePod=api-0 --namespace=prod --targetService=db --runServiceConnectivityTest=true

# Helm release values (masked)
npm run command -- helm_get --what=values --releaseName=my-release --namespace=default --allValues=true

# Argo CD app resources
npm run command -- argocd_app --operation=resources --appName=my-app --outputFormat=json
```

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-awesome-feature`
3. Commit: `git commit -m "feat: add my awesome feature"`
4. Push: `git push origin feat/my-awesome-feature`
5. Open a Pull Request

Tip: run `npm run lint` and `npm run test` locally before submitting.

---

## 📄 License

MIT – see `LICENSE`.

---

## 🙏 Acknowledgments

- Model Context Protocol SDK
- Kubernetes JavaScript Client
- Winston
- TypeScript

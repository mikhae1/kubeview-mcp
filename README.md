# KubeView MCP – Kubernetes Model Context Protocol Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue)](https://www.typescriptlang.org/)

KubeView MCP is a read-only Model Context Protocol (MCP) server that exposes AI-friendly tools for safe Kubernetes, Helm, Argo Workflows, and Argo CD introspection. It pairs with Cursor IDE, Claude Code/Desktop, and other MCP clients to let you inspect, diagnose, and debug clusters via natural language and without any write operations.

---

## ✨ Features

- **Kubernetes tools (read-only)**: list, get/describe, metrics, single-pod logs, multi-pod streaming logs with event merge, exec (read-only), port-forward, and in-cluster network diagnostics
- **Cluster overview**: one-shot, LLM-optimized diagnostics across nodes, workloads, storage, events, and security posture
- **Helm integration**: list releases; fetch values, manifest, notes, hooks, history, status, and parsed resources
- **Argo Workflows**: list/get workflows and fetch workflow logs
- **Argo CD**: list/get app details, resources, history, logs, and status via a single multi-operation tool
- **Sensitive data masking**: global redaction for secrets/tokens in ConfigMaps, Secrets, and Helm values
- **Zero write access**: designed to be safe in production from day one
- **Code-mode**: reasoning through code in a sandboxed environment with MCP tools access 🔥

---

## 🚀 Quick Start

Add to your MCP client config:

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

To use code-mode only (heavy context tasks, like logs parsing, multiple pod diagnostics, network diagnostics, etc.):

```json
{
  "mcpServers": {
    "kubeview-mcp": {
      "command": "npx",
      "args": ["-y", "https://github.com/mikhae1/kubeview-mcp"],
      "env": {
        "KUBECONFIG": "$HOME/.kube/config",
        "MCP_MODE": "code"
      }
    }
  }
}
```

### Prerequisites

- Node.js ≥ 18
- Access to a Kubernetes cluster (kubeconfig)
- Optional CLIs on PATH if you want to use those plugins: `helm`, `argo`, `argocd`

### Local servrer setup

#### npx

```bash
npx -y https://github.com/mikhae1/kubeview-mcp
```

#### git

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

# Launch the code-mode runtime (see section below)
npm run code-mode
# or
kubeview-mcp-code-mode
```

## 🧠 Code-Mode Execution

Inspired by [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp), KubeView now ships with a code-mode runtime that lets agents explore generated TypeScript API, search tools progressively, and run sandboxed workflows without piping giant schemas through the model context.

### What it provides

- **MCP bridge layer** – connects to MCP server tools.
- **Schema→TypeScript codegen** – converts every tool schema into `generated/servers/<server>/<tool>.ts` wrappers plus runtime helpers (`generated/runtime/*`), so agents can `import` strongly-typed helpers instead of copying JSON schemas.
- **Tool search utilities** – manifests + runtime helpers (`toolSearch.ts`, `search_tools` MCP tool) let agents progressively discover servers and tools without loading everything upfront.
- **Sandboxed execution** – `isolated-vm` powers a locked-down Node.js-like environment with controlled `console`, MCP tool access, and a scoped filesystem bridge.
- **Stateful workspace & skills** – the sandbox exposes a safe filesystem rooted at `./workspace`, including a `skills/` folder with a `SKILL.md` convention for reusable snippets.

## 📟 Tool Index (CLI)

To invoke tools with the helper functions, use the `npm run command` script:

```bash
npm run command -- <tool_name> [--param=value ...]
```

### Kubernetes

- **kube_list**: List resources or, when no `resourceType` is provided, return a cluster diagnostics overview
  - Passing `namespace`, `labelSelector`, or `fieldSelector` without `resourceType` defaults to pod listings (so CLI / `run_code` snippets keep working as expected)
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
- **run_code**: Run code in the sandboxed environment
  - Params: `code` (required), `input` (optional)

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
- Mode options: **MCP_MODE** (`code|tools|all`) (default: `all`)
  - `code`: exposes only `run_code` tool
  - `tools`: exposes only Kubernetes/Helm/Argo tools (no `run_code`)
  - `all`: exposes both tools and `run_code` (default)
- Code-mode config: **KUBE_MCP_CODE_MODE_CONFIG** (default: `kube-mcp.code-mode.json`)

Example `mcp.json`:

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

# Code execution
npm run command -- run_code --code="return await tools.kubernetes.list({ namespace: 'default' });"
```

### How To

#### Exposing only the `run_code` tool

To present a single `run_code` tool to your MCP client (and force all the reasoning through the code), start the server with `MCP_MODE=code`, e.g.:

```bash
MCP_MODE=code npx -y https://github.com/mikhae1/kubeview-mcp
```

#### Exposing only tools (no `run_code`)

To expose only Kubernetes/Helm/Argo tools without `run_code`, use `MCP_MODE=tools`:

```bash
MCP_MODE=tools npx -y https://github.com/mikhae1/kubeview-mcp
```

#### Exposing both tools and `run_code` (default)

By default (or with `MCP_MODE=all`), both tools and `run_code` are exposed:

```bash
# Default behavior
npx -y https://github.com/mikhae1/kubeview-mcp

# Explicitly set all mode
MCP_MODE=all npx -y https://github.com/mikhae1/kubeview-mcp
```

In this mode the server registers only the `run_code` tool, which accepts the following parameters:

```ts
{
  code: string;          // required – snippet you plan to execute in the sandbox
  input?: string;        // optional stdin payload
}
```

Calling `run_code` doesn’t execute anything inside the MCP process; instead it returns the generated filesystem tree (`generated/servers/...`, `generated/runtime/...`) plus instructions for launching `kubeview-mcp-code-mode` / `npm run code-mode`, keeping the MCP handshake tiny while the real work happens inside the sandbox.

#### Manually setting up the sandbox properties

1. Copy the sample config and edit it for your environment:
   ```bash
   cp kube-mcp.code-mode.example.json kube-mcp.code-mode.json
   ```
2. Build the project so the CLI wrapper can import the compiled entrypoint:
   ```bash
   npm run build
   ```
3. Edit `workspace/main.ts` (auto-created on first run) to import generated helpers:

4. Run the runtime (or use the new `kubeview-mcp-code-mode` binary):
   ```bash
   npm run code-mode
   # or
   kubeview-mcp-code-mode
   ```

Generated modules call back into real MCP servers via the sandbox bridge, so large responses stay in the execution environment and only summaries hit the model context.

The runtime writes everything under `generated/` and `workspace/`. Clean them up at any time to force regeneration.

---

## 📄 License

MIT – see `LICENSE`.

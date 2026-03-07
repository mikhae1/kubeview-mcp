# KubeView MCP – Kubernetes Model Context Protocol Server

[![npm version](https://img.shields.io/npm/v/kubeview-mcp)](https://www.npmjs.com/package/kubeview-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue)](https://www.typescriptlang.org/)

**KubeView** is a read-only [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that lets AI agents (Cursor, Claude Code, Codex CLI, Gemini CLI, etc.) safely inspect, diagnose, and debug Kubernetes clusters. It covers Kubernetes core, Helm, Argo Workflows, and Argo CD.

> Read more: [Evicting MCP tool calls from your Kubernetes cluster](https://dev.to/mikhae1/evicting-mcp-tool-calls-from-your-kubernetes-cluster-428k)

---

## ✨ Features

- **🧠 Code Mode** – Sandboxed TypeScript runtime for complex reasoning and multi-step workflows.
- **🛡️ Read-Only & Safe** – Zero write access; sensitive data masking for production clusters.
- **☸️ Kubernetes** – List/get resources, fetch metrics, stream logs and events, exec into containers, diagnose network issues.
- **📦 Helm (API-first)** – Inspect releases, values, manifests, and history via the Kubernetes API with CLI fallback.
- **🐙 Argo Ecosystem** – Manage Argo Workflows and Argo CD via the Kubernetes API or CLI.

---

## 🚀 Quick Start

### Prerequisites

- Node.js ≥ 18
- Access to a Kubernetes cluster
- Optional CLIs in `$PATH`: `helm` (fallback only), `argo`, `argocd`

### Installation

```bash
# Run the server directly
npx -y kubeview-mcp

# Add to Claude Code
claude mcp add kubernetes -- npx kubeview-mcp
```

### MCP Client Configuration

Add to your `mcpServers` config (Cursor, Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "kubeview": {
      "command": "npx",
      "args": ["-y", "kubeview-mcp"]
    }
  }
}
```

### Environment Variables

| Variable             | Description                                  | Default          |
| -------------------- | -------------------------------------------- | ---------------- |
| `KUBECONFIG`         | Path to kubeconfig file                      | `~/.kube/config` |
| `MCP_MODE`           | Server mode: `all`, `code`, or `tools`       | `all`            |
| `MCP_LOG_LEVEL`      | Log level: `error`, `warn`, `info`, `debug`  | `info`           |
| `MCP_HIDE_SENSITIVE` | Mask sensitive data globally                 | `false`          |

---

## 🛠️ Tools

### Kubernetes

| Tool           | Description                                              |
| -------------- | -------------------------------------------------------- |
| `kube_list`    | List resources or get cluster diagnostics                |
| `kube_get`     | Describe a specific resource (all K8s types supported)   |
| `kube_metrics` | Fetch CPU/memory metrics for nodes and pods              |
| `kube_logs`    | Fetch or stream container logs                           |
| `kube_exec`    | Execute commands inside containers                       |
| `kube_port`    | Port-forward to pods or services                         |
| `kube_net`     | Run in-cluster network diagnostics                       |

### Helm

| Tool        | Description                                                       |
| ----------- | ----------------------------------------------------------------- |
| `helm_list` | List Helm releases (Kubernetes API first, CLI fallback)           |
| `helm_get`  | Fetch release values, manifests, notes, hooks, status, history    |

**Helm execution strategy:** Tools read Helm metadata directly from Kubernetes storage (Secrets / ConfigMaps) by default — no `helm` binary needed for standard read-only use. CLI fallback is used for non-JSON formatting or non-Kubernetes storage backends (e.g. SQL).

### Argo

| Tool          | Description                              |
| ------------- | ---------------------------------------- |
| `argo_list`   | List Argo Workflows                      |
| `argo_get`    | Inspect a specific Argo Workflow         |
| `argocd_app`  | Inspect Argo CD applications             |

### Utilities

| Tool        | Description                                                    |
| ----------- | -------------------------------------------------------------- |
| `run_code`  | Execute sandboxed TypeScript for complex tasks                 |
| `plan_step` | Persist step-by-step planning state across long investigations |

**Why `plan_step`?** It keeps the chat context clean by storing progress externally, gives agents a structured state machine (plan → execute → verify → branch), and encourages the think-then-act rhythm that produces better results on complex workflows.

---

## 🧠 Code Mode

Inspired by [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp), KubeView ships a sandboxed code runtime for agents to explore the API and run complex workflows.

- **MCP Bridge** – All registered MCP tools are callable from within `run_code`.
- **Dynamic TypeScript Definitions** – Tool schemas are auto-converted to a typed `global.d.ts`, preventing hallucinated parameters.
- **Tool Discovery** – `tools.search()` and `tools.list()` let agents find capabilities at runtime without loading the full schema.
- **Sandboxed Execution** – Locked-down Node.js `vm` environment with access only to `console` and the `tools` global.

Enable code-only mode:

```json
"env": { "MCP_MODE": "code" }
```

### Built-in `code-mode` Prompt

The server includes a **`code-mode`** MCP prompt that injects full TypeScript API docs and examples into the agent context. In Cursor, type `/kubeview/code-mode` in the prompt bar to activate it.

---

## 💻 Local Development

```bash
# Clone and install
git clone https://github.com/mikhae1/kubeview-mcp.git
cd kubeview-mcp
npm install

# Build and run
npm run build
npm start

# Test
npm test

# Run a tool directly via CLI
npm run command -- kube_list --namespace=default
```

---

## 📄 License

MIT © [mikhae1](https://github.com/mikhae1/kubeview-mcp)

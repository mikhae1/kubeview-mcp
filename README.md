# KubeView MCP – Kubernetes Model Context Protocol Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue)](https://www.typescriptlang.org/)

**KubeView** is a read-only Model Context Protocol (MCP) server that enables AI agents (like Cursor IDE, Claude Code CLI, Codex CLI, Gemini CLI, etc.) to inspect, diagnose, and debug Kubernetes clusters safely. It provides a comprehensive set of tools for Kubernetes, Helm, Argo Workflows, and Argo CD.
Learn more about the benefits of code mode and implementation in [Evicting MCP tool calls from your Kubernetes cluster](https://dev.to/mikhae1/evicting-mcp-tool-calls-from-your-kubernetes-cluster-428k).

---

## ✨ Features

- **🧠 Code Mode**: Sandboxed TypeScript environment for complex reasoning and multi-step workflows.
- **🛡️ Read-Only & Safe**: Designed for production safety with zero write access and sensitive data masking.
- **☸️ Kubernetes Integration**: List/get resources, fetch metrics, stream logs and events, execute commands, and tools to diagnose network issues.
- **📦 Helm Support**: Inspect releases, values, manifests, and history.
- **🐙 Argo Ecosystem**: Manage Argo Workflows and Argo CD applications using direct Kubernetes API or CLI.

---

## 🚀 Quick Start

### Prerequisites

- Node.js ≥ 18
- Access to a Kubernetes cluster
- Optionally, CLIs installed in current $PATH: `helm`, `argo`, `argocd`

### Installation

```bash
# start the server
npx -y kubeview-mcp

# install as a claude code mcp server
claude mcp add kubernetes -- npx kubeview-mcp
```

### Configuration for MCP Clients

Add to your `mcpServers` configuration (e.g., in Cursor or Claude Desktop):

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

Configure the server using environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `KUBECONFIG` | Path to kubeconfig file | `~/.kube/config` |
| `MCP_MODE` | Server mode: `all`, `code`, or `tools` | `all` |
| `MCP_LOG_LEVEL` | Log level (`error`, `warn`, `info`, `debug`) | `info` |
| `MCP_HIDE_SENSITIVE` | Enable global sensitive data masking | `false` |

---

## 🛠️ Tools Overview

### Kubernetes
- **`kube_list`**: List resources or get cluster diagnostics.
- **`kube_get`**: Describe specific resources (supports all K8s types).
- **`kube_metrics`**: Fetch CPU/memory metrics for nodes and pods.
- **`kube_logs`**: Fetch or stream container logs.
- **`kube_exec`**: Execute commands in containers (read-only recommended).
- **`kube_port`**: Port-forward to pods/services.
- **`kube_net`**: Run in-cluster network diagnostics.

### Helm
- **`helm_list`**: List Helm releases.
- **`helm_get`**: Fetch release values, manifests, and history.

### Argo
- **`argo_list` / `argo_get`**: Manage Argo Workflows.
- **`argocd_app`**: Inspect Argo CD applications and resources.

### Utilities
- **`run_code`**: Execute sandboxed TypeScript code for complex tasks.

---

## 🧠 Code Mode

Inspired by [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp), KubeView ships with a code-mode runtime that allows agents to explore the API, search tools, and execute complex workflows in a sandboxed environment.

### What it provides

- **MCP Bridge Layer**: Seamlessly connects to all registered MCP server tools.
- **Dynamic TypeScript Definitions**: Automatically converts tool schemas into a strongly-typed `global.d.ts` resource, enabling agents to use valid TypeScript patterns and enjoy type safety without hallucinating parameters.
- **Tool Search Utilities**: Runtime helpers like `tools.search()` and `tools.list()` allow agents to progressively discover capabilities without needing to load the entire schema context upfront.
- **Sandboxed Execution**: A locked-down Node.js environment (via `vm`) with controlled access to the `console` and the `tools` global object, ensuring safe execution of agent-generated code.

### Usage

For complex tasks requiring logic, loops, or data processing, use **Code Mode**:

```json
"env": { "MCP_MODE": "code" }
```

### 💡 Pro Tip: Code Mode Prompt

The server includes a built-in prompt named **`code-mode`** that injects the full TypeScript API documentation, tool overview, and examples into the context.

**In Cursor IDE**:
Simply type `/kubeview/code-mode` in the prompt (or select it from the `/` prompt menu). This gives the AI the exact context it needs to write correct `run_code` scripts immediately.

---

## 💻 Local Development

1. **Clone & Install**:
   ```bash
   git clone https://github.com/mikhae1/kubeview-mcp.git
   cd kubeview-mcp
   npm install
   ```

2. **Build & Run**:
   ```bash
   npm run build
   npm start
   ```

3. **Test**:
   ```bash
   npm test
   ```

### CLI Usage

You can test tools directly via the CLI:

```bash
npm run command -- kube_list --namespace=default
```

---

## 📄 License

MIT © [mikhae1](https://github.com/mikhae1/kubeview-mcp)

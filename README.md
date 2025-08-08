# KubeView MCP – Kubernetes Model Context Protocol Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue)](https://www.typescriptlang.org/)

**KubeView MCP** is a **read-only Model Context Protocol (MCP) server** that exposes rich, AI-ready operations for Kubernetes clusters. Paired with tools like **Cursor IDE** or Chat-based assistants, it lets you inspect, analyse and debug your cluster through natural-language commands while guaranteeing zero write access.

---

## Table of Contents

- [KubeView MCP – Kubernetes Model Context Protocol Server](#kubeview-mcp--kubernetes-model-context-protocol-server)
  - [Table of Contents](#table-of-contents)
  - [✨ Features](#-features)
  - [🚀 Quick Start](#-quick-start)
    - [Zero-install via npx](#zero-install-via-npx)
    - [Prerequisites](#prerequisites)
    - [Installation](#installation)
    - [Build \& Run](#build--run)
  - [📟 CLI Reference](#-cli-reference)
    - [Resource Management](#resource-management)
    - [Storage \& Persistence](#storage--persistence)
    - [Monitoring \& Observability](#monitoring--observability)
    - [Generic Resource Tool](#generic-resource-tool)
  - [⚙️ Configuration](#️-configuration)
    - [Environment variables (implemented)](#environment-variables-implemented)
    - [Kubernetes authentication modes](#kubernetes-authentication-modes)
    - [Example: configuring via shell](#example-configuring-via-shell)
  - [🪄 Helm Integration](#-helm-integration)
    - [Core Operations](#core-operations)
    - [Configuration \& Values](#configuration--values)
    - [Helm ↔ Kubernetes Bridge](#helm--kubernetes-bridge)
      - [Example – list all Helm releases](#example--list-all-helm-releases)
  - [Argo Integration](#argo-integration)
  - [ArgoCD Integration](#argocd-integration)
  - [💡 Usage Examples](#-usage-examples)
  - [🔒 Sensitive Data Masking](#-sensitive-data-masking)
  - [🤝 Contributing](#-contributing)
  - [📄 License](#-license)
  - [🙏 Acknowledgments](#-acknowledgments)

---

## ✨ Features

- **Kubernetes Resources** – Read-only access to Pods, Services, Deployments, Namespaces, ConfigMaps, Secrets, PVCs and more.
- **Helm Support** – Deep inspection of Helm releases including manifests, values, hooks and history.
- **Argo & ArgoCD Integration** – Seamlessly interact with Argo Workflows and ArgoCD applications.
- **Advanced Storage Analysis** – Diagnose PV/PVC issues with smart binding & reclaim-policy checks.
- **Robust Monitoring** – CPU / memory metrics out-of-the-box, optionally enriched with Prometheus data.
- **Log Streaming** – Tail or grep container logs directly from your AI assistant.
- **Cluster Events** – Filter and analyse live Kubernetes events.

---

## 🚀 Quick Start

### Zero-install via npx

```bash
npx https://github.com/mikhae1/kubeview-mcp
```

_For Cursor IDE or any other MCP-compatible client, add the following entry to your_ `mcp.json` _file (usually located in `~/.cursor/mcp.json`):_

```json
{
  "mcpServers": {
    "kubeview-mcp": {
      "command": "npx",
      "args": ["https://github.com/mikhae1/kubeview-mcp"],
      "env": {
        "KUBECONFIG": "$HOME/.kube/config"
      }
    }
  }
}
```

### Prerequisites

- **Node.js ≥ 18**
- **npm** (or **yarn/pnpm**) for dependency management
- Access to a **Kubernetes cluster** with a valid *kubeconfig*
- **Cursor IDE** (or another MCP-compatible client) for interactive use

### Installation

```bash
# Clone the repository
$ git clone https://github.com/mikhae1/kubeview-mcp.git
$ cd kubeview-mcp

# Install dependencies
$ npm install

# Generate local configuration for Cursor IDE & Claude
$ npm run setup
```

### Build & Run

```bash
# Compile TypeScript → JavaScript
$ npm run build

# Start the MCP server
$ npm start
```

The server will automatically locate your *kubeconfig* and use the current k8s context for all operations.

---

## 📟 CLI Reference

All commands are invoked through the project-local helper:

```bash
npm run command -- <tool_name> [tool options]
```

### Resource Management

| Tool             | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `get_pods`       | List / filter pods with detailed phase & container state |
| `get_services`   | Discover services and their exposed endpoints            |
| `get_deployments`| Inspect deployment rollout status & spec                |
| `get_ingresses`  | View ingresses and their routing rules                    |
| `get_configmaps` | View ConfigMaps (with sensitive data automatically redacted) |
| `get_secrets`    | Read-only secret inspector with built-in sanitisation    |
| `get_namespaces` | Enumerate namespaces in the cluster                      |

### Storage & Persistence

| Tool                           | Description                                                  |
| ------------------------------ | ------------------------------------------------------------ |
| `get_persistent_volumes`       | Analyse PVs and detect reclaim / capacity issues            |
| `get_persistent_volume_claims` | Inspect PVC binding, access modes & storage-class details   |

### Monitoring & Observability

| Tool            | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| `get_metrics`   | Cluster-wide CPU & memory metrics (Prometheus optional)      |
| `get_pod_metrics` | Fine-grained metrics for individual pods                     |
| `get_events`    | Stream or filter recent cluster events                       |
| `pod_logs`      | Tail container logs with regex / since-time filters          |

### Generic Resource Tool

| Tool           | Description                               |
| -------------- | ----------------------------------------- |
| `get_resource` | Inspect any Kubernetes resource by GVR    |

---

## ⚙️ Configuration

KubeView MCP is configured primarily via environment variables provided by your MCP client (for example in `mcp.json`) or your shell. Below are all supported options discovered in the codebase today, plus a few proposed options that would be useful to add.

### Environment variables (implemented)

- **KUBECONFIG**: Path to your kubeconfig. Supports multiple paths separated by `:`; the first existing file is used. Defaults to `$HOME/.kube/config` if unset.
  - Example in `mcp.json`:
    ```json
    {
      "mcpServers": {
        "kubeview-mcp": {
          "command": "npx",
          "args": ["https://github.com/mikhae1/kubeview-mcp"],
          "env": {
            "KUBECONFIG": "$HOME/.kube/config"
          }
        }
      }
    }
    ```

- **LOG_LEVEL**: Controls logging verbosity for the server and plugins. If unset, defaults to `info` for the server and disables extra plugin logging.
  - Valid values: `error`, `warn`, `info`, `debug`.
  - When set to `debug`, extra diagnostic output is emitted by certain CLI wrappers.
  - The server writes logs to stderr/console and to `kubeview-mcp.log` in the working directory.

- **TIMEOUT**: Global timeout in milliseconds
- **HELM_TIMEOUT**: Timeout in milliseconds for `helm` CLI invocations. Default: `30000`.
- **ARGO_TIMEOUT**: Timeout in milliseconds for `argo` CLI invocations. Default: `30000`.
- **ARGOCD_TIMEOUT**: Timeout in milliseconds for `argocd` CLI invocations. Default: `30000`.

- **DISABLE_KUBERNETES_PLUGIN**: Disable the Kubernetes tools plugin entirely. Values: `"true"` or `"1"` to disable.
- **DISABLE_HELM_PLUGIN**: Disable the Helm tools plugin. Values: `"true"` or `"1"` to disable.
- **DISABLE_ARGO_PLUGIN**: Disable the Argo tools plugin. Values: `"true"` or `"1"` to disable.
- **DISABLE_ARGOCD_PLUGIN**: Disable the ArgoCD tools plugin. Values: `"true"` or `"1"` to disable.

Notes:
- Helm/Argo/ArgoCD tools depend on their respective CLIs being available on your `PATH`. The project will also check common install paths (e.g., `/opt/homebrew/bin/helm`) if not found on `PATH` and provide a helpful error if missing.

### Kubernetes authentication modes

The underlying client supports multiple auth modes, though by default the MCP server uses your kubeconfig:

- **Kubeconfig (default)**: Uses `KUBECONFIG` or `$HOME/.kube/config`, and the current context in that file.
- **In-cluster**: Supported by the core client. Not wired to an env var yet in the server entrypoint.
- **Bearer token**: Supported by the core client (`apiServerUrl`, `bearerToken`, optional `skipTlsVerify`). Not wired to env vars yet in the server entrypoint.
- **KUBE_CONTEXT**: Force a specific kubeconfig context (instead of the current context) for Kubernetes tools.
- **K8S_SKIP_TLS_VERIFY**: `true`/`1` to skip TLS verification when using token-based auth.
- **HELM_PATH / ARGO_PATH / ARGOCD_PATH / KUBECTL_PATH**: Override autodetected CLI executable paths for Helm, Argo, ArgoCD, and kubectl.

If you embed KubeView MCP as a library, you can construct `KubernetesClient` with these options directly.

### Example: configuring via shell

```bash
export KUBECONFIG=$HOME/.kube/config
export LOG_LEVEL=info
export HELM_TIMEOUT=45000
export ARGO_TIMEOUT=45000
export ARGOCD_TIMEOUT=60000

# Optionally disable plugins you don't use
export DISABLE_ARGO_PLUGIN=1
export DISABLE_ARGOCD_PLUGIN=true
```

---

## 🪄 Helm Integration

KubeView MCP ships with a dedicated **HelmToolsPlugin** bringing first-class Helm introspection.

### Core Operations

| Tool         | Description                                                |
| ------------ | ---------------------------------------------------------- |
| `helm_list`  | List releases across all namespaces with status & revision |
| `helm_status`| Full release status (history, manifest, values)            |
| `helm_history`| Complete upgrade / rollback history                        |

### Configuration & Values

| Tool               | Description                                   |
| ------------------ | --------------------------------------------- |
| `helm_get_values`  | Rendered values.yaml for a release            |
| `helm_get_manifest`| Complete aggregated Kubernetes manifest       |
| `helm_get_notes`   | Chart installation notes & post-deploy hints  |
| `helm_get_hooks`   | Pre / post hooks configured by the chart      |

### Helm ↔ Kubernetes Bridge

| Tool                       | Description                                                         |
| -------------------------- | ------------------------------------------------------------------- |
| `helm_get_resources`       | Discover / categorise all resources created by a release            |
| `helm_list_with_resources` | Enhanced `helm_list` that bundles the above analysis for each release |

#### Example – list all Helm releases

```bash
npm run command -- helm_list
```

---
##  Argo Integration

The **ArgoToolsPlugin** provides tools for interacting with Argo Workflows.

| Tool | Description |
| --- | --- |
| `argo_get`  | Get details about a workflow
| `argo_list` | List all Argo Workflows |
| `argo_logs` | Get logs from an Argo Workflow |
| `argo_cron_list` | List all Argo Cron Workflows |

## ArgoCD Integration

The **ArgoCDToolsPlugin** provides tools for interacting with ArgoCD.

| Tool | Description |
| --- | --- |
| `argocd_app_list` | List all ArgoCD applications |
| `argocd_app_get` | Get a specific ArgoCD application |
| `argocd_app_history` | Get the history of an ArgoCD application |
| `argocd_app_logs` | Get the logs of an ArgoCD application |
| `argocd_app_resources` | Get the resources of an ArgoCD application |

---

## 💡 Usage Examples

Ask your assistant:

> *“Show me the details of the **nginx** deployment in the **web** namespace.”*

KubeView MCP will execute `get_resource` under the hood and return a structured JSON response that your assistant converts into a readable answer.

> *“List all pods in the **default** namespace and show their CPU and memory usage.”*

This will trigger the `get_pods` and `get_pod_metrics` tools, combining their output to provide a comprehensive view of your pods' resource consumption.

---

## 🔒 Sensitive Data Masking

KubeView MCP supports a global masking mode to prevent accidental disclosure of secrets in outputs (enabled by default).

- Enable global masking: set one of the following to true/1/yes/on
  - `MCP_HIDE_SENSITIVE`
  - `HIDE_SENSITIVE_DATA`
  - `MASK_SENSITIVE_DATA`
- Customize the mask text: `SENSITIVE_MASK` (default: `*** FILTERED ***`)

Effects when masking is enabled:
- ConfigMaps: Values are sanitized by pattern; enabling global masking ensures redaction even if a caller passes `skipSanitize=true`.
- Secrets: When listing secrets, all `data`/`stringData` values are fully masked; when describing a single secret we only return key names (no values).
- Helm values: `helm_get_values` and `helm_get` with `what=values` redact sensitive keys/tokens in the returned text.

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-awesome-feature`
3. Commit your changes: `git commit -m "feat: add my awesome feature"`
4. Push to GitHub: `git push origin feat/my-awesome-feature`
5. Open a Pull Request – thank you!

> 💡 Run `npm run lint` and `npm run test` before opening a PR.

---

## 📄 License

This project is released under the MIT License – see [LICENSE](LICENSE).

---

## 🙏 Acknowledgments

- [Model Context Protocol SDK](https://github.com/modelcontextprotocol/sdk)
- [Kubernetes JavaScript Client](https://github.com/kubernetes-client/javascript)
- [Winston](https://github.com/winstonjs/winston)
- [TypeScript](https://www.typescriptlang.org/)

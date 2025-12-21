# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.5.0] - 2025-12-21

### Added
- **Add direct Kubernetes API support for Argo/ArgoCD tools**

### Changed
- **Refactor Argo tools to use direct Kubernetes API support and enhance error handling**
- **Refactor ArgoCD tools to remove ArgoCDAppLogsTool and enhance ArgoCDAppTool**
- **Release v1.5.0**
- **Update README.md to enhance project description and add link to the article**


## [1.4.7] - 2025-12-03

### Changed
- **Update README.md to enhance project description and add link to the article**

## [1.4.6] - 2025-11-30

### Changed
- **Release v1.4.6**

## [1.4.5] - 2025-11-30

### Changed
- Version bump to 1.4.5

## [1.4.4] - 2025-11-30

### Changed
- **Update  build-release and update-version scripts for automated version management**

## [1.4.0] - 2025-11-29

### Added
- **RunCode Tool Exposure**: Exposed `run_code` tool by default in standard mode alongside other tools.
- **Code-Mode Prompt**: Added `code-mode` prompt for injecting the full TypeScript API documentation, tool overview, and examples into the context.

### Changed
- **Documentation**: Improved README.md to be more professional, valid, and concise.
- **Name Change**: Changed name from `kubeview-mcp` to `kubeview` to align with the new MCP server name.
- **Dependencies**: Updated deprecated dependencies.

### Fixed
- **Filter Logic**: `kube_list` now honors namespace/selector filters even when `resourceType` is omitted.
- **Runtime Errors**: Fixed `ERR_MODULE_NOT_FOUND` for `typescript` package.
- **Build Issues**: Resolved TypeScript compilation errors in `src/index.ts`.
- **Logging**: Fixed "Required parameter name was null or undefined" error in `kube_log` and `kube_logs` tools.

## [1.3.0] - 2025-11-27

### Added
- **Code-Mode Execution**: Added sandboxed TypeScript code execution runtime following Anthropic's code execution with MCP approach
- **RunCodeTool**: Implemented `run_code` tool for executing TypeScript code in a sandboxed Node.js VM environment
- **Code-Mode CLI**: Added `kubeview-mcp-code-mode` binary and `npm run code-mode` script for standalone code execution
- **TypeScript Transpilation**: Integrated TypeScript compiler for runtime transpilation of agent code (ES2022 target)
- **Global Type Definitions**: Added `/sys/global.d.ts` resource providing TypeScript type definitions for all available tools
- **Tool Executor**: Implemented tool executor allowing sandboxed code to call MCP tools internally
- **Helper Functions**: Added namespaced `tools.*` helpers for discovery (`tools.list()`, `tools.search()`, `tools.help()`, `tools.call()`) and execution
- **Code-Mode Configuration**: Added `CodeModeConfig` with configurable sandbox limits (memory, timeout) and workspace settings
- **Mode Support**: Added `MCP_MODE` environment variable with three modes:
  - `code`: exposes only `run_code` tool
  - `tools`: exposes only Kubernetes/Helm/Argo tools (no `run_code`)
  - `all`: exposes both tools and `run_code` (default)
  - Replaced `NODE_MODE=code` with `MCP_MODE=code|tools|all`

### Changed
- **Plugin Architecture**: Removed version property from various tools plugins and MCPServer for simplified plugin management
- **Dependencies**: Added TypeScript as a runtime dependency (previously dev-only) for code-mode transpilation
- **Tool Manifest**: Enhanced tool manifest system to support dynamic tool generation for agent code execution

### Fixed
- **Type Definitions**: Fixed TypeScript typing for generated global DTS resources and resource registration

## [1.2.0] - 2025-08-19

### Changed
- **Changed variable naming**
- **Diabled logging by default**

## [1.1.0] - 2025-08-09

### Added
- **CLI Support Detection**: Added optional CLI support detection and improve plugin loading.
- **Multi-pod Log Streaming**: Added `KubeLogTool` for multi-pod log streaming with event merging.
- **Storage Diagnostics**: Enhanced `KubernetesClient` and `KubeListTool` with storage diagnostics.
- **RBAC Support**: Enhanced `KubernetesClient` and tools with RBAC support.
- **Network Diagnostics**: Added `KubeNetTool` for network diagnostics.
- **Sensitive Data Masking**: Implement sensitive data masking across outputs.
- **Exec Tool**: Added `ExecTool` for executing commands in Kubernetes pods.
- **Port Forward Tool**: Added `PortForwardTool` to Kubernetes tools.
- **Prometheus Target Discovery**: Enhanced Prometheus target discovery and metrics handling.
- **onNewConversation Hook**: Implemented `onNewConversation` hook for Kubernetes tools.

### Changed
- **URL and Timeout Parsing**: Updated `kubeview-mcp` URL and refactor timeout parsing.
- **Resource Tool Renaming**: Renamed `GetResourceTool` and `KubeListTool` for clarity.
- **Resource Tool Enhancement**: Enhanced `GetResourceTool` for broader resource support and improved diagnostics.
- **Helm Tool Streamlining**: Streamlined Helm tools and update CLI commands.
- **BaseToolsPlugin**: Refactored to introduce `BaseToolsPlugin` to reduce duplication across tool plugins.

### Fixed
- **Metric Retrieval**: Enhanced metric retrieval with improved proxy handling and fallback mechanisms.
- **API Call Signatures**: Corrected `CustomObjectsApi` call signatures and return `response.body` from raw metrics requests; improve kubelet summary fallback logging.
- **ESLint Rules**: Satisfied ESLint rules in `PortForwardTool` (no-empty/no-unused-vars).
- **Global Timeout Handling**: Implemented global timeout handling for tool commands.
- **Delay Handling**: Optimized delay handling in `RetryStrategy` for test environments.

## [1.0.0] - 2024-12-19

### Added
- **Initial stable release** 🎉
- Complete **Kubernetes MCP Server** with read-only cluster introspection
- **Comprehensive tool coverage**:
  - Resource management (Pods, Services, Deployments, Ingresses, ConfigMaps, Secrets, Namespaces)
  - Storage & persistence (PVs, PVCs with analysis)
  - Monitoring & observability (Metrics, Events, Logs)
  - Generic resource inspector
- **Helm integration** with full lifecycle support:
  - Release listing, status, history
  - Values, manifests, notes, hooks inspection
  - Kubernetes resource mapping
- **Argo Workflows integration**:
  - Workflow listing and inspection
  - Log streaming
  - Cron workflow support
- **ArgoCD integration**:
  - Application management
  - History and resource tracking
  - Log access
- **Production-ready features**:
  - Robust error handling with circuit breakers
  - Connection pooling and retry strategies
  - Comprehensive test suite (261 tests)
  - TypeScript strict mode
  - ESLint + Prettier formatting
  - Husky git hooks with lint-staged
- **Release automation**:
  - Added `npm run release` script for streamlined releases
  - Pre-release validation (git status, quality checks)
  - Automatic version tagging

### Technical Details
- **Node.js ≥ 18** requirement
- **ESNext modules** with TypeScript 5.8+
- **Model Context Protocol SDK v1.17+**
- **Kubernetes JavaScript client v1.3+**
- Full **CI/CD pipeline** with automated quality gates

### Documentation
- Comprehensive README with usage examples
- CLI reference for all 30+ tools
- Integration guides for Cursor IDE
- API documentation for developers

[1.0.0]: https://github.com/mikhae1/kubeview-mcp/releases/tag/v1.0.0

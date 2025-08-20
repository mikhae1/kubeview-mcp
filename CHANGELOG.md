# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

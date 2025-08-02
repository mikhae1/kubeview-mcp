# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

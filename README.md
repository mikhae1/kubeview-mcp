# Kubernetes MCP Server

A Model Context Protocol (MCP) server that provides intelligent debugging and analysis capabilities for Kubernetes clusters, designed for integration with Cursor IDE.

## Features

### Implemented Features ✅

- **MCP Server Foundation**
  - Core MCP server implementation with stdio transport
  - JSON-RPC 2.0 message handling
  - Tool registration and execution system
  - Resource management
  - Plugin architecture for extensibility
  - Winston-based logging system
  - Graceful shutdown handling

- **Kubernetes Client Module**
  - Complete authentication support (kubeconfig, in-cluster, bearer token)
  - Context management and switching
  - Resource operations for pods, services, deployments, configmaps, secrets
  - Custom Resource Definition (CRD) support
  - Comprehensive error handling and logging

- **Connection Pooling & Multi-Cluster Support**
  - High-performance connection pooling for API clients
  - Connection reuse and lifecycle management
  - Multi-cluster connection management
  - Load balancing strategies (round-robin, least-connections, weighted, random)
  - Automatic health monitoring and failover
  - Connection warm-up and idle management
  - Real-time pool statistics and monitoring

### Planned Features 🚧

- Core Kubernetes tools (list pods, services, deployments)
- Log streaming and filtering
- Intelligent analysis with LLM integration
- Pattern recognition for common issues
- Team collaboration features

## Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

## Usage

### Basic Usage

```bash
# Start the MCP server
npm start

# Run in development mode with hot reload
npm run dev
```

### Cursor IDE Integration

To use this MCP server with Cursor IDE:

```bash
# Quick setup (recommended)
npm run setup:cursor

npm run build
```

For detailed setup instructions, see:
- [Cursor Setup Guide](docs/CURSOR_SETUP.md) - Complete setup and configuration guide
- [Quick Reference](docs/CURSOR_QUICK_REFERENCE.md) - Common commands and usage patterns

### Using Connection Pooling

```typescript
import { KubernetesClient } from 'kube-mcp';

// Enable connection pooling for better performance
const client = new KubernetesClient({
  enableConnectionPooling: true,
  connectionPoolConfig: {
    minConnections: 2,
    maxConnections: 10,
    healthCheckInterval: 60000
  }
});

// Use the client normally - connections are pooled automatically
const pods = await client.resources.pod.list({ namespace: 'default' });
```

### Multi-Cluster Management

```typescript
import { ConnectionManager, LoadBalancingStrategy } from 'kube-mcp';

const manager = new ConnectionManager({
  loadBalancingStrategy: LoadBalancingStrategy.ROUND_ROBIN,
  enableFailover: true
});

// Add multiple clusters
await manager.addCluster({
  name: 'production',
  kubeConfigFactory: () => loadKubeConfig('prod')
});

await manager.addCluster({
  name: 'staging',
  kubeConfigFactory: () => loadKubeConfig('staging')
});

// Connections are automatically load balanced
const { cluster, connection } = await manager.acquire();
```

For detailed connection pooling documentation, see [docs/ConnectionPooling.md](docs/ConnectionPooling.md).

## Architecture

### Core Components

1. **MCPServer** (`src/server/MCPServer.ts`)
   - Main server class implementing the MCP protocol
   - Handles stdio communication with Cursor
   - Manages tool and resource registration
   - Provides plugin system for extensibility

2. **KubernetesClient** (`src/kubernetes/KubernetesClient.ts`)
   - High-level interface for Kubernetes API interactions
   - Supports multiple authentication methods
   - Optional connection pooling for performance
   - Context management and switching

3. **Connection Pooling** (`src/kubernetes/ConnectionPool.ts`)
   - Manages pools of API client connections
   - Health monitoring and automatic recovery
   - Configurable pool sizes and timeouts
   - Event-based monitoring and statistics

4. **Plugin System**
   - Allows extending server functionality
   - Example: `src/plugins/SamplePlugin.ts`
   - Plugins can register tools, resources, and handlers

5. **Testing**
   - Comprehensive unit tests for all components
   - Integration tests for stdio communication
   - JSON-RPC 2.0 protocol compliance tests
   - Connection pooling and multi-cluster tests

## Development

### Prerequisites

- Node.js >= 18.0.0
- TypeScript
- npm or yarn

### Project Structure

```
kube-mcp/
├── src/
│   ├── index.ts           # Main entry point
│   ├── server/
│   │   └── MCPServer.ts   # Core MCP server implementation
│   └── plugins/
│       └── SamplePlugin.ts # Example plugin
├── tests/
│   └── server/
│       ├── MCPServer.test.ts            # Unit tests
│       └── MCPServer.integration.test.ts # Integration tests
├── package.json
├── tsconfig.json
└── README.md
```

### Available Scripts

- `npm run build` - Build TypeScript to JavaScript
- `npm run dev` - Run in development mode with hot reload
- `npm start` - Start the production server
- `npm test` - Run all tests
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Lint TypeScript files
- `npm run format` - Format code with Prettier

## Plugin Development

To create a new plugin:

1. Implement the `MCPPlugin` interface
2. Register tools and resources in the `initialize` method
3. Optionally implement `shutdown` for cleanup

Example:

```typescript
import { MCPPlugin, MCPServer } from '../server/MCPServer.js';

export class MyPlugin implements MCPPlugin {
  name = 'my-plugin';
  version = '1.0.0';

  async initialize(server: MCPServer): Promise<void> {
    // Register tools and resources
  }

  async shutdown(): Promise<void> {
    // Cleanup
  }
}
```

## License

MIT License - see LICENSE file for details

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Roadmap

See [tasks/tasks.json](tasks/tasks.json) for the detailed development roadmap and task breakdown.

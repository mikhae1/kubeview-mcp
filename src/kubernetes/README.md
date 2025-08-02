# Kubernetes Client Module

This module provides a high-level interface for interacting with Kubernetes clusters using the official Kubernetes client library for Node.js.

## Features

- **Multiple Authentication Methods**:
  - Kubeconfig file (default `~/.kube/config` or custom path)
  - In-cluster configuration (for pods running inside Kubernetes)
  - Bearer token authentication
  - Support for `KUBECONFIG` environment variable with multiple paths

- **Context Management**:
  - List available contexts
  - Switch between contexts
  - Get current context and cluster information

- **Connection Management**:
  - Connection testing
  - Automatic retry logic
  - Connection pooling

- **Resource Operations**:
  - Full CRUD operations for all Kubernetes resources
  - Type-safe interfaces for core resources (Pods, Services, Deployments, etc.)
  - Support for custom resources
  - Watch operations for real-time updates
  - Advanced operations (scaling, rolling updates, log streaming, exec, etc.)

- **Utilities**:
  - Label and field selector builders
  - JSON patch builder
  - Metadata manipulation utilities
  - Container and pod template helpers

## Quick Start

### Installation

```bash
npm install @kubernetes/client-node winston
```

### Basic Usage

```typescript
import { KubernetesClient } from './KubernetesClient';

// Create a client using default kubeconfig
const client = KubernetesClient.fromKubeConfig();

// Test connection
const isConnected = await client.testConnection();
console.log('Connected to Kubernetes:', isConnected);

// Get current context
console.log('Current context:', client.getCurrentContext());

// Access resource operations
const resources = client.resources;
```

### Authentication Examples

#### Using Default Kubeconfig

```typescript
const client = KubernetesClient.fromKubeConfig();
```

#### Using Custom Kubeconfig Path

```typescript
const client = KubernetesClient.fromKubeConfig('/path/to/kubeconfig', 'my-context');
```

#### In-Cluster Authentication

```typescript
const client = KubernetesClient.fromInCluster();
```

#### Bearer Token Authentication

```typescript
const client = KubernetesClient.fromToken(
  'https://kubernetes.example.com:6443',
  'your-bearer-token',
  true // skipTlsVerify (not recommended for production)
);
```

### Resource Operations

#### Working with Pods

```typescript
// Create a pod
const pod = await resources.pod.create({
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: { name: 'my-pod', namespace: 'default' },
  spec: {
    containers: [{
      name: 'nginx',
      image: 'nginx:latest',
      ports: [{ containerPort: 80 }]
    }]
  }
});

// Get pod logs
const logs = await resources.pod.getLogs('my-pod', {
  namespace: 'default',
  tailLines: 100
});

// Execute command in pod
const result = await resources.pod.exec('my-pod', ['ls', '-la'], {
  namespace: 'default'
});

// Stream logs
const stop = resources.pod.streamLogs('my-pod',
  (data) => console.log(data),
  { follow: true }
);
// Call stop() when done
```

#### Working with Deployments

```typescript
// Create deployment
const deployment = await resources.deployment.create({
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name: 'my-app', namespace: 'default' },
  spec: {
    replicas: 3,
    selector: { matchLabels: { app: 'my-app' } },
    template: {
      metadata: { labels: { app: 'my-app' } },
      spec: {
        containers: [{
          name: 'app',
          image: 'myapp:v1',
          ports: [{ containerPort: 8080 }]
        }]
      }
    }
  }
});

// Scale deployment
await resources.deployment.scale('my-app', 5, { namespace: 'default' });

// Update image
await resources.deployment.updateImage('my-app', 'app', 'myapp:v2', {
  namespace: 'default'
});

// Wait for ready
const ready = await resources.deployment.waitForReady('my-app', {
  namespace: 'default',
  timeoutSeconds: 300
});
```

#### Working with Services

```typescript
// Create service
const service = await resources.service.create({
  apiVersion: 'v1',
  kind: 'Service',
  metadata: { name: 'my-service', namespace: 'default' },
  spec: {
    selector: { app: 'my-app' },
    ports: [{ port: 80, targetPort: 8080 }],
    type: 'ClusterIP'
  }
});

// Create service from pod
const svc = await resources.service.createFromPod(pod, 80, {
  serviceName: 'pod-service',
  serviceType: 'NodePort'
});
```

#### Working with ConfigMaps and Secrets

```typescript
// Create ConfigMap
const configMap = await resources.configMap.createFromData('app-config', {
  'config.yaml': 'debug: true\nport: 8080',
  'app.properties': 'server.port=8080'
});

// Create Secret
const secret = await resources.secret.createOpaque('app-secret', {
  username: 'admin',
  password: 'secret123'
});

// Get decoded secret value
const password = await resources.secret.getDecodedValue('app-secret', 'password');
```

#### Working with Custom Resources

```typescript
// Create client for custom resource
const crdClient = resources.custom(
  'example.com',  // group
  'v1',           // version
  'myresources',  // plural
  true            // namespaced
);

// Create custom resource
const cr = await crdClient.create({
  apiVersion: 'example.com/v1',
  kind: 'MyResource',
  metadata: { name: 'my-cr', namespace: 'default' },
  spec: { foo: 'bar' }
});

// Update status
await crdClient.updateStatus('my-cr', {
  phase: 'Running',
  message: 'Resource is ready'
});
```

### Watch Operations

```typescript
// Watch pods
const stopWatching = resources.pod.watch(
  (event) => {
    console.log(`${event.type}: ${event.object.metadata?.name}`);
  },
  {
    namespace: 'default',
    labelSelector: 'app=my-app'
  }
);

// Stop watching when done
stopWatching();
```

### Utility Functions

#### Label Selectors

```typescript
import { LabelSelector } from './utils/ResourceUtils';

const selector = new LabelSelector()
  .equals('app', 'my-app')
  .in('env', ['prod', 'staging'])
  .exists('version')
  .build();
// Result: "app=my-app,env in (prod,staging),version"
```

#### Patch Operations

```typescript
import { PatchBuilder } from './utils/ResourceUtils';

const patch = new PatchBuilder()
  .replace('/spec/replicas', 5)
  .add('/metadata/labels/version', 'v2')
  .build();

await resources.deployment.patch('my-app', patch);
```

#### Metadata Utilities

```typescript
import { MetadataUtils } from './utils/ResourceUtils';

// Generate unique names
const name = MetadataUtils.generateName('pod'); // e.g., "pod-a3x7f"

// Add labels
MetadataUtils.addLabels(resource, {
  app: 'my-app',
  env: 'prod'
});

// Check resource age
const age = MetadataUtils.formatAge(resource); // e.g., "2d", "3h"
```

## Error Handling

All operations throw `KubernetesOperationError` on failure:

```typescript
import { KubernetesOperationError } from './ResourceOperations';

try {
  await resources.pod.get('non-existent');
} catch (error) {
  if (error instanceof KubernetesOperationError) {
    console.error('Operation:', error.operation);
    console.error('Status:', error.statusCode);
    console.error('Message:', error.message);
  }
}
```

## API Documentation

For comprehensive API documentation and more examples, see [ResourceOperations.md](./docs/ResourceOperations.md).

## Testing

The module includes comprehensive unit tests for all components. Run tests with:

```bash
npm test
```

For integration tests with a real cluster:

```bash
npm run test:integration
```

## Contributing

When adding new features:

1. Follow the existing patterns for resource operations
2. Add comprehensive TypeScript types
3. Include unit tests
4. Update documentation
5. Add usage examples

## License

This module is part of the kubeview-mcp project.

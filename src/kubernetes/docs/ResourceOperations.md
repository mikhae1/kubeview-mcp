# Kubernetes Resource Operations API Documentation

This document provides comprehensive documentation for the Kubernetes Resource Operations API, which offers a high-level interface for managing Kubernetes resources.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Resource Operations](#resource-operations)
3. [Pod Operations](#pod-operations)
4. [Service Operations](#service-operations)
5. [Deployment Operations](#deployment-operations)
6. [ConfigMap Operations](#configmap-operations)
7. [Secret Operations](#secret-operations)
8. [Custom Resource Operations](#custom-resource-operations)
9. [Utility Functions](#utility-functions)
10. [Error Handling](#error-handling)
11. [Watch Operations](#watch-operations)

## Getting Started

First, create a Kubernetes client and access resource operations:

```typescript
import { KubernetesClient } from './KubernetesClient';

// Create client with kubeconfig
const client = KubernetesClient.fromKubeConfig();

// Access resource operations
const resources = client.resources;
```

## Resource Operations

All resource operations follow a consistent interface with these common methods:

- `create(resource, options?)` - Create a new resource
- `get(name, options?)` - Get a resource by name
- `update(resource, options?)` - Update an existing resource
- `patch(name, patch, options?)` - Patch a resource
- `delete(name, options?)` - Delete a resource
- `list(options?)` - List resources
- `watch(callback, options?)` - Watch resources for changes

### Common Options

```typescript
interface ResourceOperationOptions {
  namespace?: string;              // Namespace for the operation
  labelSelector?: string;          // Label selector for filtering
  fieldSelector?: string;          // Field selector for filtering
  limit?: number;                  // Maximum number of results
  continueToken?: string;          // Continue token for pagination
  resourceVersion?: string;        // Resource version for optimistic concurrency
  timeoutSeconds?: number;         // Timeout for the operation
  propagationPolicy?: 'Foreground' | 'Background' | 'Orphan';
  gracePeriodSeconds?: number;     // Grace period for deletion
}
```

## Pod Operations

### Create a Pod

```typescript
import * as k8s from '@kubernetes/client-node';

const pod: k8s.V1Pod = {
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: {
    name: 'my-pod',
    namespace: 'default',
    labels: {
      app: 'my-app'
    }
  },
  spec: {
    containers: [{
      name: 'nginx',
      image: 'nginx:latest',
      ports: [{
        containerPort: 80
      }]
    }]
  }
};

const createdPod = await resources.pod.create(pod);
```

### Get Pod Logs

```typescript
// Get logs from a pod
const logs = await resources.pod.getLogs('my-pod', {
  namespace: 'default',
  container: 'nginx',
  tailLines: 100,
  timestamps: true
});

// Stream logs in real-time
const stopStreaming = resources.pod.streamLogs(
  'my-pod',
  (data) => console.log(data),
  {
    namespace: 'default',
    follow: true,
    tailLines: 10
  }
);

// Stop streaming when done
stopStreaming();
```

### Execute Commands in Pod

```typescript
const result = await resources.pod.exec('my-pod', ['ls', '-la'], {
  namespace: 'default',
  container: 'nginx'
});

console.log('stdout:', result.stdout);
console.log('stderr:', result.stderr);
```

### List Pods with Filters

```typescript
// List all pods in a namespace
const pods = await resources.pod.list({
  namespace: 'default'
});

// List pods with label selector
const filteredPods = await resources.pod.list({
  namespace: 'default',
  labelSelector: 'app=my-app,env=production'
});

// List pods with field selector
const runningPods = await resources.pod.list({
  namespace: 'default',
  fieldSelector: 'status.phase=Running'
});
```

## Service Operations

### Create a Service

```typescript
const service: k8s.V1Service = {
  apiVersion: 'v1',
  kind: 'Service',
  metadata: {
    name: 'my-service',
    namespace: 'default'
  },
  spec: {
    selector: {
      app: 'my-app'
    },
    ports: [{
      protocol: 'TCP',
      port: 80,
      targetPort: 8080
    }],
    type: 'ClusterIP'
  }
};

const createdService = await resources.service.create(service);
```

### Create Service from Pod

```typescript
// Automatically create a service for a pod
const service = await resources.service.createFromPod(pod, 80, {
  namespace: 'default',
  serviceName: 'my-pod-service',
  serviceType: 'NodePort'
});
```

### Get Service Endpoints

```typescript
const endpoints = await resources.service.getEndpoints('my-service', {
  namespace: 'default'
});
```

## Deployment Operations

### Create a Deployment

```typescript
const deployment: k8s.V1Deployment = {
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: {
    name: 'my-deployment',
    namespace: 'default'
  },
  spec: {
    replicas: 3,
    selector: {
      matchLabels: {
        app: 'my-app'
      }
    },
    template: {
      metadata: {
        labels: {
          app: 'my-app'
        }
      },
      spec: {
        containers: [{
          name: 'nginx',
          image: 'nginx:1.14.2',
          ports: [{
            containerPort: 80
          }]
        }]
      }
    }
  }
};

const createdDeployment = await resources.deployment.create(deployment);
```

### Scale Deployment

```typescript
// Scale to 5 replicas
await resources.deployment.scale('my-deployment', 5, {
  namespace: 'default'
});
```

### Update Deployment Image

```typescript
await resources.deployment.updateImage(
  'my-deployment',
  'nginx',
  'nginx:1.16.0',
  { namespace: 'default' }
);
```

### Restart Deployment

```typescript
await resources.deployment.restart('my-deployment', {
  namespace: 'default'
});
```

### Rollback Deployment

```typescript
await resources.deployment.rollback('my-deployment', {
  namespace: 'default'
});
```

### Wait for Deployment Ready

```typescript
const isReady = await resources.deployment.waitForReady('my-deployment', {
  namespace: 'default',
  timeoutSeconds: 300
});
```

## ConfigMap Operations

### Create ConfigMap from Data

```typescript
const configMap = await resources.configMap.createFromData(
  'my-config',
  {
    'config.yaml': 'key: value\nother: data',
    'app.properties': 'server.port=8080'
  },
  {
    namespace: 'default',
    labels: { app: 'my-app' }
  }
);
```

### Update ConfigMap Values

```typescript
// Add or update a key
await resources.configMap.setKey('my-config', 'new-key', 'new-value', {
  namespace: 'default'
});

// Remove a key
await resources.configMap.removeKey('my-config', 'old-key', {
  namespace: 'default'
});

// Get a specific value
const value = await resources.configMap.getValue('my-config', 'config.yaml', {
  namespace: 'default'
});
```

## Secret Operations

### Create Different Types of Secrets

```typescript
// Create Opaque secret
const secret = await resources.secret.createOpaque(
  'my-secret',
  {
    username: 'admin',
    password: 'secret123'
  },
  { namespace: 'default' }
);

// Create TLS secret
const tlsSecret = await resources.secret.createTLS(
  'tls-secret',
  tlsCertContent,
  tlsKeyContent,
  { namespace: 'default' }
);

// Create Docker registry secret
const dockerSecret = await resources.secret.createDockerRegistry(
  'docker-secret',
  'docker.io',
  'username',
  'password',
  'email@example.com',
  { namespace: 'default' }
);

// Create Basic Auth secret
const basicAuthSecret = await resources.secret.createBasicAuth(
  'basic-auth',
  'username',
  'password',
  { namespace: 'default' }
);

// Create SSH Auth secret
const sshSecret = await resources.secret.createSSHAuth(
  'ssh-secret',
  privateKeyContent,
  { namespace: 'default' }
);
```

### Work with Secret Data

```typescript
// Get decoded secret data
const decodedData = await resources.secret.getDecodedData('my-secret', {
  namespace: 'default'
});

// Get specific decoded value
const password = await resources.secret.getDecodedValue('my-secret', 'password', {
  namespace: 'default'
});

// Update secret key
await resources.secret.setKey('my-secret', 'new-password', 'newSecret456', {
  namespace: 'default'
});
```

## Custom Resource Operations

### Create Custom Resource Client

```typescript
// For a namespaced custom resource
const crdClient = resources.custom(
  'example.com',     // group
  'v1',              // version
  'myresources',     // plural
  true               // namespaced
);

// For a cluster-scoped custom resource
const clusterCrdClient = resources.custom(
  'example.com',
  'v1',
  'clusterresources',
  false
);
```

### Work with Custom Resources

```typescript
// Create custom resource
const customResource = {
  apiVersion: 'example.com/v1',
  kind: 'MyResource',
  metadata: {
    name: 'my-custom-resource',
    namespace: 'default'
  },
  spec: {
    // Custom spec fields
    foo: 'bar',
    replicas: 3
  }
};

const created = await crdClient.create(customResource);

// Update status subresource
await crdClient.updateStatus('my-custom-resource', {
  phase: 'Running',
  message: 'All replicas are ready'
}, { namespace: 'default' });

// Check if CRD exists
const crdExists = await crdClient.crdExists();
```

## Utility Functions

### Label Selector Builder

```typescript
import { LabelSelector } from './utils/ResourceUtils';

const selector = new LabelSelector()
  .equals('app', 'my-app')
  .notEquals('env', 'dev')
  .in('tier', ['frontend', 'backend'])
  .exists('version')
  .build();
// Result: "app=my-app,env!=dev,tier in (frontend,backend),version"

const pods = await resources.pod.list({
  labelSelector: selector
});
```

### Field Selector Builder

```typescript
import { FieldSelector } from './utils/ResourceUtils';

const selector = new FieldSelector()
  .namespace('production')
  .phase('Running')
  .field('spec.nodeName', 'node-1')
  .build();
// Result: "metadata.namespace=production,status.phase=Running,spec.nodeName=node-1"
```

### Patch Builder

```typescript
import { PatchBuilder } from './utils/ResourceUtils';

const patch = new PatchBuilder()
  .replace('/spec/replicas', 5)
  .add('/metadata/labels/version', 'v2')
  .remove('/metadata/annotations/old-annotation')
  .build();

await resources.deployment.patch('my-deployment', patch);
```

### Metadata Utilities

```typescript
import { MetadataUtils } from './utils/ResourceUtils';

// Generate unique name
const name = MetadataUtils.generateName('pod'); // e.g., "pod-a3x7f"

// Add labels to resource
MetadataUtils.addLabels(pod, {
  app: 'my-app',
  version: 'v1'
});

// Add annotations
MetadataUtils.addAnnotations(pod, {
  'kubernetes.io/description': 'My pod description'
});

// Add owner reference
MetadataUtils.addOwnerReference(pod, deployment, true, true);

// Check labels/annotations
const hasLabel = MetadataUtils.hasLabel(pod, 'app', 'my-app');
const age = MetadataUtils.formatAge(pod); // e.g., "2d", "3h", "45m"
```

### Container Utilities

```typescript
import { ContainerUtils } from './utils/ResourceUtils';

// Create container
const container = ContainerUtils.createContainer('nginx', 'nginx:latest', {
  command: ['/bin/sh'],
  args: ['-c', 'echo Hello'],
  ports: [{ containerPort: 80 }]
});

// Add environment variables
ContainerUtils.addEnvVar(container, 'ENV_VAR', 'value');
ContainerUtils.addEnvVar(container, 'SECRET_VAR', undefined, {
  secretKeyRef: {
    name: 'my-secret',
    key: 'password'
  }
});

// Set resources
ContainerUtils.setResources(container,
  { cpu: '100m', memory: '128Mi' },  // requests
  { cpu: '500m', memory: '512Mi' }   // limits
);
```

## Error Handling

All operations throw `KubernetesOperationError` on failure:

```typescript
import { KubernetesOperationError } from './ResourceOperations';

try {
  await resources.pod.get('non-existent-pod');
} catch (error) {
  if (error instanceof KubernetesOperationError) {
    console.error('Operation:', error.operation);
    console.error('Resource:', error.resource);
    console.error('Status Code:', error.statusCode);
    console.error('Message:', error.message);
  }
}
```

## Watch Operations

Watch resources for real-time updates:

```typescript
import { WatchEventType } from './ResourceOperations';

// Watch all pods in a namespace
const stopWatching = resources.pod.watch(
  (event) => {
    switch (event.type) {
      case WatchEventType.ADDED:
        console.log('Pod added:', event.object.metadata?.name);
        break;
      case WatchEventType.MODIFIED:
        console.log('Pod modified:', event.object.metadata?.name);
        break;
      case WatchEventType.DELETED:
        console.log('Pod deleted:', event.object.metadata?.name);
        break;
      case WatchEventType.ERROR:
        console.error('Watch error:', event.object);
        break;
    }
  },
  {
    namespace: 'default',
    labelSelector: 'app=my-app'
  }
);

// Stop watching when done
stopWatching();
```

## Best Practices

1. **Always handle errors**: Kubernetes operations can fail for various reasons
2. **Use namespaces**: Specify namespaces explicitly for better isolation
3. **Set resource limits**: Always set resource requests and limits for containers
4. **Use labels effectively**: Use consistent labeling for resource organization
5. **Watch responsibly**: Stop watchers when no longer needed to avoid resource leaks
6. **Paginate large lists**: Use limit and continue tokens for large result sets
7. **Use patch for partial updates**: More efficient than full resource updates
8. **Validate resources**: Ensure resources conform to Kubernetes API specifications

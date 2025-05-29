# Connection Pooling for Kubernetes Client

The kube-mcp library provides advanced connection pooling capabilities for managing Kubernetes API connections efficiently. This feature helps optimize performance, handle multiple clusters, and provide failover capabilities.

## Table of Contents

- [Overview](#overview)
- [Basic Usage](#basic-usage)
- [Connection Pool Configuration](#connection-pool-configuration)
- [Multi-Cluster Management](#multi-cluster-management)
- [Load Balancing Strategies](#load-balancing-strategies)
- [Health Monitoring](#health-monitoring)
- [Performance Tuning](#performance-tuning)
- [Examples](#examples)

## Overview

Connection pooling offers several benefits:

- **Reduced Overhead**: Reuse existing connections instead of creating new ones
- **Better Performance**: Minimize connection establishment time
- **Resource Management**: Control the number of concurrent connections
- **Health Monitoring**: Automatic detection and recovery from connection failures
- **Multi-Cluster Support**: Manage connections to multiple Kubernetes clusters
- **Load Balancing**: Distribute requests across multiple clusters

## Basic Usage

### Enabling Connection Pooling

To enable connection pooling in your Kubernetes client:

```typescript
import { KubernetesClient, ConnectionPoolConfig } from 'kube-mcp';

const client = new KubernetesClient({
  enableConnectionPooling: true,
  connectionPoolConfig: {
    minConnections: 2,
    maxConnections: 10,
    maxIdleTime: 300000, // 5 minutes
    healthCheckInterval: 60000 // 1 minute
  }
});

// Use the client as normal
const pods = await client.resources.pod.list({ namespace: 'default' });
```

### Connection Pool Statistics

Monitor pool performance with statistics:

```typescript
const stats = client.getPoolStats();
console.log('Pool Statistics:', {
  total: stats.total,
  idle: stats.idle,
  inUse: stats.inUse,
  unhealthy: stats.unhealthy,
  waitQueueLength: stats.waitQueueLength
});
```

## Connection Pool Configuration

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxConnections` | number | 10 | Maximum number of connections per pool |
| `minConnections` | number | 2 | Minimum number of connections to maintain |
| `maxIdleTime` | number | 300000 | Maximum idle time before removing a connection (ms) |
| `acquireTimeout` | number | 30000 | Time to wait for a connection to become available (ms) |
| `healthCheckInterval` | number | 60000 | Interval for health check runs (ms) |
| `healthCheckRetries` | number | 3 | Number of retries for failed health checks |
| `enableWarmup` | boolean | true | Enable connection warm-up on pool initialization |

### Example Configuration

```typescript
const poolConfig: ConnectionPoolConfig = {
  maxConnections: 20,
  minConnections: 5,
  maxIdleTime: 600000, // 10 minutes
  acquireTimeout: 45000, // 45 seconds
  healthCheckInterval: 30000, // 30 seconds
  healthCheckRetries: 5,
  enableWarmup: true
};

const client = new KubernetesClient({
  enableConnectionPooling: true,
  connectionPoolConfig: poolConfig
});
```

## Multi-Cluster Management

For managing multiple Kubernetes clusters, use the `ConnectionManager`:

```typescript
import { ConnectionManager, LoadBalancingStrategy } from 'kube-mcp';
import * as k8s from '@kubernetes/client-node';

const manager = new ConnectionManager({
  loadBalancingStrategy: LoadBalancingStrategy.ROUND_ROBIN,
  enableFailover: true,
  defaultPoolConfig: {
    minConnections: 2,
    maxConnections: 10
  }
});

// Add clusters
await manager.addCluster({
  name: 'production-cluster',
  kubeConfigFactory: () => {
    const kc = new k8s.KubeConfig();
    kc.loadFromFile('/path/to/prod-kubeconfig');
    return kc;
  },
  weight: 3 // For weighted load balancing
});

await manager.addCluster({
  name: 'staging-cluster',
  kubeConfigFactory: () => {
    const kc = new k8s.KubeConfig();
    kc.loadFromFile('/path/to/staging-kubeconfig');
    return kc;
  },
  weight: 1
});

// Acquire connections
const { cluster, connection } = await manager.acquire();
console.log(`Using connection from cluster: ${cluster}`);

// Use with preference
const { connection: prodConn } = await manager.acquire('production-cluster');

// Release connections when done
manager.release(cluster, connection);
```

## Load Balancing Strategies

The ConnectionManager supports multiple load balancing strategies:

### Round Robin
Distributes requests evenly across all enabled clusters in sequence.

```typescript
const manager = new ConnectionManager({
  loadBalancingStrategy: LoadBalancingStrategy.ROUND_ROBIN
});
```

### Least Connections
Routes requests to the cluster with the fewest active connections.

```typescript
const manager = new ConnectionManager({
  loadBalancingStrategy: LoadBalancingStrategy.LEAST_CONNECTIONS
});
```

### Weighted
Distributes requests based on assigned weights.

```typescript
const manager = new ConnectionManager({
  loadBalancingStrategy: LoadBalancingStrategy.WEIGHTED
});

await manager.addCluster({
  name: 'primary',
  kubeConfigFactory: factoryFn,
  weight: 7 // Gets 70% of traffic
});

await manager.addCluster({
  name: 'secondary',
  kubeConfigFactory: factoryFn,
  weight: 3 // Gets 30% of traffic
});
```

### Random
Randomly selects a cluster for each request.

```typescript
const manager = new ConnectionManager({
  loadBalancingStrategy: LoadBalancingStrategy.RANDOM
});
```

## Health Monitoring

### Automatic Health Checks

Connection pools automatically monitor connection health:

```typescript
const poolConfig: ConnectionPoolConfig = {
  healthCheckInterval: 60000, // Check every minute
  healthCheckRetries: 3, // Retry 3 times before marking unhealthy
};
```

### Manual Health Monitoring

Monitor cluster health status:

```typescript
const stats = manager.getStats();

stats.forEach((clusterStats, clusterName) => {
  console.log(`Cluster: ${clusterName}`);
  console.log(`  Healthy: ${clusterStats.healthy}`);
  console.log(`  Connections: ${clusterStats.poolStats.total}`);
  console.log(`  In Use: ${clusterStats.poolStats.inUse}`);
});
```

### Automatic Failover

Enable automatic failover for unhealthy clusters:

```typescript
const manager = new ConnectionManager({
  enableFailover: true,
  clusterHealthCheckInterval: 30000 // Check cluster health every 30 seconds
});

// Unhealthy clusters will be automatically disabled
// Requests will failover to healthy clusters
```

## Performance Tuning

### Connection Warm-up

Pre-create connections for better performance:

```typescript
const poolConfig: ConnectionPoolConfig = {
  minConnections: 5,
  enableWarmup: true // Pre-create minimum connections
};
```

### Idle Connection Management

Configure how long connections can remain idle:

```typescript
const poolConfig: ConnectionPoolConfig = {
  maxIdleTime: 300000, // 5 minutes
  minConnections: 2 // Always keep 2 connections
};
```

### Connection Limits

Control resource usage:

```typescript
const poolConfig: ConnectionPoolConfig = {
  maxConnections: 20, // Maximum connections per pool
  acquireTimeout: 30000 // Wait up to 30 seconds for a connection
};
```

## Examples

### Example 1: Single Cluster with Pooling

```typescript
import { KubernetesClient } from 'kube-mcp';
import { createLogger } from 'winston';

const logger = createLogger({
  // ... logger configuration
});

const client = new KubernetesClient({
  kubeConfigPath: '/path/to/kubeconfig',
  context: 'my-context',
  enableConnectionPooling: true,
  connectionPoolConfig: {
    minConnections: 2,
    maxConnections: 10,
    healthCheckInterval: 60000
  },
  logger
});

// Operations automatically use pooled connections
const namespaces = await client.core.listNamespace();
const deployments = await client.apps.listNamespacedDeployment('default');

// Check pool health
const stats = client.getPoolStats();
logger.info('Pool stats:', stats);

// Cleanup when done
await client.dispose();
```

### Example 2: Multi-Cluster with Failover

```typescript
import { ConnectionManager, LoadBalancingStrategy } from 'kube-mcp';
import * as k8s from '@kubernetes/client-node';

async function setupMultiCluster() {
  const manager = new ConnectionManager({
    loadBalancingStrategy: LoadBalancingStrategy.LEAST_CONNECTIONS,
    enableFailover: true,
    clusterHealthCheckInterval: 30000,
    defaultPoolConfig: {
      minConnections: 3,
      maxConnections: 15
    }
  });

  // Add multiple clusters
  const clusters = ['us-east', 'us-west', 'eu-central'];

  for (const region of clusters) {
    await manager.addCluster({
      name: `cluster-${region}`,
      kubeConfigFactory: () => {
        const kc = new k8s.KubeConfig();
        kc.loadFromFile(`/configs/${region}-kubeconfig.yaml`);
        return kc;
      }
    });
  }

  // Perform operations across clusters
  async function listPodsAcrossClusters() {
    const results = new Map();

    for (const region of clusters) {
      try {
        const { cluster, connection } = await manager.acquire(`cluster-${region}`);
        const api = connection.makeApiClient(k8s.CoreV1Api);
        const pods = await api.listPodForAllNamespaces();
        results.set(cluster, pods.body.items.length);
        manager.release(cluster, connection);
      } catch (error) {
        console.error(`Failed to list pods in ${region}:`, error);
      }
    }

    return results;
  }

  // Monitor cluster health
  setInterval(() => {
    const stats = manager.getStats();
    stats.forEach((stat, cluster) => {
      console.log(`${cluster}: ${stat.healthy ? '✓' : '✗'} (${stat.poolStats.idle}/${stat.poolStats.total})`);
    });
  }, 60000);

  return manager;
}
```

### Example 3: Connection Pool Events

```typescript
import { ConnectionPool } from 'kube-mcp';

const pool = new ConnectionPool('my-context', kubeConfigFactory, {
  minConnections: 2,
  maxConnections: 10
});

// Monitor pool events
pool.on('connectionCreated', (conn) => {
  console.log(`New connection created: ${conn.id}`);
});

pool.on('connectionAcquired', (conn) => {
  console.log(`Connection acquired: ${conn.id} (use count: ${conn.useCount})`);
});

pool.on('connectionReleased', (conn) => {
  console.log(`Connection released: ${conn.id}`);
});

pool.on('connectionRemoved', (conn) => {
  console.log(`Connection removed: ${conn.id} (lifetime uses: ${conn.useCount})`);
});

// Use the pool
const conn = await pool.acquire();
try {
  const api = conn.makeApiClient(k8s.CoreV1Api);
  // ... use the API client
} finally {
  pool.release(conn);
}
```

## Best Practices

1. **Right-size your pools**: Start with conservative limits and adjust based on monitoring
2. **Enable health checks**: Regular health checks help maintain pool reliability
3. **Use connection warmup**: Pre-create connections for better initial performance
4. **Monitor pool statistics**: Track usage patterns to optimize configuration
5. **Handle connection errors**: Always release connections even when operations fail
6. **Dispose properly**: Clean up pools and managers when shutting down

## Troubleshooting

### High Wait Times

If you see high `waitQueueLength` in statistics:
- Increase `maxConnections`
- Check for connection leaks (not releasing connections)
- Review operation duration

### Frequent Health Check Failures

If connections frequently fail health checks:
- Check network connectivity
- Verify authentication credentials
- Increase `healthCheckRetries`
- Review API server logs

### Memory Usage

To reduce memory usage:
- Decrease `maxConnections`
- Reduce `maxIdleTime`
- Disable `enableWarmup` if not needed

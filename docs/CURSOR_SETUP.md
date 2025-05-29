# Enabling Kube MCP in Cursor

This guide explains how to set up and enable the Kubernetes MCP (Model Context Protocol) server in Cursor IDE, allowing you to interact with Kubernetes clusters directly from your AI assistant.

## Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- Cursor IDE (latest version)
- Access to a Kubernetes cluster (with kubeconfig configured)

## What is Kube MCP?

The Kubernetes MCP server provides intelligent debugging and analysis capabilities for Kubernetes clusters through Cursor's AI assistant. It enables you to:
- List and inspect Kubernetes resources (pods, services, deployments, etc.)
- Stream and analyze logs
- Debug cluster issues with AI assistance
- Perform multi-cluster operations
- Execute kubectl-like commands through natural language

## Installation Options

### Option 1: Local Development Setup

If you're developing or testing the kube MCP server locally:

1. **Clone and build the project:**
   ```bash
   # Clone the repository
   git clone <repository-url>
   cd kube-mcp

   # Install dependencies
   npm install

   # Build the project
   npm run build
   ```

2. **Create or update `.cursor/mcp.json`:**
   ```json
   {
       "mcpServers": {
           "kube-mcp": {
               "command": "node",
               "args": ["dist/index.js"],
               "cwd": "/absolute/path/to/kube-mcp",
               "env": {
                   "KUBECONFIG": "/path/to/your/.kube/config"
               }
           }
       }
   }
   ```

### Option 2: NPM Package Installation (When Published)

Once the package is published to npm:

1. **Install globally:**
   ```bash
   npm install -g kube-mcp
   ```

2. **Configure in `.cursor/mcp.json`:**
   ```json
   {
       "mcpServers": {
           "kube-mcp": {
               "command": "npx",
               "args": [
                   "-y",
                   "--package=kube-mcp",
                   "kube-mcp"
               ],
               "env": {
                   "KUBECONFIG": "/path/to/your/.kube/config"
               }
           }
       }
   }
   ```

## Configuration

### Basic Configuration

The minimal configuration requires only the command to run the server:

```json
{
    "mcpServers": {
        "kube-mcp": {
            "command": "node",
            "args": ["dist/index.js"],
            "cwd": "/path/to/kube-mcp"
        }
    }
}
```

### Advanced Configuration

You can configure additional options through environment variables:

```json
{
    "mcpServers": {
        "kube-mcp": {
            "command": "node",
            "args": ["dist/index.js"],
            "cwd": "/path/to/kube-mcp",
            "env": {
                "KUBECONFIG": "/path/to/your/.kube/config",
                "KUBE_CONTEXT": "production-cluster",
                "LOG_LEVEL": "debug",
                "ENABLE_CONNECTION_POOLING": "true",
                "MAX_CONNECTIONS": "10",
                "MIN_CONNECTIONS": "2"
            }
        }
    }
}
```

### Environment Variables

- `KUBECONFIG`: Path to your kubeconfig file (default: `~/.kube/config`)
- `KUBE_CONTEXT`: Specific context to use from kubeconfig
- `LOG_LEVEL`: Logging level (error, warn, info, debug)
- `ENABLE_CONNECTION_POOLING`: Enable connection pooling for better performance
- `MAX_CONNECTIONS`: Maximum number of pooled connections
- `MIN_CONNECTIONS`: Minimum number of pooled connections

## Multi-Cluster Setup

To work with multiple clusters simultaneously:

```json
{
    "mcpServers": {
        "kube-mcp-prod": {
            "command": "node",
            "args": ["dist/index.js"],
            "cwd": "/path/to/kube-mcp",
            "env": {
                "KUBECONFIG": "/path/to/prod-kubeconfig",
                "KUBE_CONTEXT": "production"
            }
        },
        "kube-mcp-staging": {
            "command": "node",
            "args": ["dist/index.js"],
            "cwd": "/path/to/kube-mcp",
            "env": {
                "KUBECONFIG": "/path/to/staging-kubeconfig",
                "KUBE_CONTEXT": "staging"
            }
        }
    }
}
```

## Enabling the Server

1. **Save the configuration:** Ensure your `.cursor/mcp.json` file is saved in your project root.

2. **Restart Cursor:** Close and reopen Cursor IDE to load the new MCP configuration.

3. **Verify the connection:** Open a new chat in Cursor and try a Kubernetes command:
   ```
   "List all pods in the default namespace"
   ```

## Troubleshooting

### Server Not Starting

1. **Check logs:** Look for error messages in Cursor's developer console (View → Toggle Developer Tools)

2. **Verify paths:** Ensure all paths in the configuration are absolute paths

3. **Check Node.js version:**
   ```bash
   node --version  # Should be >= 18.0.0
   ```

### Authentication Issues

1. **Test kubectl access:**
   ```bash
   kubectl get pods  # Should work without errors
   ```

2. **Verify kubeconfig path:** Ensure the KUBECONFIG environment variable points to a valid file

3. **Check context:** Make sure the specified context exists:
   ```bash
   kubectl config get-contexts
   ```

### Common Issues

- **"Command not found"**: Ensure the build step was completed (`npm run build`)
- **"Permission denied"**: Check file permissions on the kubeconfig file
- **"No resources found"**: Verify you have the right namespace and permissions

## Usage Examples

Once enabled, you can interact with your Kubernetes cluster through natural language:

- "Show me all failing pods"
- "Get logs from the nginx deployment"
- "Describe the production service"
- "List all configmaps in namespace app"
- "Debug why my pod is in CrashLoopBackOff"

### Detailed Examples

Here are specific examples of what you can ask and what to expect:

#### 1. Listing Resources

**Question:** "List all pods in the default namespace"

**Expected Response:**
```
Here are the pods in the default namespace:

1. nginx-deployment-7fb96c846b-abc123
   - Status: Running
   - Ready: 1/1
   - Age: 2d
   - IP: 10.1.0.45

2. redis-master-0
   - Status: Running
   - Ready: 1/1
   - Age: 5d
   - IP: 10.1.0.12

3. app-backend-5d6b7c8d9-xyz789
   - Status: CrashLoopBackOff
   - Ready: 0/1
   - Age: 1h
   - Restarts: 15
```

#### 2. Debugging Issues

**Question:** "Why is my app-backend pod in CrashLoopBackOff?"

**Expected Response:**
```
I've analyzed the app-backend pod and found the following issues:

1. **Exit Code:** 1 (General errors)
2. **Last Termination Reason:** Error
3. **Recent Events:**
   - Back-off restarting failed container
   - Container app failed liveness probe

**Recent Logs:**
```
Error: Cannot connect to database at postgres:5432
Connection refused - is the database running?
Fatal: Application startup failed
```

**Recommendations:**
1. Check if the postgres service is running
2. Verify the database connection string in your ConfigMap
3. Ensure network policies allow connection to postgres
```

#### 3. Getting Logs

**Question:** "Show me the last 50 lines of logs from the nginx pod"

**Expected Response:**
```
Here are the last 50 lines from nginx-deployment-7fb96c846b-abc123:

10.1.0.1 - - [24/Nov/2024:10:15:23 +0000] "GET /api/health HTTP/1.1" 200 15
10.1.0.1 - - [24/Nov/2024:10:15:33 +0000] "GET /api/health HTTP/1.1" 200 15
10.1.0.2 - - [24/Nov/2024:10:15:45 +0000] "POST /api/users HTTP/1.1" 201 245
10.1.0.3 - - [24/Nov/2024:10:15:47 +0000] "GET /api/users/123 HTTP/1.1" 200 312
...
```

#### 4. Inspecting Services

**Question:** "Describe the kubernetes service in the default namespace"

**Expected Response:**
```
Service: kubernetes
Namespace: default
Type: ClusterIP
Cluster IP: 10.96.0.1
Port: https 443/TCP
Endpoints: 192.168.1.10:6443

Labels:
  component: apiserver
  provider: kubernetes

No external endpoints configured.
Session Affinity: None
```

#### 5. Checking Deployments

**Question:** "Show me all deployments and their replica status"

**Expected Response:**
```
Deployments in all namespaces:

default namespace:
1. nginx-deployment
   - Desired: 3
   - Current: 3
   - Up-to-date: 3
   - Available: 3
   - Status: ✅ Healthy

2. app-backend
   - Desired: 2
   - Current: 2
   - Up-to-date: 2
   - Available: 0
   - Status: ❌ Unhealthy (pods failing)

kube-system namespace:
1. coredns
   - Desired: 2
   - Current: 2
   - Available: 2
   - Status: ✅ Healthy
```

#### 6. Configuration and Secrets

**Question:** "List all configmaps in the app namespace"

**Expected Response:**
```
ConfigMaps in namespace 'app':

1. app-config
   - Data Keys: database_url, api_key, environment
   - Size: 3 items
   - Age: 10d

2. nginx-config
   - Data Keys: nginx.conf
   - Size: 1 item
   - Age: 5d

3. feature-flags
   - Data Keys: flags.json
   - Size: 1 item
   - Age: 2d
```

#### 7. Resource Usage

**Question:** "Show me pods consuming the most CPU"

**Expected Response:**
```
Top CPU-consuming pods:

1. elasticsearch-master-0 (elastic namespace)
   - CPU: 850m (85% of request)
   - Memory: 3.2Gi
   - Node: worker-node-2

2. prometheus-server-7d9b4d8c5-abc123 (monitoring namespace)
   - CPU: 450m (90% of request)
   - Memory: 2.1Gi
   - Node: worker-node-1

3. app-processor-6f7d8c9b5-xyz456 (default namespace)
   - CPU: 380m (76% of request)
   - Memory: 512Mi
   - Node: worker-node-3
```

#### 8. Namespace Operations

**Question:** "What namespaces exist in my cluster?"

**Expected Response:**
```
Namespaces in your cluster:

1. default
   - Status: Active
   - Age: 30d
   - Labels: kubernetes.io/metadata.name=default

2. kube-system
   - Status: Active
   - Age: 30d
   - Purpose: Kubernetes system components

3. app
   - Status: Active
   - Age: 15d
   - Labels: env=production, team=backend

4. monitoring
   - Status: Active
   - Age: 20d
   - Labels: env=production, team=sre
```

#### 9. Troubleshooting Network

**Question:** "Check if the frontend pod can reach the backend service"

**Expected Response:**
```
Network connectivity analysis:

From Pod: frontend-7d9b4d8c5-abc123
To Service: backend-service (port 8080)

✅ Service exists and has endpoints
✅ Network policies allow traffic
✅ Service selector matches 2 pods
⚠️ One backend pod is not ready

Backend endpoints:
- 10.1.0.45:8080 (Ready)
- 10.1.0.46:8080 (Not Ready - CrashLoopBackOff)

Recommendation: Fix the failing backend pod for full service availability.
```

#### 10. Advanced Queries

**Question:** "Find all pods with label app=nginx that were created in the last hour"

**Expected Response:**
```
Pods matching label 'app=nginx' created in the last hour:

1. nginx-canary-8f7d6c5b4-new123
   - Namespace: default
   - Created: 25 minutes ago
   - Status: Running
   - Node: worker-node-2

2. nginx-canary-8f7d6c5b4-new456
   - Namespace: default
   - Created: 25 minutes ago
   - Status: Running
   - Node: worker-node-3

Total: 2 pods found
```

### Tips for Effective Usage

1. **Be Specific:** Include namespace names when known
   - ✅ "Show logs from nginx pod in production namespace"
   - ❌ "Show logs"

2. **Use Kubernetes Terminology:** The AI understands k8s concepts
   - Pods, Services, Deployments, ConfigMaps, Secrets
   - Namespaces, Labels, Selectors
   - Ready, Running, CrashLoopBackOff, Pending

3. **Ask for Analysis:** Request explanations and recommendations
   - "Why is this pod failing?"
   - "What's causing high CPU usage?"
   - "How can I fix this CrashLoopBackOff?"

4. **Combine Operations:** Ask for related information
   - "Show me failing pods and their recent logs"
   - "List services and their endpoint health"

5. **Time-based Queries:** Use temporal filters
   - "Pods created today"
   - "Events from the last hour"
   - "Logs from the past 5 minutes"

## Development Mode

For active development with hot reload:

```json
{
    "mcpServers": {
        "kube-mcp-dev": {
            "command": "npm",
            "args": ["run", "dev"],
            "cwd": "/path/to/kube-mcp",
            "env": {
                "KUBECONFIG": "/path/to/your/.kube/config"
            }
        }
    }
}
```

## Security Considerations

- Never commit `.cursor/mcp.json` with sensitive credentials
- Use kubeconfig files with appropriate RBAC permissions
- Consider using service accounts for production environments
- Regularly rotate credentials and tokens

## Next Steps

- Explore available tools by asking "What Kubernetes operations can you help with?"
- Check the [README.md](../README.md) for full feature list
- Review [ConnectionPooling.md](./ConnectionPooling.md) for performance optimization
- See the plugin development guide to extend functionality
- Keep the [Quick Reference Guide](./CURSOR_QUICK_REFERENCE.md) handy for common commands

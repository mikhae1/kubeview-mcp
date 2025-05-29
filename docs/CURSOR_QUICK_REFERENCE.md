# Kube MCP Quick Reference for Cursor

A quick reference guide for common Kubernetes operations using kube MCP in Cursor IDE.

## 🚀 Basic Commands

### Listing Resources
- `"List all pods"` - Shows all pods in default namespace
- `"Show pods in [namespace]"` - List pods in specific namespace
- `"List all services"` - Shows all services
- `"Show deployments"` - List all deployments
- `"What namespaces exist?"` - List all namespaces

### Getting Details
- `"Describe pod [name]"` - Detailed pod information
- `"Show service [name] details"` - Service configuration
- `"Describe deployment [name]"` - Deployment details

### Logs & Debugging
- `"Show logs from [pod-name]"` - Get pod logs
- `"Last 50 lines of logs from [pod]"` - Recent logs
- `"Why is [pod-name] failing?"` - Debug pod issues
- `"Show events for [pod-name]"` - Pod events

## 🔍 Advanced Queries

### Filtering & Searching
- `"Pods with label app=nginx"` - Label-based search
- `"Failed pods in production namespace"` - Status filtering
- `"Pods created in last hour"` - Time-based queries
- `"Pods on node [node-name]"` - Node-specific pods

### Resource Analysis
- `"Top CPU consuming pods"` - Resource usage
- `"Pods using most memory"` - Memory analysis
- `"Show pod resource limits"` - Resource constraints
- `"Which nodes are under pressure?"` - Node health

### Network Troubleshooting
- `"Can [pod-a] reach [service-b]?"` - Connectivity check
- `"Show endpoints for [service]"` - Service endpoints
- `"List all ingresses"` - Ingress rules
- `"Check network policies"` - Network restrictions

## 📊 Status Checks

### Health Monitoring
- `"Show unhealthy pods"` - Find failing pods
- `"Pods in CrashLoopBackOff"` - Crash loops
- `"Pending pods"` - Scheduling issues
- `"Show pod restart counts"` - Stability check

### Deployment Status
- `"Deployment rollout status"` - Update progress
- `"Show replica counts"` - Scaling status
- `"Failed deployments"` - Deployment issues

## 🛠️ Configuration

### ConfigMaps & Secrets
- `"List configmaps in [namespace]"` - Show configs
- `"Show configmap [name]"` - Config details
- `"List secrets"` - Show secrets (metadata only)
- `"Which pods use configmap [name]?"` - Usage tracking

### Resource Management
- `"Show resource quotas"` - Namespace limits
- `"List persistent volumes"` - Storage
- `"Show storage classes"` - Storage options

## 💡 Pro Tips

### Combine Operations
- `"Show failing pods and their logs"`
- `"List services and their pod status"`
- `"Find pods without resource limits"`

### Troubleshooting Workflows
1. **Pod Won't Start:**
   - `"Why is [pod] pending?"`
   - `"Show events for [pod]"`
   - `"Describe node where [pod] should run"`

2. **Application Errors:**
   - `"Show logs from [pod] with errors"`
   - `"Check [pod] environment variables"`
   - `"Is [service] reachable from [pod]?"`

3. **Performance Issues:**
   - `"Pods using over 80% CPU"`
   - `"Show horizontal pod autoscaler status"`
   - `"Node resource utilization"`

### Quick Diagnostics
- `"Health check all deployments"` - Overall status
- `"Show recent cluster events"` - Recent activity
- `"List pods not running"` - Quick problem scan

## 🎯 Best Practices

1. **Always specify namespace** when known
2. **Use exact names** for specific resources
3. **Ask follow-up questions** for deeper analysis
4. **Request recommendations** for fixing issues

## 🔧 Common Patterns

### Deployment Updates
```
"Show current version of [deployment]"
"History of [deployment] rollouts"
"Rollback [deployment] to previous version"
```

### Scaling Operations
```
"Current replicas for [deployment]"
"Scale [deployment] to 5 replicas"
"Show horizontal pod autoscaler for [deployment]"
```

### Security Checks
```
"Pods running as root"
"Show service accounts"
"List role bindings in [namespace]"
```

## ⚡ Emergency Commands

- `"Show all failing pods across cluster"` - Crisis overview
- `"Recent pod terminations"` - Crash investigation
- `"Nodes with disk pressure"` - Storage issues
- `"Services without endpoints"` - Connectivity problems

---

💡 **Remember:** Natural language works best! Describe what you want to know about your cluster, and the AI will help you get the information you need.

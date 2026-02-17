---
name: kubeview-debug
description: Debug and diagnose Kubernetes clusters using KubeView MCP server tools. Use when investigating cluster issues (pod crashes, deployment failures, service connectivity problems, node issues, resource constraints), performing cluster health checks, or troubleshooting any Kubernetes workload. Trigger phrases include "cluster health", "pod won't start", "CrashLoopBackOff", "service unreachable", "deployment stuck", "node pressure", "OOMKilled", "ImagePullBackOff".
---

# Kubernetes Cluster Debugging

Reusable investigation playbooks for debugging Kubernetes clusters using KubeView MCP.

## Core Principles

- **Read-Only**: Avoid state changes unless explicitly authorized.
- **Prefer MCP Tools**: Use `kube_*` tools over `kubectl` commands.
- **Security First**: Treat output as potentially sensitive.
- **Declarative Fixes**: Provide YAML snippets rather than imperative `kubectl` commands.

## Tool Quick Reference

- **Cluster & Workloads**: `kube_list`, `kube_get`, `kube_metrics`
- **Logs**: `kube_logs` (single pod), `kube_log` (multi-pod with filters + events)
- **Network**: `kube_net`, `kube_exec`, `kube_port`
- **Discovery**: `search_tools` (tools-mode), `run_code` (code-mode)

In code-mode, tools become `tools.kubernetes.*` (e.g., `tools.kubernetes.list`).

## Debugging Decision Tree

```
Issue reported
    │
    ├─ Pod not running? ──────────► Skill: Debug Pod Failures
    │
    ├─ Service unreachable? ──────► Skill: Debug Service Connectivity
    │
    ├─ Deployment stuck? ─────────► Skill: Debug Deployment Rollout
    │
    ├─ Node issues? ──────────────► Skill: Node Debugging
    │
    └─ Performance/Resources? ────► Skill: Resource Debugging
```

---

## Skill: Cluster Triage

**When**: Get high-level cluster health overview, identify problem areas.

**Trigger**: "cluster health", "triage the cluster", "what's wrong"

**Steps**:

1. **Cluster diagnostics**
   ```json
   { "tool": "kube_list", "args": {} }
   ```

2. **Metrics + top consumers**
   ```json
   { "tool": "kube_metrics", "args": { "diagnostics": true, "includeSummary": true, "topN": 5 } }
   ```

3. **Drill into problem namespaces**
   - Identify namespaces with high `CrashLoopBackOff` or `Pending` counts
   ```json
   { "tool": "kube_list", "args": { "namespace": "<ns>" } }
   ```

---

## Skill: Debug Pod Failures

**When**: Pod is Pending, CrashLoopBackOff, ImagePullBackOff, or OOMKilled.

**Trigger**: "pod won't start", "CrashLoopBackOff", "ImagePullBackOff", "OOMKilled"

**Steps**:

1. **Describe pod with events**
   ```json
   {
     "tool": "kube_get",
     "args": {
       "resourceType": "pod",
       "name": "<pod>",
       "namespace": "<ns>",
       "includeEvents": true,
       "includeDiagnostics": true
     }
   }
   ```

2. **Check logs (current & previous)**
   ```json
   {
     "tool": "kube_logs",
     "args": { "podName": "<pod>", "namespace": "<ns>", "tailLines": 100, "previous": true }
   }
   ```

3. **Common causes**:
   - **CrashLoopBackOff**:
     - Exit 1: App error (check logs)
     - Exit 137: OOMKilled (memory limit too low)
     - Exit 143: SIGTERM timeout
   - **ImagePullBackOff**: Check image name/tag, verify ImagePullSecrets
   - **Pending**: Insufficient resources, node affinity issues, or PVC binding failure

---

## Skill: Debug Deployment Rollout

**When**: Deployment has 0 ready replicas or rollout not progressing.

**Trigger**: "deployment stuck", "rollout not progressing", "0/1 ready"

**Steps**:

1. **Check deployment status**
   ```json
   {
     "tool": "kube_get",
     "args": {
       "resourceType": "deployment",
       "name": "<deploy>",
       "namespace": "<ns>",
       "includeEvents": true
     }
   }
   ```

2. **Inspect ReplicaSets** (Is new RS failing to create pods?)
   ```json
   {
     "tool": "kube_list",
     "args": { "resourceType": "replicaset", "namespace": "<ns>", "labelSelector": "<k=v>" }
   }
   ```

3. **Aggregate logs** (Are new pods failing immediately?)
   ```json
   {
     "tool": "kube_log",
     "args": {
       "namespace": "<ns>",
       "ownerKind": "Deployment",
       "ownerName": "<deploy>",
       "since": "30m",
       "includeEvents": true
     }
   }
   ```

**Common issues**:
- New ReplicaSet can't create pods (quota/errors?)
- Pods running but failing readiness probe
- Old ReplicaSets not cleaning up (strategy issue)

---

## Skill: Debug Service Connectivity

**When**: Service has no traffic, endpoints missing, or unreachable.

**Trigger**: "service unreachable", "no endpoints", "can't reach service"

**Steps**:

1. **Verify endpoints exist**
   ```json
   {
     "tool": "kube_get",
     "args": { "resourceType": "endpoints", "name": "<svc>", "namespace": "<ns>" }
   }
   ```
   - Empty? Check Service selector vs Pod labels. Are pods Ready?

2. **Test connectivity from cluster**
   ```json
   {
     "tool": "kube_net",
     "args": {
       "sourcePod": "<debug-pod>",
       "namespace": "<ns>",
       "targetService": "<svc>",
       "runServiceConnectivityTest": true,
       "runDnsTest": true
     }
   }
   ```

---

## Skill: Node Debugging

**When**: Node-level issues causing pod failures.

**Trigger**: "node not ready", "node pressure", "taints blocking pods"

**Steps**:

1. **List nodes**
   ```json
   { "tool": "kube_list", "args": { "resourceType": "node" } }
   ```

2. **Describe specific node**
   ```json
   { "tool": "kube_get", "args": { "resourceType": "node", "name": "<node>", "includeEvents": true } }
   ```

**Key conditions**:
- **Ready**: Must be `True`
- **MemoryPressure/DiskPressure/PIDPressure**: If `True`, node is evicting pods
- **NetworkUnavailable**: CNI plugin failure

---

## Skill: Resource Debugging

**When**: Detecting resource bottlenecks (CPU throttling, OOM).

**Trigger**: "CPU throttling", "memory pressure", "high CPU/memory"

**Steps**:

1. **Top consumers**
   ```json
   { "tool": "kube_metrics", "args": { "topN": 10, "includeSummary": true } }
   ```

2. **OOMKilled investigation**
   - Check `kube_get` pod status for `LastState: OOMKilled`
   - Solution: Increase memory limit or fix leak

3. **CPU throttling**
   - App slow but no errors? Check if usage near CPU limit
   - Solution: Increase CPU limit or remove limit (keep request)

---

## Advanced: Code Mode Bulk Analysis

**When**: Complex queries requiring logic (e.g., "find all pods without resource limits").

**Trigger**: "bulk analysis", "find pods without limits", "code mode"

**Example**:
```typescript
const pods = await tools.kubernetes.list({ resourceType: 'pod' });
const noLimits = pods.items.filter(p =>
  p.spec.containers.some(c => !c.resources?.limits)
);
return { count: noLimits.length, names: noLimits.map(p => p.metadata.name) };
```

---

## Multi-Step Investigation Hygiene

For complex investigations spanning multiple steps, use `plan_step` to maintain clear progress tracking:

```json
{
  "tool": "plan_step",
  "args": {
    "step": "Triage cluster health, then drill into failing namespace workloads",
    "stepNumber": 1,
    "totalSteps": 4,
    "nextStepNeeded": true
  }
}
```

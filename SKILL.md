# KubeView MCP Skills: Debugging Kubernetes Clusters

This document contains reusable investigation playbooks ("skills") for debugging Kubernetes clusters using the KubeView MCP server.

## Assumptions & Constraints

- **Read-Only by Design**: Avoid making state changes (edit, delete, scale) through these tools unless explicitly authorized.
- **Documentation**: Use `search_tools` to find new capabilities.
- **Prefer MCP Tools**: Use `kube_*` tools over shelling out to `kubectl`.
- **Security First**: Treat output as potentially sensitive.
- **Declarative over Imperative**: When suggesting fixes, provide YAML snippets rather than `kubectl patch/edit` commands.

## Tool Quick Map

- **Cluster + Workloads**: `kube_list`, `kube_get`, `kube_metrics`
- **Logs**: `kube_logs` (single pod), `kube_log` (multi-pod with filters + events)
- **Network**: `kube_net`, `kube_exec`, `kube_port`
- **Discovery**: `search_tools` (tools-mode), `run_code` (code-mode)

In code-mode (`run_code`), these become `tools.kubernetes.*` (e.g., `tools.kubernetes.list`).

---

## Debugging Decision Tree

```
Issue reported
    │
    ├─ Pod not running? ──────────► See: Debug a Pod that Won't Start
    │
    ├─ Service unreachable? ──────► See: Debug a Service With No Traffic
    │
    ├─ Deployment stuck? ─────────► See: Debug a Deployment
    │
    ├─ Node issues? ──────────────► See: Node Debugging
    │
    └─ Performance/Resources? ────► See: Resource Debugging
```

---

## Skill: Cluster Triage (fast)

**Intent**: Get a high-signal overview and decide where to drill down next.

**Procedure**:

1. **Cluster overview (diagnostics)**
   ```json
   { "tool": "kube_list", "args": {} }
   ```

2. **Metrics + diagnostics**
   ```json
   { "tool": "kube_metrics", "args": { "diagnostics": true, "includeSummary": true, "topN": 5 } }
   ```

3. **Identify "Worst" Namespaces** (if not obvious)
   - Look for high counts of `CrashLoopBackOff` or `Pending`.
   - List pods in that namespace:
   ```json
   { "tool": "kube_list", "args": { "namespace": "<ns>" } }
   ```

---

## Skill: Debug a Pod that Won't Start / CrashLoop

**Intent**: Identify why a pod is Pending / CrashLoopBackOff / ImagePullBackOff / OOMKilled.

**Procedure**:

1. **Describe the pod with events + diagnostics**
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

2. **Pull logs (current & previous)**
   ```json
   {
     "tool": "kube_logs",
     "args": { "podName": "<pod>", "namespace": "<ns>", "tailLines": 100, "previous": true }
   }
   ```

3. **Common Pod Issues Checklist**:
   - **CrashLoopBackOff**:
     - Exit Code 1: App error (check logs).
     - Exit Code 137: OOMKilled (check memory limits vs usage).
     - Exit Code 143: Graceful termination timeout or SIGTERM.
   - **ImagePullBackOff**:
     - Check image name/tag spelling.
     - Check ImagePullSecrets (registry auth).
   - **Pending**:
     - Insufficient CPU/Memory (Cluster full?).
     - Unsatisfiable Node Affinity/Selector.
     - PVC binding failure.

---

## Skill: Debug a Deployment / Rollout Not Progressing

**Intent**: Explain why a deployment has missing/zero ready replicas.

**Procedure**:

1. **Check Deployment Status & Conditions**
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

2. **Inspect ReplicaSets** (Is a new RS failing to spin up?)
   ```json
   {
     "tool": "kube_list",
     "args": { "resourceType": "replicaset", "namespace": "<ns>", "labelSelector": "<k=v>" }
   }
   ```

3. **Aggregate Logs** (See if new pods are failing immediately)
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

**Common Issues**:
- **Progressing Stuck**: New ReplicaSet can't create pods (quota? errors?).
- **Available < Desired**: Pods running but failing Readiness Probe.
- **Old ReplicaSets not cleaning up**: Deployment strategy issues.

---

## Skill: Debug a Service With No Traffic / No Endpoints

**Intent**: Determine if the issue is Selector, Pod Readiness, or Network Policy.

**Procedure**:

1. **Verify Endpoints Exist**
   ```json
   {
     "tool": "kube_get",
     "args": { "resourceType": "endpoints", "name": "<svc>", "namespace": "<ns>" }
   }
   ```
   - *Empty?* Check Service Selector vs Pod Labels. Are pods Ready?

2. **Test Connectivity from inside cluster**
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

**Intent**: Identify if node-level issues (Pressure, Taints) are causing pod failures.

**Procedure**:

1. **List Nodes & Status**
   ```json
   { "tool": "kube_list", "args": { "resourceType": "node" } }
   ```

2. **Describe Specific Node**
   ```json
   { "tool": "kube_get", "args": { "resourceType": "node", "name": "<node>", "includeEvents": true } }
   ```

**Conditions to Watch**:
- **Ready**: Must be `True`.
- **MemoryPressure / DiskPressure / PIDPressure**: If `True`, node is evicting/blocking pods.
- **NetworkUnavailable**: CNI plugin failure?

---

## Skill: Resource Debugging

**Intent**: Detect resource bottlenecks (CPU throttling, OOM).

**Procedure**:

1. **Top Pods/Nodes**
   ```json
   { "tool": "kube_metrics", "args": { "topN": 10, "includeSummary": true } }
   ```

2. **OOMKilled Investigation**
   - Check `kube_get` pod status for `LastState: OOMKilled`.
   - Solution: Increase Memory Limit or fix leak.

3. **CPU Throttling**
   - If app is slow but no errors: Check if usage is near CPU Limit.
   - Solution: Increase CPU Limit (or remove limit and keep request).

---

## Skill: Long Investigation Hygiene (using `plan_step`)

**Intent**: Keep multi-step debugging stable and reviewable.

**Template**:
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

---

## Skill: One-shot Code Mode Triage (Advanced)

**Intent**: Use `run_code` for complex logic (e.g., "Find all pods without resource limits").

**Example**:
```typescript
const pods = await tools.kubernetes.list({ resourceType: 'pod' });
const noLimits = pods.items.filter(p =>
  p.spec.containers.some(c => !c.resources?.limits)
);
return { count: noLimits.length, names: noLimits.map(p => p.metadata.name) };
```

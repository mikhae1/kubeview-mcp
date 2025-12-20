export type ToolNamespace = 'kubernetes' | 'helm' | 'argo' | 'argocd' | 'other';

export interface ToolNamespaceInfo {
  namespace: ToolNamespace;
  methodName: string;
}

// Order matters: more specific prefixes should come before less specific ones
// (e.g., 'argocd_' before 'argo_' to ensure correct matching)
const NAMESPACE_PREFIXES: Array<{ prefix: string; namespace: ToolNamespace }> = [
  { prefix: 'kube_', namespace: 'kubernetes' },
  { prefix: 'helm_', namespace: 'helm' },
  { prefix: 'argocd_', namespace: 'argocd' },
  { prefix: 'argo_', namespace: 'argo' },
];

export function getToolNamespace(toolName: string): ToolNamespaceInfo {
  let namespace: ToolNamespace = 'other';
  let normalized = toolName;

  for (const entry of NAMESPACE_PREFIXES) {
    if (toolName.startsWith(entry.prefix)) {
      namespace = entry.namespace;
      normalized = toolName.slice(entry.prefix.length);
      break;
    }
  }

  const methodName = toCamelCase(normalized);
  return { namespace, methodName };
}

export function toCamelCase(name: string): string {
  if (!name) return name;
  return name.replace(/_+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function formatToolAccessor(toolName: string): string {
  const { namespace, methodName } = getToolNamespace(toolName);
  return `tools.${namespace}.${methodName}`;
}

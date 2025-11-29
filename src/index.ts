#!/usr/bin/env node
/**
 * Kubernetes MCP Server
 * Main entry point for the Model Context Protocol server
 *
 * Modes (MCP_MODE env var):
 * - code: exposes only `run_code` for agent code execution
 * - tools: exposes only Kubernetes, Helm, and Argo tools (no `run_code`)
 * - all (default): exposes both tools and `run_code`
 *   per https://www.anthropic.com/engineering/code-execution-with-mcp
 */

import { Resource } from '@modelcontextprotocol/sdk/types.js';
import { MCPServer } from './server/MCPServer.js';
import { KubernetesToolsPlugin } from './plugins/KubernetesToolsPlugin.js';
import { HelmToolsPlugin } from './plugins/HelmToolsPlugin.js';
import { ArgoToolsPlugin } from './plugins/ArgoToolsPlugin.js';
import { ArgoCDToolsPlugin } from './plugins/ArgoCDToolsPlugin.js';
import { RunCodeTool } from './tools/RunCodeTool.js';

export { VERSION } from './version.js';

import { loadCodeModeConfig } from './utils/CodeModeConfig.js';

/**
 * Code-mode bootstrap: minimal surface with only `run_code` tool.
 * Follows progressive disclosure per Anthropic's MCP code execution approach.
 * Loads all plugins internally so run_code can execute tool calls.
 */
async function startCodeMode(server: MCPServer): Promise<void> {
  const config = loadCodeModeConfig();

  // Load all plugins internally (not exposed to MCP, but available for code execution)
  const internalServer = new MCPServer({
    skipTransportErrorHandling: true,
    skipGracefulShutdown: true,
  });

  const kubernetesPlugin = new KubernetesToolsPlugin();
  await internalServer.loadPlugin(kubernetesPlugin);

  const optionalPlugins = [new HelmToolsPlugin(), new ArgoToolsPlugin(), new ArgoCDToolsPlugin()];
  for (const plugin of optionalPlugins) {
    try {
      await internalServer.loadPlugin(plugin);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Optional plugin '${plugin.name}' skipped: ${message}`);
    }
  }

  // Create tool executor that calls internal tools
  // Strip server prefix from qualified names (e.g., "kubeview-mcp__kube_list" → "kube_list")
  const toolExecutor = async (qualifiedName: string, args: unknown) => {
    const toolName = qualifiedName.includes('__')
      ? qualifiedName.split('__').pop()!
      : qualifiedName;
    return internalServer.executeTool(toolName, args);
  };

  const runCodeTool = new RunCodeTool(config.sandbox);
  runCodeTool.setToolExecutor(toolExecutor);
  runCodeTool.setTools(internalServer.getTools());

  server.registerTool(runCodeTool.tool, (params) => runCodeTool.execute(params));

  // Register global.d.ts resource for type definitions
  server.registerResource({
    uri: 'file:///sys/global.d.ts',
    name: 'Global Type Definitions',
    mimeType: 'application/typescript',
    text: runCodeTool.generateGlobalDts(),
  } as Resource & { text: string });

  // Register code-mode prompt with tool overview and examples
  server.registerPrompt({
    name: 'code-mode',
    description:
      'Injects TypeScript definitions and API docs for Code Mode with tool overview and examples.',
    arguments: [],
    getMessages: async () => [
      {
        role: 'user',
        content: { type: 'text', text: runCodeTool.getPromptContent() },
      },
    ],
  });

  await server.start();
  console.error(
    `KubeView MCP is running in code-mode. ` +
      'Only `run_code` tool exposed; code can call all Kubernetes/Helm/Argo tools.',
  );
}

/**
 * Tools-only mode: loads all Kubernetes, Helm, Argo, and ArgoCD plugins without run_code.
 */
async function startToolsMode(server: MCPServer): Promise<void> {
  const kubernetesPlugin = new KubernetesToolsPlugin();
  await server.loadPlugin(kubernetesPlugin);

  const optionalPlugins = [new HelmToolsPlugin(), new ArgoToolsPlugin(), new ArgoCDToolsPlugin()];
  for (const plugin of optionalPlugins) {
    try {
      await server.loadPlugin(plugin);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Optional plugin '${plugin.name}' skipped: ${message}`);
    }
  }

  await server.start();
  console.error(`KubeView MCP is running in tools-mode. Only Kubernetes/Helm/Argo tools exposed.`);
}

/**
 * All mode: loads all Kubernetes, Helm, Argo, and ArgoCD plugins plus run_code.
 */
async function startAllMode(server: MCPServer): Promise<void> {
  const config = loadCodeModeConfig();

  const kubernetesPlugin = new KubernetesToolsPlugin();
  await server.loadPlugin(kubernetesPlugin);

  const optionalPlugins = [new HelmToolsPlugin(), new ArgoToolsPlugin(), new ArgoCDToolsPlugin()];
  for (const plugin of optionalPlugins) {
    try {
      await server.loadPlugin(plugin);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Optional plugin '${plugin.name}' skipped: ${message}`);
    }
  }

  // Set up run_code tool
  const toolExecutor = async (qualifiedName: string, args: unknown) => {
    return server.executeTool(qualifiedName, args);
  };

  const runCodeTool = new RunCodeTool(config.sandbox);
  runCodeTool.setToolExecutor(toolExecutor);

  // We need to set tools for the description builder.
  // In all mode, we can get them from the server after plugins are loaded.
  // However, server.getTools() returns Tool[], but setTools expects Tool[] which is fine.
  // But wait, RunCodeTool.setTools uses them to build the manifest for the description.
  // We should do this before registering the tool so the description is correct?
  // Actually, we can do it before starting the server.
  runCodeTool.setTools(server.getTools());

  server.registerTool(runCodeTool.tool, (params) => runCodeTool.execute(params));

  // Register global.d.ts resource for type definitions
  server.registerResource({
    uri: 'file:///sys/global.d.ts',
    name: 'Global Type Definitions',
    mimeType: 'application/typescript',
    text: runCodeTool.generateGlobalDts(),
  } as Resource & { text: string });

  // Register code-mode prompt with tool overview and examples
  server.registerPrompt({
    name: 'code-mode',
    description:
      'Injects TypeScript definitions and API docs for Code Mode with tool overview and examples.',
    arguments: [],
    getMessages: async () => [
      {
        role: 'user',
        content: { type: 'text', text: runCodeTool.getPromptContent() },
      },
    ],
  });

  await server.start();
  console.error(`KubeView MCP is running. Waiting for connections...`);
}

type MCPMode = 'code' | 'tools' | 'all';

function getMCPMode(): MCPMode {
  const mode = process.env.MCP_MODE?.toLowerCase();
  if (mode === 'code' || mode === 'tools' || mode === 'all') {
    return mode;
  }
  return 'all'; // default
}

export async function main(): Promise<void> {
  console.error(`Kubernetes MCP Server - Starting...`);

  try {
    const server = new MCPServer();
    const mode = getMCPMode();

    switch (mode) {
      case 'code':
        await startCodeMode(server);
        break;
      case 'tools':
        await startToolsMode(server);
        break;
      case 'all':
      default:
        await startAllMode(server);
        break;
    }
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

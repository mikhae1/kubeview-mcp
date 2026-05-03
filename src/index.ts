#!/usr/bin/env node
/**
 * Kubernetes MCP Server
 * Main entry point for the Model Context Protocol server.
 */

import { Resource } from '@modelcontextprotocol/sdk/types.js';
import { MCPServer } from './server/MCPServer.js';
import { StreamableHttpRuntime } from './server/StreamableHttpRuntime.js';
import { loadTransportConfig } from './server/TransportConfig.js';
import { KubernetesToolsPlugin } from './plugins/KubernetesToolsPlugin.js';
import { HelmToolsPlugin } from './plugins/HelmToolsPlugin.js';
import { ArgoToolsPlugin } from './plugins/ArgoToolsPlugin.js';
import { ArgoCDToolsPlugin } from './plugins/ArgoCDToolsPlugin.js';
import { RunCodeTool } from './tools/RunCodeTool.js';
import { loadCodeModeConfig } from './utils/CodeModeConfig.js';
import { VERSION } from './version.js';

export { VERSION };

type MCPMode = 'code' | 'tools' | 'all';

function getMCPMode(): MCPMode {
  const mode = process.env.MCP_MODE?.toLowerCase();
  if (mode === 'code' || mode === 'tools' || mode === 'all') {
    return mode;
  }
  return 'all';
}

async function loadOptionalPlugins(server: MCPServer): Promise<void> {
  const optionalPlugins = [new HelmToolsPlugin(), new ArgoToolsPlugin(), new ArgoCDToolsPlugin()];
  for (const plugin of optionalPlugins) {
    try {
      await server.loadPlugin(plugin);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Optional plugin '${plugin.name}' skipped: ${message}`);
    }
  }
}

async function configureCodeModeServer(server: MCPServer): Promise<void> {
  const config = loadCodeModeConfig();
  const internalServer = new MCPServer({
    skipTransportErrorHandling: true,
    skipGracefulShutdown: true,
  });

  await internalServer.loadPlugin(new KubernetesToolsPlugin());
  await loadOptionalPlugins(internalServer);

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
  server.registerResource({
    uri: 'file:///sys/global.d.ts',
    name: 'Global Type Definitions',
    mimeType: 'application/typescript',
    text: runCodeTool.generateGlobalDts(),
  } as Resource & { text: string });
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
}

async function configureToolsModeServer(server: MCPServer): Promise<void> {
  await server.loadPlugin(new KubernetesToolsPlugin());
  await loadOptionalPlugins(server);
}

async function configureAllModeServer(server: MCPServer): Promise<void> {
  await server.loadPlugin(new KubernetesToolsPlugin());
  await loadOptionalPlugins(server);

  const config = loadCodeModeConfig();
  const runCodeTool = new RunCodeTool(config.sandbox);
  runCodeTool.setToolExecutor(async (qualifiedName: string, args: unknown) =>
    server.executeTool(qualifiedName, args),
  );
  runCodeTool.setTools(server.getTools());

  server.registerTool(runCodeTool.tool, (params) => runCodeTool.execute(params));
  server.registerResource({
    uri: 'file:///sys/global.d.ts',
    name: 'Global Type Definitions',
    mimeType: 'application/typescript',
    text: runCodeTool.generateGlobalDts(),
  } as Resource & { text: string });
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
}

export async function createServerForMode(mode: MCPMode): Promise<MCPServer> {
  const server = new MCPServer();

  switch (mode) {
    case 'code':
      await configureCodeModeServer(server);
      break;
    case 'tools':
      await configureToolsModeServer(server);
      break;
    case 'all':
    default:
      await configureAllModeServer(server);
      break;
  }

  return server;
}

function getReadyMessage(mode: MCPMode): string {
  switch (mode) {
    case 'code':
      return 'KubeView MCP is running in code-mode. Only `run_code` tool exposed; code can call all Kubernetes/Helm/Argo tools.';
    case 'tools':
      return 'KubeView MCP is running in tools-mode. Only Kubernetes/Helm/Argo tools exposed.';
    case 'all':
    default:
      return 'KubeView MCP is running. Waiting for connections...';
  }
}

export async function main(): Promise<void> {
  console.error(`Kubernetes MCP Server v${VERSION} - Starting...`);

  try {
    const mode = getMCPMode();
    const transportConfig = loadTransportConfig();

    if (transportConfig.transport === 'http') {
      const runtime = new StreamableHttpRuntime(transportConfig.http, {
        createAppServer: () => createServerForMode(mode),
      });
      await runtime.start();

      const { host, port, path } = runtime.getAddress();
      runtime.logInfo(`${getReadyMessage(mode)} HTTP endpoint: http://${host}:${port}${path}`);
      return;
    }

    const server = await createServerForMode(mode);
    await server.start();
    console.error(getReadyMessage(mode));
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

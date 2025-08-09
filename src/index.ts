#!/usr/bin/env node
/**
 * Kubernetes MCP Server
 * Main entry point for the Model Context Protocol server
 */

import { MCPServer } from './server/MCPServer.js';
import { KubernetesToolsPlugin } from './plugins/KubernetesToolsPlugin.js';
import { HelmToolsPlugin } from './plugins/HelmToolsPlugin.js';
import { ArgoToolsPlugin } from './plugins/ArgoToolsPlugin.js';
import { ArgoCDToolsPlugin } from './plugins/ArgoCDToolsPlugin.js';

export const VERSION = '0.1.0';

export async function main(): Promise<void> {
  console.error(`Kubernetes MCP Server v${VERSION} - Starting...`);

  try {
    // Create and start the MCP server
    const server = new MCPServer();

    // Load the Kubernetes tools plugin
    const kubernetesPlugin = new KubernetesToolsPlugin();
    await server.loadPlugin(kubernetesPlugin);

    // Load optional plugins (do not fail server startup if they are unavailable)
    const optionalPlugins = [new HelmToolsPlugin(), new ArgoToolsPlugin(), new ArgoCDToolsPlugin()];

    for (const plugin of optionalPlugins) {
      try {
        await server.loadPlugin(plugin);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Log to stderr so hosts like Claude surface it, but continue startup
        console.error(`Optional plugin '${plugin.name}' failed to load: ${message}`);
      }
    }

    // Start the server
    await server.start();

    console.error('MCP Server is running. Waiting for connections...');
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

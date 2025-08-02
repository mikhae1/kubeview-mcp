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

    // Load the Helm tools plugin
    const helmPlugin = new HelmToolsPlugin();
    await server.loadPlugin(helmPlugin);

    // Load the Argo tools plugin
    const argoPlugin = new ArgoToolsPlugin();
    await server.loadPlugin(argoPlugin);

    // Load the ArgoCD tools plugin
    const argoCDPlugin = new ArgoCDToolsPlugin();
    await server.loadPlugin(argoCDPlugin);

    // Start the server
    await server.start();

    console.error('MCP Server is running. Waiting for connections...');
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

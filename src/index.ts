/**
 * Kubernetes MCP Server
 * Main entry point for the Model Context Protocol server
 */

import { MCPServer } from './server/MCPServer.js';
import { KubernetesToolsPlugin } from './plugins/KubernetesToolsPlugin.js';

export const VERSION = '0.1.0';

async function main() {
  console.log(`Kubernetes MCP Server v${VERSION} - Starting...`);

  try {
    // Create and start the MCP server
    const server = new MCPServer();

    // Load the Kubernetes tools plugin
    const kubernetesPlugin = new KubernetesToolsPlugin();
    await server.loadPlugin(kubernetesPlugin);

    // Start the server
    await server.start();

    console.log('MCP Server is running. Waiting for connections...');
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

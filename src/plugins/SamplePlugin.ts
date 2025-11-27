import { MCPPlugin, MCPServer } from '../server/MCPServer.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Sample plugin demonstrating how to extend MCP server functionality
 */
export class SamplePlugin implements MCPPlugin {
  name = 'sample-plugin';

  async initialize(server: MCPServer): Promise<void> {
    const logger = server.getLogger();
    logger.info(`Initializing ${this.name}`);

    // Register a sample tool
    const sampleTool: Tool = {
      name: 'sample-echo',
      description: 'A sample tool that echoes back the input',
      inputSchema: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Message to echo back',
          },
        },
        required: ['message'],
      },
    };

    server.registerTool(sampleTool, async (params) => {
      logger.info(`Sample plugin received: ${params.message}`);
      return {
        echo: params.message,
        timestamp: new Date().toISOString(),
        plugin: this.name,
      };
    });

    // Register a sample resource
    server.registerResource({
      uri: 'sample://plugin/info',
      name: 'Sample Plugin Info',
      description: 'Information about the sample plugin',
      mimeType: 'application/json',
    });

    logger.info(`${this.name} initialized successfully`);
  }

  async shutdown(): Promise<void> {
    // Cleanup logic here
    console.log(`${this.name} shutting down...`);
  }
}

// Export a factory function for easy plugin loading
export function createSamplePlugin(): SamplePlugin {
  return new SamplePlugin();
}

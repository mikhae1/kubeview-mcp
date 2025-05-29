import { MCPPlugin, MCPServer } from '../server/MCPServer.js';
import { KubernetesClient, KubernetesClientConfig } from '../kubernetes/KubernetesClient.js';
import {
  BaseCommand,
  ListPodsCommand,
  ListServicesCommand,
  ListDeploymentsCommand,
  GetResourceDetailsCommand,
  FetchContainerLogsCommand,
  ShowEventsCommand,
} from '../tools/kubernetes/index.js';

/**
 * Plugin that registers Kubernetes tools with the MCP server
 */
export class KubernetesToolsPlugin implements MCPPlugin {
  name = 'kubernetes-tools';
  version = '0.1.0';

  private client?: KubernetesClient;
  private commands: BaseCommand[] = [];

  constructor(private config?: KubernetesClientConfig) {}

  async initialize(server: MCPServer): Promise<void> {
    const logger = server.getLogger();

    try {
      // Initialize Kubernetes client
      this.client = new KubernetesClient({
        ...this.config,
        logger,
      });

      // Test connection
      const connected = await this.client.testConnection();
      if (!connected) {
        throw new Error('Failed to connect to Kubernetes cluster');
      }

      logger.info(`Connected to Kubernetes cluster: ${this.client.getCurrentContext()}`);

      // Initialize commands
      this.commands = [
        new ListPodsCommand(),
        new ListServicesCommand(),
        new ListDeploymentsCommand(),
        new GetResourceDetailsCommand(),
        new FetchContainerLogsCommand(),
        new ShowEventsCommand(),
      ];

      // Register each command with the server
      for (const command of this.commands) {
        server.registerTool(command.tool, async (params: any) =>
          command.execute(params, this.client!),
        );
        logger.info(`Registered tool: ${command.tool.name}`);
      }

      logger.info(`KubernetesToolsPlugin initialized with ${this.commands.length} tools`);
    } catch (error) {
      logger.error('Failed to initialize KubernetesToolsPlugin', error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      await this.client.dispose();
    }
  }
}

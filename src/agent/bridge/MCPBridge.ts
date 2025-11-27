import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ListToolsResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from 'winston';
import { PIITokenizer } from '../security/PIITokenizer.js';

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ToolRegistration {
  qualifiedName: string;
  server: string;
  toolName: string;
  tool: Tool;
}

export interface MCPBridgeOptions {
  enablePII?: boolean;
  logger?: Logger;
  defaultTimeoutMs?: number;
}

export class MCPBridge {
  private clients: Map<string, Client> = new Map();
  private toolRegistry: Map<string, ToolRegistration> = new Map();
  private piiTokenizer?: PIITokenizer;
  private toolDiscoveryCache: Map<string, Tool[]> = new Map();
  private configByServer: Map<string, MCPServerConfig> = new Map();

  constructor(
    private readonly configs: MCPServerConfig[],
    private readonly options: MCPBridgeOptions = {},
  ) {
    if (options.enablePII) {
      this.piiTokenizer = new PIITokenizer();
    }
  }

  public async initialize(): Promise<void> {
    for (const config of this.configs) {
      if (this.configByServer.has(config.name)) {
        throw new Error(`Duplicate MCP server name: ${config.name}`);
      }
      this.configByServer.set(config.name, config);
      await this.initializeServer(config);
    }
  }

  private async initializeServer(config: MCPServerConfig): Promise<void> {
    const envEntries = Object.entries({
      ...process.env,
      ...config.env,
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string');

    const mergedEnv = Object.fromEntries(envEntries);

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: mergedEnv,
    });

    const client = new Client(
      {
        name: 'kube-mcp-code-mode-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    );

    if (this.options.logger) {
      this.options.logger.info(`Connecting to MCP server '${config.name}'`);
    }

    await client.connect(transport);
    this.clients.set(config.name, client);

    const toolsResponse = await client.listTools();
    this.cacheToolMetadata(config.name, toolsResponse);
  }

  private cacheToolMetadata(serverName: string, toolsResponse: ListToolsResult): void {
    this.toolDiscoveryCache.set(serverName, toolsResponse.tools);

    for (const tool of toolsResponse.tools) {
      const qualifiedName = `${serverName}__${tool.name}`;
      this.toolRegistry.set(qualifiedName, {
        qualifiedName,
        server: serverName,
        toolName: tool.name,
        tool,
      });
    }
  }

  public getRegisteredTools(): ToolRegistration[] {
    return Array.from(this.toolRegistry.values());
  }

  public getToolMetadata(qualifiedName: string): ToolRegistration | undefined {
    return this.toolRegistry.get(qualifiedName);
  }

  public listServers(): string[] {
    return Array.from(this.clients.keys());
  }

  public listToolsForServer(serverName: string): Tool[] {
    return this.toolDiscoveryCache.get(serverName) ?? [];
  }

  public async callTool<T = any>(qualifiedName: string, args: any): Promise<T> {
    const registration = this.toolRegistry.get(qualifiedName);
    if (!registration) {
      throw new Error(`Tool ${qualifiedName} not found`);
    }

    const client = this.clients.get(registration.server);
    if (!client) {
      throw new Error(`Server ${registration.server} not connected`);
    }

    const sanitizedArgs = this.piiTokenizer ? this.piiTokenizer.tokenize(args) : args;

    const timeoutMs =
      this.configByServer.get(registration.server)?.timeoutMs ?? this.options.defaultTimeoutMs;
    const callPromise = client.callTool({
      name: registration.toolName,
      arguments: sanitizedArgs,
    });

    let result: Awaited<ReturnType<typeof client.callTool>>;
    if (timeoutMs && timeoutMs > 0) {
      result = await this.withTimeout(callPromise, timeoutMs, qualifiedName);
    } else {
      result = await callPromise;
    }

    const detokenized = this.piiTokenizer ? this.piiTokenizer.detokenize(result) : result;
    return detokenized as T;
  }

  public async close(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
    this.toolRegistry.clear();
    this.toolDiscoveryCache.clear();
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MCPPlugin, MCPServer } from '../server/MCPServer.js';

const DEFAULT_TIMEOUT_MS = 30000;

export interface ToolLike {
  tool: Tool;
}

/**
 * Generic base plugin to reduce duplication across tool plugins.
 * Subclasses should implement creation of tool instances and optionally override
 * validation, disabling, and per-tool handler wrapping.
 */
export abstract class BaseToolsPlugin<TTool extends ToolLike> implements MCPPlugin {
  abstract name: string;
  abstract version: string;

  protected commands: TTool[] = [];
  protected logger?: MCPServer['logger'];
  protected commandMap: Map<string, TTool> = new Map();

  /** Create tool instances for this plugin */
  protected abstract createToolInstances(): TTool[];

  /** Optional: validate external dependencies (e.g., CLIs) before registration */

  protected async validate(): Promise<void> {}

  /** Optional: allow disabling a plugin via env var */
  protected isDisabled(): boolean {
    return false;
  }

  /** Optional: custom wrapping for tool handlers */

  protected getHandlerForTool(_tool: TTool): (params: any) => Promise<any> {
    // Default: pass params straight to tool.execute if available
    // Subclasses should override this method to adapt to their tool signature
    const anyTool = _tool as unknown as { execute?: (params: any) => Promise<any> };
    if (!anyTool.execute) {
      throw new Error('Tool does not implement execute(params)');
    }
    return async (params: any) => {
      const timeoutMs = this.computeGlobalTimeoutMs(params);
      const execPromise = anyTool.execute!(params);
      const label = (_tool as unknown as ToolLike).tool?.name || 'tool';
      return this.withTimeout(execPromise, timeoutMs, label);
    };
  }

  /** Build the internal command map */
  protected buildCommandMap(): void {
    this.commandMap.clear();
    for (const command of this.commands) {
      this.commandMap.set(command.tool.name, command);
    }
  }

  /** Execute a command by name using the plugin's instances */
  protected async runCommandByName(
    commandName: string,
    params: Record<string, unknown>,
  ): Promise<any> {
    const command = this.commandMap.get(commandName);
    if (!command) {
      throw new Error(`Unknown tool: ${commandName}`);
    }
    const handler = this.getHandlerForTool(command);
    return handler(params);
  }

  async initialize(server: MCPServer): Promise<void> {
    this.logger = server.getLogger();

    try {
      if (this.isDisabled()) {
        this.logger.info(`${this.name} is disabled via environment variable`);
        this.commands = [];
        this.commandMap.clear();
        return;
      }

      await this.validate();

      this.commands = this.createToolInstances();
      this.buildCommandMap();

      for (const command of this.commands) {
        server.registerTool(command.tool, async (params: any) => {
          const handler = this.getHandlerForTool(command);
          return handler(params);
        });
      }

      this.logger.info(`${this.constructor.name} initialized with ${this.commands.length} tools.`);
    } catch (error) {
      this.logger.error(`Failed to initialize ${this.constructor.name}`, error);
      throw error;
    }
  }

  getToolFunction(toolName: string): ((params: any) => Promise<any>) | undefined {
    const command = this.commandMap.get(toolName);
    if (!command) return undefined;
    return async (params: any) => {
      const handler = this.getHandlerForTool(command);
      return handler(params);
    };
  }

  async shutdown(): Promise<void> {}

  /** Determine the global timeout in ms from params or env (TIMEOUT) */
  protected computeGlobalTimeoutMs(params: any): number | undefined {
    const paramTimeout =
      params && typeof params.timeoutMs === 'number' ? params.timeoutMs : undefined;
    const envTimeout = process.env.TIMEOUT
      ? parseInt(process.env.TIMEOUT, DEFAULT_TIMEOUT_MS)
      : undefined;
    const timeoutMs = paramTimeout ?? envTimeout;
    return Number.isFinite(timeoutMs as number) && (timeoutMs as number) > 0
      ? (timeoutMs as number)
      : undefined;
  }

  /** Wrap a promise with a timeout if provided */
  protected async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs?: number,
    label?: string,
  ): Promise<T> {
    if (!timeoutMs) return promise;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label || 'operation'} timed out after ${timeoutMs}ms`));
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

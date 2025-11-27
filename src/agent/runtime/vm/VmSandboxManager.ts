import vm from 'node:vm';
import { promises as fs } from 'fs';
import path from 'path';
import type { MCPBridge } from '../../bridge/MCPBridge.js';
import { NodeVmCodeExecutor } from '../code-executor/NodeVmCodeExecutor.js';
import type { SandboxOptions, SandboxRuntime } from '../types.js';

export class VmSandboxManager implements SandboxRuntime {
  private context?: vm.Context;
  private initialized = false;

  constructor(
    private readonly bridge: MCPBridge,
    private readonly options: SandboxOptions,
  ) {}

  public async run(entryFile: string): Promise<void> {
    if (!this.initialized || !this.context) {
      await this.initialize();
    }

    if (!this.context) {
      throw new Error('Sandbox initialization failed');
    }

    const executor = new NodeVmCodeExecutor(this.context, {
      workspaceDir: this.options.workspaceDir,
      timeoutMs: this.options.timeoutMs,
      logger: this.options.logger,
    });

    executor.execute(entryFile);
  }

  public async dispose(): Promise<void> {
    this.context = undefined;
    this.initialized = false;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const context = vm.createContext({});
    context.global = context;
    context.globalThis = context;

    this.context = context;

    await this.bootstrapConsole();
    await this.bootstrapCallTool();
    await this.bootstrapWorkspaceFs();
    await this.bootstrapToolHelpers();

    this.initialized = true;
  }

  private async bootstrapConsole(): Promise<void> {
    if (!this.context) {
      throw new Error('Sandbox not initialized');
    }

    // Output directly to stdout/stderr for sandbox code visibility
    const proxy = {
      log: (...args: unknown[]) => {
        const message = args
          .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, null, 2)))
          .join(' ');
        process.stdout.write(message + '\n');
      },
      info: (...args: unknown[]) => {
        const message = args
          .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, null, 2)))
          .join(' ');
        process.stdout.write(message + '\n');
      },
      warn: (...args: unknown[]) => {
        const message = args
          .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, null, 2)))
          .join(' ');
        process.stderr.write('[WARN] ' + message + '\n');
      },
      error: (...args: unknown[]) => {
        const message = args
          .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, null, 2)))
          .join(' ');
        process.stderr.write('[ERROR] ' + message + '\n');
      },
    };

    this.context.console = proxy;
  }

  private async bootstrapCallTool(): Promise<void> {
    if (!this.context) {
      throw new Error('Sandbox not initialized');
    }

    const callTool = async (qualifiedName: string, args: unknown) => {
      return this.bridge.callTool(qualifiedName, args);
    };

    Object.defineProperty(this.context, '__callMCPTool', {
      value: callTool,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  }

  private async bootstrapWorkspaceFs(): Promise<void> {
    if (!this.context) {
      throw new Error('Sandbox not initialized');
    }

    const root = path.resolve(this.options.workspaceDir);
    await fs.mkdir(root, { recursive: true });

    const api = {
      readFile: (target: string) => fs.readFile(this.resolveWorkspacePath(root, target), 'utf-8'),
      writeFile: (target: string, data: string) =>
        fs.writeFile(this.resolveWorkspacePath(root, target), data ?? '', 'utf-8'),
      listDir: (dir?: string) => fs.readdir(this.resolveWorkspacePath(root, dir ?? '.')),
      exists: async (target: string) => {
        try {
          await fs.access(this.resolveWorkspacePath(root, target));
          return true;
        } catch {
          return false;
        }
      },
    };

    Object.defineProperty(this.context, '__workspaceFs', {
      value: api,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  }

  private resolveWorkspacePath(root: string, targetPath: string | undefined): string {
    const candidate = path.resolve(root, targetPath ?? '.');
    if (!candidate.startsWith(root)) {
      throw new Error('Workspace access outside of root is not allowed');
    }
    return candidate;
  }

  /**
   * Bootstrap tool helper functions into the sandbox context.
   * This injects typed helpers for all registered MCP tools.
   */
  private async bootstrapToolHelpers(): Promise<void> {
    if (!this.context) {
      throw new Error('Sandbox not initialized');
    }

    const tools = this.bridge.getRegisteredTools();
    const servers = this.bridge.listServers();

    // Inject tool metadata
    const toolMetadata = tools.map((t) => ({
      server: t.server,
      name: t.toolName,
      qualifiedName: t.qualifiedName,
      description: t.tool.description,
    }));

    // Helper functions
    this.context.listServers = () => servers;
    this.context.listTools = (server?: string) => {
      if (!server) return toolMetadata;
      return toolMetadata.filter((t) => t.server === server);
    };
    this.context.searchTools = (query: string, limit = 10) => {
      const q = (query || '').toLowerCase();
      return toolMetadata
        .filter(
          (t) =>
            t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q),
        )
        .slice(0, limit);
    };

    // Inject typed tool wrapper functions
    const callTool = this.context.__callMCPTool as (
      name: string,
      args: unknown,
    ) => Promise<unknown>;
    for (const tool of tools) {
      const fnName = this.toCamelCase(tool.toolName);
      this.context[fnName] = (input: unknown) => callTool(tool.qualifiedName, input ?? {});
    }
  }

  private toCamelCase(name: string): string {
    return name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }
}

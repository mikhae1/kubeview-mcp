import vm from 'node:vm';
import { promises as fs } from 'fs';
import path from 'path';
import {
  getToolNamespace,
  toCamelCase,
  formatToolAccessor,
} from '../../../utils/toolNamespaces.js';
import type { MCPBridge, ToolRegistration } from '../../bridge/MCPBridge.js';
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
    await this.bootstrapFsNamespace();
    await this.bootstrapToolsNamespace();

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

  private async bootstrapFsNamespace(): Promise<void> {
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

    this.context.fs = {
      readFile: api.readFile,
      writeFile: api.writeFile,
      listDir: api.listDir,
      exists: api.exists,
    };
  }

  private resolveWorkspacePath(root: string, targetPath: string | undefined): string {
    const candidate = path.resolve(root, targetPath ?? '.');
    if (!candidate.startsWith(root)) {
      throw new Error('Workspace access outside of root is not allowed');
    }
    return candidate;
  }

  /**
   * Bootstrap the namespaced tools helper into the sandbox context.
   */
  private async bootstrapToolsNamespace(): Promise<void> {
    if (!this.context) {
      throw new Error('Sandbox not initialized');
    }

    const tools: ToolRegistration[] = this.bridge.getRegisteredTools();
    const toolMetadata = tools.map((t) => ({
      server: t.server,
      name: t.toolName,
      camelName: toCamelCase(t.toolName),
      qualifiedName: t.qualifiedName,
      description: t.tool.description,
      schema: t.tool.inputSchema,
    }));

    const callTool = this.context.__callMCPTool as (
      name: string,
      args: unknown,
    ) => Promise<unknown>;

    const namespaces: Record<string, Record<string, (input: unknown) => Promise<unknown>>> = {
      kubernetes: {},
      helm: {},
      argo: {},
      argocd: {},
      other: {},
    };

    for (const tool of tools) {
      const { namespace, methodName } = getToolNamespace(tool.toolName);
      namespaces[namespace][methodName] = (input: unknown) =>
        callTool(tool.qualifiedName, input ?? {});
    }

    const list = (server?: string) => {
      const filtered = server ? toolMetadata.filter((t) => t.server === server) : toolMetadata;
      return filtered.map((t) => ({
        ...t,
        name: formatToolAccessor(t.name),
      }));
    };

    const search = (query: string, limit = 10) => {
      const q = (query || '').toLowerCase();
      return toolMetadata
        .filter(
          (t) =>
            t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q),
        )
        .slice(0, limit);
    };

    const help = (toolName: string) => {
      if (!toolName) return null;
      const normalized = toolName.replace(/([A-Z])/g, '_$1').toLowerCase();
      const match = toolMetadata.find(
        (tool) =>
          tool.name === normalized ||
          tool.name === toolName ||
          tool.camelName === toolName ||
          tool.camelName === toCamelCase(toolName),
      );

      if (!match) {
        return null;
      }

      const registration = tools.find((t) => t.qualifiedName === match.qualifiedName);
      const parameters = registration ? this.buildParameterDocs(registration.tool.inputSchema) : [];

      return {
        name: match.name,
        qualifiedName: match.qualifiedName,
        description: match.description,
        parameters,
      };
    };

    this.context.tools = {
      kubernetes: namespaces.kubernetes,
      helm: namespaces.helm,
      argo: namespaces.argo,
      argocd: namespaces.argocd,
      other: namespaces.other,
      list,
      search,
      help,
      call: (qualifiedName: string, args?: Record<string, unknown>) =>
        callTool(qualifiedName, args ?? {}),
      servers: () => this.bridge.listServers(),
    };
  }

  private buildParameterDocs(schema: any): Array<{
    name: string;
    type: string;
    required: boolean;
    description?: string;
  }> {
    if (!schema || schema.type !== 'object' || !schema.properties) {
      return [];
    }

    return Object.entries(schema.properties).map(([name, prop]) => {
      const typed = prop as { description?: string; type?: string };
      return {
        name,
        required: Array.isArray(schema.required) ? schema.required.includes(name) : false,
        type: this.schemaTypeFromJson(typed),
        description: typed.description,
      };
    });
  }

  private schemaTypeFromJson(schema: any): string {
    if (!schema) return 'any';
    if (schema.type === 'array') {
      return `${this.schemaTypeFromJson(schema.items)}[]`;
    }
    if (schema.type === 'object') {
      return 'object';
    }
    if (Array.isArray(schema.enum)) {
      return schema.enum.map((value: string) => `'${value}'`).join(' | ');
    }
    return schema.type ?? 'any';
  }
}

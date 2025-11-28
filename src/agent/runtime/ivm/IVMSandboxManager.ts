import ivm from 'isolated-vm';
import { promises as fs } from 'fs';
import path from 'path';
import type { MCPBridge } from '../../bridge/MCPBridge.js';
import { getToolNamespace, toCamelCase } from '../../../utils/toolNamespaces.js';
import { CodeExecutor } from '../code-executor/CodeExecutor.js';
import type { SandboxOptions, SandboxRuntime } from '../types.js';

export class IVMSandboxManager implements SandboxRuntime {
  private isolate?: ivm.Isolate;
  private context?: ivm.Context;
  private initialized = false;

  constructor(
    private readonly bridge: MCPBridge,
    private readonly options: SandboxOptions,
  ) {}

  private get logger() {
    return this.options.logger ?? console;
  }

  private get timeout(): number {
    return this.options.timeoutMs ?? 1000;
  }

  private get memoryLimit(): number {
    return this.options.memoryLimitMb ?? 256;
  }

  public async run(entryFile: string): Promise<void> {
    if (!this.initialized || !this.isolate || !this.context) {
      await this.initialize();
    }
    if (!this.isolate || !this.context) {
      throw new Error('Sandbox initialization failed');
    }

    const executor = new CodeExecutor(this.isolate, this.context, {
      workspaceDir: this.options.workspaceDir,
      timeoutMs: this.options.timeoutMs,
      logger: this.options.logger,
    });

    await executor.execute(entryFile);
  }

  public async dispose(): Promise<void> {
    this.initialized = false;
    if (this.context) {
      await this.context.release();
      this.context = undefined;
    }
    if (this.isolate) {
      this.isolate.dispose();
      this.isolate = undefined;
    }
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.isolate = new ivm.Isolate({
      memoryLimit: this.memoryLimit,
    });

    this.context = await this.isolate.createContext();
    const jail = this.context.global;

    await jail.set('global', jail.derefInto());
    await jail.set('globalThis', jail.derefInto());

    await this.bootstrapConsole();
    await this.bootstrapCallTool();
    await this.bootstrapWorkspaceFs();
    await this.bootstrapToolsNamespace();

    this.initialized = true;
  }

  private async bootstrapConsole(): Promise<void> {
    if (!this.context || !this.isolate) {
      throw new Error('Sandbox not initialized');
    }

    const consoleBridge = new ivm.Reference((level: string, ...args: unknown[]) => {
      const message = args
        .map((arg) => {
          try {
            return typeof arg === 'string' ? arg : JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        })
        .join(' ');

      switch (level) {
        case 'error':
          this.logger.error?.(message);
          break;
        case 'warn':
          this.logger.warn?.(message);
          break;
        case 'info':
          this.logger.info?.(message);
          break;
        default:
          this.logger.debug?.(message);
          break;
      }
    });

    await this.context.global.set('__consoleBridge', consoleBridge);
    await this.context.eval(
      `
        (() => {
          const bridge = globalThis.__consoleBridge;
          const levels = ['log', 'info', 'warn', 'error'];
          const proxy = {};
          for (const level of levels) {
            proxy[level] = (...args) => bridge.apply(undefined, [level, ...args], { arguments: { copy: true } });
          }
          globalThis.console = proxy;
        })();
      `,
      { timeout: this.timeout },
    );
  }

  private async bootstrapCallTool(): Promise<void> {
    if (!this.context) {
      throw new Error('Sandbox not initialized');
    }

    const callToolRef = new ivm.Reference(async (qualifiedName: string, args: unknown) => {
      return this.bridge.callTool(qualifiedName, args);
    });

    await this.context.global.set('__callMCPToolBridge', callToolRef);
    await this.context.eval(
      `
        globalThis.__callMCPTool = (qualifiedName, args) => {
          const bridge = globalThis.__callMCPToolBridge;
          return bridge.apply(undefined, [qualifiedName, args], {
            arguments: { copy: true },
            result: { promise: true }
          });
        };
      `,
      { timeout: this.timeout },
    );
  }

  private async bootstrapWorkspaceFs(): Promise<void> {
    if (!this.context) {
      throw new Error('Sandbox not initialized');
    }

    const root = path.resolve(this.options.workspaceDir);
    await fs.mkdir(root, { recursive: true });

    const bridge = new ivm.Reference(async (method: string, payload?: any) => {
      switch (method) {
        case 'readFile':
          return fs.readFile(this.resolveWorkspacePath(root, payload?.path), 'utf-8');
        case 'writeFile':
          return fs.writeFile(
            this.resolveWorkspacePath(root, payload?.path),
            payload?.data ?? '',
            'utf-8',
          );
        case 'listDir': {
          const dir = this.resolveWorkspacePath(root, payload?.path ?? '.');
          return fs.readdir(dir);
        }
        case 'exists': {
          try {
            await fs.access(this.resolveWorkspacePath(root, payload?.path));
            return true;
          } catch {
            return false;
          }
        }
        default:
          throw new Error(`Unsupported workspace fs method: ${method}`);
      }
    });

    await this.context.global.set('__workspaceFsBridge', bridge);
    await this.context.eval(
      `
        globalThis.__workspaceFs = {
          readFile: (path) =>
            globalThis.__workspaceFsBridge.apply(undefined, ['readFile', { path }], {
              arguments: { copy: true },
              result: { promise: true },
            }),
          writeFile: (path, data) =>
            globalThis.__workspaceFsBridge.apply(undefined, ['writeFile', { path, data }], {
              arguments: { copy: true },
              result: { promise: true },
            }),
          listDir: (path) =>
            globalThis.__workspaceFsBridge.apply(undefined, ['listDir', { path }], {
              arguments: { copy: true },
              result: { promise: true },
            }),
          exists: (path) =>
            globalThis.__workspaceFsBridge.apply(undefined, ['exists', { path }], {
              arguments: { copy: true },
              result: { promise: true },
            }),
        };

        globalThis.fs = {
          readFile: (path) => globalThis.__workspaceFs.readFile(path),
          writeFile: (path, data) => globalThis.__workspaceFs.writeFile(path, data),
          listDir: (path) => globalThis.__workspaceFs.listDir(path),
          exists: (path) => globalThis.__workspaceFs.exists(path),
        };
      `,
      { timeout: this.timeout },
    );
  }

  private resolveWorkspacePath(root: string, targetPath: string | undefined): string {
    const candidate = path.resolve(root, targetPath ?? '.');
    if (!candidate.startsWith(root)) {
      throw new Error('Workspace access outside of root is not allowed');
    }
    return candidate;
  }

  private async bootstrapToolsNamespace(): Promise<void> {
    if (!this.context || !this.isolate) {
      throw new Error('Sandbox not initialized');
    }

    const registrations = this.bridge.getRegisteredTools();
    const entries = registrations.map((tool) => {
      const { namespace, methodName } = getToolNamespace(tool.toolName);
      return {
        server: tool.server,
        name: tool.toolName,
        camelName: toCamelCase(tool.toolName),
        qualifiedName: tool.qualifiedName,
        description: tool.tool.description,
        namespace,
        methodName,
        parameters: this.buildParameterDocs(tool.tool.inputSchema),
      };
    });

    const copy = new ivm.ExternalCopy(entries);
    await this.context.global.set('__toolNamespaceConfig', copy.copyInto());
    copy.release?.();

    await this.context.eval(
      `
        (() => {
          const entries = globalThis.__toolNamespaceConfig || [];
          const namespaces = {
            kubernetes: {},
            helm: {},
            argo: {},
            argocd: {},
            other: {},
          };

          for (const entry of entries) {
            if (!namespaces[entry.namespace]) namespaces[entry.namespace] = {};
            namespaces[entry.namespace][entry.methodName] = (args) =>
              globalThis.__callMCPTool(entry.qualifiedName, args ?? {});
          }

          const summaries = entries.map(
            ({ server, name, qualifiedName, description, camelName, parameters, namespace, methodName }) => ({
              server,
              name: 'tools.' + namespace + '.' + methodName,
              qualifiedName,
              description,
              camelName,
              parameters: parameters ?? [],
            }),
          );

          const camelCase = (value) =>
            value.replace(/_([a-zA-Z0-9])/g, (_, c) => (c ? c.toUpperCase() : ''));

          const findTool = (toolName) => {
            if (!toolName) return undefined;
            const normalized = toolName.replace(/([A-Z])/g, '_$1').toLowerCase();
            return summaries.find(
              (tool) =>
                tool.name === normalized ||
                tool.name === toolName ||
                tool.camelName === toolName ||
                tool.camelName === camelCase(toolName),
            );
          };

          globalThis.tools = {
            kubernetes: namespaces.kubernetes,
            helm: namespaces.helm,
            argo: namespaces.argo,
            argocd: namespaces.argocd,
            other: namespaces.other,
            list: (server) => (server ? summaries.filter((t) => t.server === server) : summaries),
            search: (query, limit = 10) => {
              const q = (query || '').toLowerCase();
              return summaries
                .filter(
                  (t) =>
                    t.name.toLowerCase().includes(q) ||
                    (t.description ?? '').toLowerCase().includes(q),
                )
                .slice(0, limit);
            },
            help: (toolName) => {
              const tool = findTool(toolName);
              if (!tool) return null;
              return {
                name: tool.name,
                qualifiedName: tool.qualifiedName,
                description: tool.description,
                parameters: tool.parameters,
              };
            },
            call: (qualifiedName, args) => globalThis.__callMCPTool(qualifiedName, args ?? {}),
            servers: () => Array.from(new Set(summaries.map((t) => t.server))),
          };
        })();
      `,
      { timeout: this.timeout },
    );
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

    return Object.entries(schema.properties).map(([name, prop]) => ({
      name,
      required: Array.isArray(schema.required) ? schema.required.includes(name) : false,
      description: (prop as any)?.description,
      type: this.schemaTypeFromJson(prop),
    }));
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

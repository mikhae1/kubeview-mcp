import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { promises as fsPromises, readFileSync } from 'fs';
import path from 'path';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { ToolDescriptionBuilder } from '../agent/codegen/ToolDescriptionBuilder.js';
import type {
  NormalizedSchema,
  ToolSchemaSummary,
  NormalizedObjectType,
  NormalizedEnumType,
  NormalizedArrayType,
} from '../agent/codegen/types.js';
import { CodeModeConfig } from '../utils/CodeModeConfig.js';
import { getToolNamespace, toCamelCase, formatToolAccessor } from '../utils/toolNamespaces.js';
import type { ToolNamespace } from '../utils/toolNamespaces.js';

const runCodeInputSchema = z.object({
  code: z.string().describe('TypeScript code to execute via the sandboxed runtime'),
  input: z.string().optional().describe('Optional stdin payload for your script'),
});

type RunCodeInput = z.infer<typeof runCodeInputSchema>;

interface ManifestEntry {
  server: string;
  tools: Array<{
    name: string;
    qualifiedName: string;
    description?: string;
    inputSchema?: NormalizedSchema;
  }>;
}

interface ToolMetadata {
  server: string;
  name: string;
  qualifiedName: string;
  description?: string;
  inputSchema?: NormalizedSchema;
}

type ToolExecutor = (toolName: string, args: unknown) => Promise<unknown>;

/**
 * Exposes a single `run_code` tool for code-mode MCP servers.
 * Following Anthropic's code execution with MCP approach:
 * https://www.anthropic.com/engineering/code-execution-with-mcp
 */
export class RunCodeTool {
  private readonly manifestPath: string;
  private cachedManifest: ManifestEntry[] | null = null;
  private toolExecutor?: ToolExecutor;
  private readonly descriptionBuilder = new ToolDescriptionBuilder();
  private readonly config: CodeModeConfig['sandbox'];
  private readonly sandboxWorkspaceDir = path.resolve(process.cwd(), '.run_code_workspace');
  private workspaceReady = false;

  constructor(
    config: CodeModeConfig['sandbox'] = { memoryLimitMb: 256, timeoutMs: 5000 },
    manifestPath?: string,
  ) {
    this.config = config;
    this.manifestPath =
      manifestPath ?? path.resolve(process.cwd(), 'generated/servers/manifest.json');
    this.tool = this.createToolDefinition();
  }

  public readonly tool: Tool;

  /**
   * Set the tool executor for running MCP tools from within sandboxed code.
   */
  public setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor;
  }

  private createToolDefinition(): Tool {
    return {
      name: 'run_code',
      description: this.buildDescription(),
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description:
              'TypeScript code to execute via the sandboxed runtime. Top-level await is supported.',
          },
        },
        required: ['code'],
      },
    };
  }

  async execute(rawParams: RunCodeInput) {
    const params = runCodeInputSchema.parse(rawParams);
    const { code } = params;

    const manifest = this.loadManifestSync();
    const toolMetadata = this.buildToolMetadata(manifest);
    await this.ensureSandboxWorkspace();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const context = vm.createContext({
      console: this.createConsoleCapture(stdout, stderr),
      tools: this.createToolsNamespace(toolMetadata),
      fs: this.createFsNamespace(),
    });

    // Wrap code in async IIFE
    const wrappedCode = `
(async () => {
${code}
})();
`;

    // Transpile TypeScript to JavaScript
    const transpiled = ts.transpileModule(wrappedCode, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;

    try {
      const script = new vm.Script(transpiled, { filename: 'agent-code.js' });
      const evaluation = script.runInContext(context, { timeout: this.config.timeoutMs ?? 30000 });
      const result = await evaluation;

      return this.buildResponse({
        success: true,
        result,
        stdout,
        stderr,
      });
    } catch (err) {
      const serializedError = this.serializeError(err);
      return this.buildResponse({
        success: false,
        error: serializedError,
        stdout,
        stderr,
        isError: true,
      });
    }
  }

  /**
   * Unwrap common list response formats to make the API easier to use.
   * Normalizes various response formats to { items: [...] } to match Kubernetes API standard format.
   * Handles:
   * - Arrays returned directly -> { items: [...] }
   * - { pods: [...] }, { services: [...] }, etc. -> { items: [...] }
   * - { items: [...] } -> returned as-is
   */
  private unwrapResult(result: any): any {
    // If result is an array, wrap it in { items: [...] }
    if (Array.isArray(result)) {
      return { items: result };
    }

    if (!result || typeof result !== 'object') return result;

    // If it already has 'items', return as-is (already in standard format)
    if (Array.isArray(result.items)) {
      return result;
    }

    // Check for common collection properties and normalize to { items: [...] }
    const collectionProps = [
      'pods',
      'services',
      'deployments',
      'nodes',
      'namespaces',
      'persistentvolumes',
      'persistentvolumeclaims',
      'secrets',
      'configmaps',
      'replicasets',
      'statefulsets',
      'daemonsets',
      'jobs',
      'cronjobs',
      'hpas',
      'pdbs',
      'endpoints',
      'endpointslices',
      'resourcequotas',
      'limitranges',
    ];

    for (const prop of collectionProps) {
      if (Array.isArray(result[prop])) {
        // Convert { pods: [...] } to { items: [...] } for consistency
        return { items: result[prop] };
      }
    }

    return result;
  }

  private getToolSchemaSummaries(): ToolSchemaSummary[] {
    const manifest = this.loadManifestSync();
    return manifest.flatMap((entry) =>
      entry.tools.map((tool) => ({
        qualifiedName: tool.qualifiedName,
        server: entry.server,
        toolName: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    );
  }

  private buildDescription(): string {
    const tools = this.getToolSchemaSummaries();
    const overviewTree = this.descriptionBuilder.buildOverviewTree(tools);

    return `This tool allows you to debug, list, get and interact with the Kubernetes cluster using TypeScript code.

## Environment
- **Runtime**: Node.js (vm)
- **Language**: TypeScript (transpiled to ES2022)
- **Global Object**: \`tools\` (contains all available MCP tools)
- **Top-level await**: Supported, use \`return\` to return values from your script.

## API Reference
The \`tools\` object is namespaced by plugin/category.
Reference \`/sys/global.d.ts\` to see the exact TypeScript interfaces for the tools object.

${overviewTree}

## Key Functions

### Helper Functions
- **\`tools.list(server?)\`** - Enumerate tools (optionally filtered by server)
- **\`tools.search(query, limit?)\`** - Search for tools by name or description
- **\`tools.help(toolName)\`** - Detailed documentation for a specific tool
- **\`tools.call(qualifiedName, args)\`** - Call any MCP tool by its qualified name

### Tool Access
Call tools via namespaces: \`tools.kubernetes.list()\`, \`tools.helm.get()\`, \`tools.argo.logs()\`, \`tools.argocd.app()\`, \`tools.other.*\`.

## Quick Start

\`\`\`typescript
// Search for available tools
const matches = tools.search('pods');

// Inspect a specific tool
const docs = tools.help('kubeList');

// Call helper functions directly and return data
const pods = await tools.kubernetes.list({ namespace: 'default' });
return pods.items?.filter((pod) => pod.status?.phase === 'Running');
\`\`\`

## Example Usage

\`\`\`typescript
// List all pods
const pods = await tools.kubernetes.list({});
return pods.items;

// Get logs for a specific pod
return await tools.kubernetes.logs({
  podName: 'my-pod', // alias: name
  namespace: 'default'
});
\`\`\`

## Output Format
Returns an object with the following properties:
- \`success\`: boolean
- \`result\`: value returned from your script (objects/arrays are serialized using JSON.stringify)
- \`stdout\`: captured console.log/info output (only if success is false or result is empty)
- \`stderr\`: captured console.error/warn output (if not empty)
- \`error\`: message when \`success\` is false (includes stack info)
`;
  }

  private buildToolMetadata(manifest: ManifestEntry[]): ToolMetadata[] {
    return manifest.flatMap((entry) =>
      entry.tools.map((tool) => ({
        server: entry.server,
        name: tool.name,
        qualifiedName: tool.qualifiedName,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    );
  }

  private createToolsNamespace(tools: ToolMetadata[]) {
    const namespaces: Record<string, Record<string, (args: any) => Promise<any>>> = {
      kubernetes: {},
      helm: {},
      argo: {},
      argocd: {},
      other: {},
    };

    for (const tool of tools) {
      const { namespace, methodName } = getToolNamespace(tool.name);
      if (!namespaces[namespace]) {
        namespaces[namespace] = {};
      }
      namespaces[namespace][methodName] = (args: any) => this.invokeTool(tool.qualifiedName, args);
    }

    const list = (server?: string) => {
      const filtered = server ? tools.filter((t) => t.server === server) : tools;
      return filtered.map((t) => ({
        ...t,
        name: formatToolAccessor(t.name),
      }));
    };

    const search = (query: string, limit = 10) => {
      const normalized = query.toLowerCase();
      return tools
        .filter(
          (tool) =>
            tool.name.toLowerCase().includes(normalized) ||
            (tool.description ?? '').toLowerCase().includes(normalized),
        )
        .slice(0, limit);
    };

    const help = (toolName: string) => {
      const tool = this.findToolByName(toolName, tools);
      if (!tool) return null;
      const params = tool.inputSchema ? this.extractParametersFromSchema(tool.inputSchema) : [];
      return {
        name: tool.name,
        qualifiedName: tool.qualifiedName,
        description: tool.description,
        parameters: params,
      };
    };

    const call = (qualifiedName: string, args?: Record<string, unknown>) =>
      this.invokeTool(qualifiedName, args);

    const servers = () => Array.from(new Set(tools.map((t) => t.server)));

    return {
      kubernetes: namespaces.kubernetes,
      helm: namespaces.helm,
      argo: namespaces.argo,
      argocd: namespaces.argocd,
      other: namespaces.other,
      list,
      search,
      help,
      call,
      servers,
    };
  }

  private findToolByName(toolName: string, tools: ToolMetadata[]): ToolMetadata | undefined {
    if (!toolName) return undefined;
    const normalized = toolName.replace(/([A-Z])/g, '_$1').toLowerCase();
    return tools.find(
      (tool) =>
        tool.name === normalized ||
        tool.name === toolName ||
        toCamelCase(tool.name) === toolName ||
        toCamelCase(tool.name) === toCamelCase(toolName),
    );
  }

  private createConsoleCapture(stdout: string[], stderr: string[]) {
    const format = (args: unknown[]) =>
      args.map((arg) => this.stringifyConsoleValue(arg)).join(' ');
    return {
      log: (...args: unknown[]) => stdout.push(format(args)),
      info: (...args: unknown[]) => stdout.push(format(args)),
      warn: (...args: unknown[]) => stderr.push(format(args)),
      error: (...args: unknown[]) => stderr.push(format(args)),
    };
  }

  private stringifyConsoleValue(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (value instanceof Error) {
      return value.stack ?? value.message;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private serializeError(error: unknown) {
    if (error && typeof error === 'object') {
      const errObject = error as { message?: unknown; name?: unknown; stack?: unknown };
      return {
        message:
          typeof errObject.message === 'string'
            ? errObject.message
            : JSON.stringify(error, null, 2),
        name: typeof errObject.name === 'string' ? errObject.name : 'Error',
        stack: typeof errObject.stack === 'string' ? errObject.stack : undefined,
      };
    }
    return {
      message: typeof error === 'string' ? error : String(error),
      name: 'Error',
    };
  }

  private buildResponse({
    success,
    result,
    error,
    stdout,
    stderr,
    isError,
  }: {
    success: boolean;
    result?: unknown;
    error?: unknown;
    stdout: string[];
    stderr: string[];
    isError?: boolean;
  }) {
    const stdoutText = stdout.join('\n').trimEnd();
    const stderrText = stderr.join('\n').trimEnd();

    const payload: Record<string, unknown> = {
      success,
    };

    if (typeof result !== 'undefined') {
      payload.result = result;
    }

    if (error) {
      payload.error = error;
    }

    if (stdoutText && !(success && typeof result !== 'undefined')) {
      payload.stdout = stdoutText;
    }

    if (stderrText) {
      payload.stderr = stderrText;
    }

    if (isError) {
      payload.isError = true;
    }

    return payload;
  }

  private async invokeTool(qualifiedName: string, args: unknown): Promise<any> {
    if (!this.toolExecutor) {
      throw new Error('Tool executor not available');
    }
    const result = await this.toolExecutor(qualifiedName, args || {});
    return this.unwrapResult(result);
  }

  private async ensureSandboxWorkspace(): Promise<void> {
    if (this.workspaceReady) {
      return;
    }
    await fsPromises.mkdir(this.sandboxWorkspaceDir, { recursive: true });
    this.workspaceReady = true;
  }

  private resolveWorkspacePath(target?: string): string {
    const candidate = path.resolve(this.sandboxWorkspaceDir, target ?? '.');
    if (!candidate.startsWith(this.sandboxWorkspaceDir)) {
      throw new Error('Workspace access outside of sandbox is not allowed');
    }
    return candidate;
  }

  private createFsNamespace() {
    return {
      readFile: async (filePath: string) => {
        const target = this.resolveWorkspacePath(filePath);
        return fsPromises.readFile(target, 'utf-8');
      },
      writeFile: async (filePath: string, data: string) => {
        const target = this.resolveWorkspacePath(filePath);
        await fsPromises.mkdir(path.dirname(target), { recursive: true });
        return fsPromises.writeFile(target, data ?? '', 'utf-8');
      },
      listDir: async (dir?: string) => {
        const target = this.resolveWorkspacePath(dir ?? '.');
        return fsPromises.readdir(target);
      },
      exists: async (filePath: string) => {
        try {
          await fsPromises.access(this.resolveWorkspacePath(filePath));
          return true;
        } catch {
          return false;
        }
      },
    };
  }

  public generateGlobalDts(): string {
    const manifest = this.loadManifestSync();
    const namespaces: Record<ToolNamespace, string[]> = {
      kubernetes: [],
      helm: [],
      argo: [],
      argocd: [],
      other: [],
    };

    for (const entry of manifest) {
      for (const tool of entry.tools) {
        const { namespace, methodName } = getToolNamespace(tool.name);
        const argsType = tool.inputSchema
          ? this.jsonSchemaToTs(tool.inputSchema)
          : 'Record<string, any>';

        namespaces[namespace].push(
          `    /**\n     * ${tool.description || ''}\n     */\n    ${methodName}(args: ${argsType}): Promise<any>;`,
        );
      }
    }

    const namespaceDefs = Object.entries(namespaces)
      .map(([ns, methods]) => {
        const body = methods.length ? methods.join('\n') : '    // No tools registered';
        return `  export const ${ns}: {\n${body}\n  };`;
      })
      .join('\n');

    return `
declare global {
  interface ToolSummary {
    server: string;
    name: string;
    qualifiedName: string;
    description?: string;
  }

  interface ToolParameter {
    name: string;
    type: string;
    required: boolean;
    description?: string;
  }

  interface ToolHelp {
    name: string;
    qualifiedName: string;
    description?: string;
    parameters: ToolParameter[];
  }

  const tools: {
${namespaceDefs}
    list(server?: string): ToolSummary[];
    search(query: string, limit?: number): ToolSummary[];
    help(toolName: string): ToolHelp | null;
    call<T = unknown>(qualifiedName: string, args?: Record<string, any>): Promise<T>;
    servers(): string[];
  };

  const fs: {
    readFile(path: string): Promise<string>;
    writeFile(path: string, data: string): Promise<void>;
    listDir(path?: string): Promise<string[]>;
    exists(path: string): Promise<boolean>;
  };
}
`;
  }

  /**
   * Manually set the manifest/tools for the tool.
   * Useful when running in code-mode where tools are loaded in memory.
   */
  public setTools(tools: Tool[]): void {
    // Convert generic Tools to ManifestEntry format
    // We assume all tools belong to a "local" server for now
    this.cachedManifest = [
      {
        server: 'local',
        tools: tools.map((t) => ({
          name: t.name,
          qualifiedName: t.name, // In code mode, we might want to use the name as is or prefixed
          description: t.description,
          inputSchema: t.inputSchema as unknown as NormalizedSchema, // We'll handle the schema conversion in jsonSchemaToTs
        })),
      },
    ];
  }

  private jsonSchemaToTs(schema: any): string {
    // Handle NormalizedSchema (kind)
    if (schema.kind === 'object') {
      const props = schema.properties.map((prop: any) => {
        const type = this.jsonSchemaToTs(prop.schema);
        const desc = prop.description ? `/** ${prop.description} */\n      ` : '';
        return `${desc}${prop.name}${prop.required ? '' : '?'}: ${type};`;
      });
      return `{\n      ${props.join('\n      ')}\n    }`;
    }

    // Handle Standard JSON Schema (type)
    if (schema.type === 'object' && schema.properties) {
      const props = Object.entries(schema.properties).map(([key, prop]: [string, any]) => {
        const isRequired = schema.required?.includes(key);
        const type = this.jsonSchemaToTs(prop);
        const desc = prop.description ? `/** ${prop.description} */\n      ` : '';
        return `${desc}${key}${isRequired ? '' : '?'}: ${type};`;
      });
      return `{\n      ${props.join('\n      ')}\n    }`;
    }

    return this.jsonSchemaTypeToTs(schema);
  }

  private jsonSchemaTypeToTs(schema: any): string {
    if (!schema) return 'any';

    // Handle NormalizedSchema
    if (schema.kind === 'string') return 'string';
    if (schema.kind === 'number' || schema.kind === 'integer') return 'number';
    if (schema.kind === 'boolean') return 'boolean';
    if (schema.kind === 'enum') {
      return schema.values.map((v: string) => `'${v}'`).join(' | ');
    }
    if (schema.kind === 'array') {
      return `${this.jsonSchemaToTs(schema.items)}[]`;
    }
    if (schema.kind === 'object') {
      return this.jsonSchemaToTs(schema);
    }

    // Handle Standard JSON Schema
    if (schema.type === 'string') {
      if (schema.enum) {
        return schema.enum.map((e: string) => `'${e}'`).join(' | ');
      }
      return 'string';
    }
    if (schema.type === 'number' || schema.type === 'integer') return 'number';
    if (schema.type === 'boolean') return 'boolean';
    if (schema.type === 'array') {
      const itemType = schema.items ? this.jsonSchemaToTs(schema.items) : 'any';
      return `${itemType}[]`;
    }
    if (schema.type === 'object') {
      return this.jsonSchemaToTs(schema);
    }

    return 'any';
  }

  private extractParametersFromSchema(schema: NormalizedSchema): Array<{
    name: string;
    type: string;
    required: boolean;
    description?: string;
  }> {
    if (schema.kind !== 'object') return [];
    const objSchema = schema as NormalizedObjectType;

    return objSchema.properties.map((prop) => ({
      name: prop.name,
      type: this.schemaTypeToString(prop.schema),
      required: prop.required,
      description: prop.description,
    }));
  }

  private schemaTypeToString(schema: NormalizedSchema): string {
    switch (schema.kind) {
      case 'string':
        return 'string';
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'array': {
        const arrSchema = schema as NormalizedArrayType;
        return `${this.schemaTypeToString(arrSchema.items)}[]`;
      }
      case 'enum': {
        const enumSchema = schema as NormalizedEnumType;
        return enumSchema.values.map((v) => `'${v}'`).join(' | ');
      }
      case 'object':
        return 'object';
      default:
        return 'any';
    }
  }

  private loadManifestSync(): ManifestEntry[] {
    if (this.cachedManifest) return this.cachedManifest;
    try {
      const raw = readFileSync(this.manifestPath, 'utf-8');
      this.cachedManifest = JSON.parse(raw) as ManifestEntry[];
      return this.cachedManifest;
    } catch {
      return [];
    }
  }
}

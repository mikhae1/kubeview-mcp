import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
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

    // Collect console output
    const logs: string[] = [];
    const errors: string[] = [];

    // Construct tools object
    const toolsObj: any = {
      kubernetes: {},
      helm: {},
      argo: {},
      other: {},
    };

    const manifest = this.loadManifestSync();

    for (const entry of manifest) {
      for (const tool of entry.tools) {
        let namespace = 'other';
        let methodName = this.toCamelCase(tool.name);

        if (tool.name.startsWith('kube_')) {
          namespace = 'kubernetes';
          methodName = this.toCamelCase(tool.name.replace('kube_', ''));
        } else if (tool.name.startsWith('helm_')) {
          namespace = 'helm';
          methodName = this.toCamelCase(tool.name.replace('helm_', ''));
        } else if (tool.name.startsWith('argo_')) {
          namespace = 'argo';
          methodName = this.toCamelCase(tool.name.replace('argo_', ''));
        }

        if (!toolsObj[namespace]) {
          toolsObj[namespace] = {};
        }

        toolsObj[namespace][methodName] = async (args: any) => {
          if (!this.toolExecutor) {
            throw new Error('Tool executor not available');
          }
          const result = await this.toolExecutor(tool.qualifiedName, args || {});
          return this.unwrapResult(result);
        };
      }
    }

    // Build individual tool helper functions for global scope
    const toolHelpers: Record<string, any> = {};
    for (const entry of manifest) {
      for (const tool of entry.tools) {
        const helperName = this.toCamelCase(tool.name);
        toolHelpers[helperName] = async (args: any) => {
          if (!this.toolExecutor) {
            throw new Error('Tool executor not available');
          }
          const result = await this.toolExecutor(tool.qualifiedName, args || {});
          return this.unwrapResult(result);
        };
      }
    }

    // Create sandbox context
    const context = vm.createContext({
      console: {
        log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
        info: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
        warn: (...args: unknown[]) => logs.push('[WARN] ' + args.map(String).join(' ')),
        error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
      },
      tools: toolsObj,
      // Helper functions
      callMCPTool: async (qualifiedName: string, args: any) => {
        if (!this.toolExecutor) {
          throw new Error('Tool executor not available');
        }
        const result = await this.toolExecutor(qualifiedName, args || {});
        return this.unwrapResult(result);
      },
      searchTools: (query: string, limit = 10) => {
        const normalized = query.toLowerCase();
        return manifest
          .flatMap((entry) =>
            entry.tools.map((tool) => ({
              server: entry.server,
              name: tool.name,
              qualifiedName: tool.qualifiedName,
              description: tool.description,
            })),
          )
          .filter(
            (tool) =>
              tool.name.toLowerCase().includes(normalized) ||
              (tool.description ?? '').toLowerCase().includes(normalized),
          )
          .slice(0, limit);
      },
      getToolHelp: (toolName: string) => {
        // Support both snake_case and camelCase
        const normalized = toolName.replace(/([A-Z])/g, '_$1').toLowerCase();
        for (const entry of manifest) {
          const tool = entry.tools.find(
            (t) =>
              t.name === normalized || t.name === toolName || this.toCamelCase(t.name) === toolName,
          );
          if (tool) {
            const params = tool.inputSchema
              ? this.extractParametersFromSchema(tool.inputSchema)
              : [];
            return {
              name: tool.name,
              qualifiedName: tool.qualifiedName,
              description: tool.description,
              parameters: params,
            };
          }
        }
        return null;
      },
      // Add individual tool helpers to global scope
      ...toolHelpers,
      __result: undefined as unknown,
      __error: undefined as unknown,
    });

    // Wrap code in async IIFE
    const wrappedCode = `
(async () => {
  try {
    ${code}
  } catch (e) {
    __error = e;
  }
})().then((res) => { __result = res; }).catch(e => { __error = e; });
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
      await script.runInContext(context, { timeout: this.config.timeoutMs ?? 30000 });

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      if (context.__error) {
        const err = context.__error as Error;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: err.message || String(err),
                  stdout: logs.join('\n'),
                  stderr: errors.join('\n'),
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                stdout: logs.join('\n'),
                stderr: errors.join('\n'),
                result: context.__result,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: message,
                stdout: logs.join('\n'),
                stderr: errors.join('\n'),
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Unwrap common list response formats to make the API easier to use.
   * e.g. { pods: [...] } -> [...]
   */
  private unwrapResult(result: any): any {
    if (!result || typeof result !== 'object') return result;

    // Check for common collection properties
    const collectionProps = [
      'items',
      'pods',
      'services',
      'deployments',
      'nodes',
      'namespaces',
      'persistentvolumes',
      'persistentvolumeclaims',
      'secrets',
      'configmaps',
    ];

    for (const prop of collectionProps) {
      if (Array.isArray(result[prop])) {
        // If it's the only significant property (ignoring total, namespace, etc.), return it
        // Or just prefer returning the list for "Code Mode" usability
        return result[prop];
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

    return `Execute TypeScript code in a sandboxed Node.js environment.
This tool allows you to write and execute scripts to interact with the Kubernetes cluster using the exposed tools.

## Environment
- **Runtime**: Node.js (vm)
- **Language**: TypeScript (transpiled to ES2022)
- **Top-level await**: Supported
- **Global Object**: \`tools\` (contains all available MCP tools)

## API Reference
The \`tools\` object is namespaced by plugin/category.
Reference \`/sys/global.d.ts\` to see the exact TypeScript interfaces for the tools object.

${overviewTree}

## Key Functions

### Helper Functions
- **\`callMCPTool(qualifiedName, args)\`** - Call any MCP tool by its qualified name
- **\`searchTools(query, limit?)\`** - Search for tools by name or description
- **\`getToolHelp(toolName)\`** - Get detailed help for a specific tool

### Individual Tool Helpers
Each tool is also available as a camelCase function in the global scope (e.g., \`kubeList()\`, \`helmGet()\`, \`argoLogs()\`).

## Quick Start

\`\`\`typescript
// Search for available tools
console.log(JSON.stringify(searchTools('pods'), null, 2));

// Inspect a specific tool
console.log(JSON.stringify(getToolHelp('kubeList'), null, 2));

// Call helper functions directly
const pods = await kubeList({ resourceType: 'pod', namespace: 'default' });
console.log(JSON.stringify(pods, null, 2));
\`\`\`

## Example Usage

\`\`\`typescript
// List all pods
const pods = await kubeList({});
console.log(JSON.stringify(pods, null, 2));

// Get logs for a specific pod
const logs = await tools.kubernetes.logs({
  podName: 'my-pod', // alias: name
  namespace: 'default'
});
console.log(logs);
\`\`\`

## Output Format
Returns an object with the following properties:
- \`success\`: boolean
- \`stdout\`: captured console.log/info output
- \`stderr\`: captured console.error/warn output
- \`result\` (optional): script return value when provided
- \`error\`: message when \`success\` is false
`;
  }

  public generateGlobalDts(): string {
    const manifest = this.loadManifestSync();
    const namespaces: Record<string, string[]> = {};

    for (const entry of manifest) {
      for (const tool of entry.tools) {
        let namespace = 'other';
        let methodName = this.toCamelCase(tool.name);

        if (tool.name.startsWith('kube_')) {
          namespace = 'kubernetes';
          methodName = this.toCamelCase(tool.name.replace('kube_', ''));
        } else if (tool.name.startsWith('helm_')) {
          namespace = 'helm';
          methodName = this.toCamelCase(tool.name.replace('helm_', ''));
        } else if (tool.name.startsWith('argo_')) {
          namespace = 'argo';
          methodName = this.toCamelCase(tool.name.replace('argo_', ''));
        }

        if (!namespaces[namespace]) {
          namespaces[namespace] = [];
        }

        const argsType = tool.inputSchema
          ? this.jsonSchemaToTs(tool.inputSchema)
          : 'Record<string, any>';

        namespaces[namespace].push(
          `    /**\n     * ${tool.description || ''}\n     */\n    ${methodName}(args: ${argsType}): Promise<any>;`,
        );
      }
    }

    const namespaceDefs = Object.entries(namespaces)
      .map(([ns, methods]) => `  export const ${ns}: {\n${methods.join('\n')}\n  };`)
      .join('\n');

    return `
declare global {
  const tools: {
${namespaceDefs}
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

  private toCamelCase(name: string): string {
    return name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
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

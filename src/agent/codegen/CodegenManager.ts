import { promises as fs } from 'fs';
import path from 'path';
import ts from 'typescript';
import { ToolSchemaIntrospector } from './ToolSchemaIntrospector.js';
import { SchemaToTypeScriptMapper } from './SchemaToTypeScriptMapper.js';
import type { ToolSchemaSummary } from './types.js';

export interface CodegenManagerOptions {
  outputDir: string;
  runtimeImportPath?: string;
  manifestPath?: string;
}

const DEFAULT_OPTIONS: CodegenManagerOptions = {
  outputDir: path.resolve(process.cwd(), 'generated/servers'),
  runtimeImportPath: '../../runtime/callMCPTool.ts',
  manifestPath: path.resolve(process.cwd(), 'generated/servers/manifest.json'),
};

export class CodegenManager {
  private readonly mapper = new SchemaToTypeScriptMapper();
  private readonly printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  private readonly options: CodegenManagerOptions;

  constructor(
    private readonly introspector: ToolSchemaIntrospector,
    options?: Partial<CodegenManagerOptions>,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  public async generate(): Promise<void> {
    const summaries = this.introspector.collectToolSchemas();
    if (!summaries.length) {
      return;
    }

    await fs.mkdir(this.options.outputDir, { recursive: true });
    await this.ensureRuntimeHelpers();

    const grouped = this.groupByServer(summaries);
    for (const [server, tools] of grouped.entries()) {
      const serverDir = path.join(this.options.outputDir, server);
      await fs.rm(serverDir, { recursive: true, force: true });
      await fs.mkdir(serverDir, { recursive: true });
      await Promise.all(tools.map((tool) => this.writeToolFile(serverDir, server, tool)));
      await this.writeServerIndex(serverDir, tools);
    }

    await this.writeRootIndex(Array.from(grouped.keys()));
    await this.writeManifest(grouped);
  }

  private groupByServer(summaries: ToolSchemaSummary[]): Map<string, ToolSchemaSummary[]> {
    const grouped = new Map<string, ToolSchemaSummary[]>();
    for (const summary of summaries) {
      if (!grouped.has(summary.server)) {
        grouped.set(summary.server, []);
      }
      grouped.get(summary.server)!.push(summary);
    }
    return grouped;
  }

  private async writeToolFile(
    baseDir: string,
    _server: string,
    tool: ToolSchemaSummary,
  ): Promise<void> {
    const statements: ts.Statement[] = [];
    statements.push(this.createRuntimeImport());

    const pascalName = this.toPascalCase(tool.toolName);
    const inputTypeName = `${pascalName}Input`;
    const resultTypeName = `${pascalName}Result`;

    statements.push(this.mapper.createTypeAliasDeclaration(inputTypeName, tool.inputSchema));
    statements.push(this.mapper.createTypeAliasDeclaration(resultTypeName, undefined));

    statements.push(this.createToolFunction(tool, inputTypeName, resultTypeName));

    const content = this.printStatements(statements);
    const filePath = path.join(baseDir, `${tool.toolName}.ts`);
    await fs.writeFile(filePath, content, 'utf-8');
  }

  private createRuntimeImport(): ts.ImportDeclaration {
    const importPath = this.options.runtimeImportPath ?? DEFAULT_OPTIONS.runtimeImportPath!;
    return ts.factory.createImportDeclaration(
      undefined,
      ts.factory.createImportClause(
        false,
        undefined,
        ts.factory.createNamedImports([
          ts.factory.createImportSpecifier(
            false,
            undefined,
            ts.factory.createIdentifier('callMCPTool'),
          ),
        ]),
      ),
      ts.factory.createStringLiteral(importPath),
      undefined,
    );
  }

  private createToolFunction(
    tool: ToolSchemaSummary,
    inputTypeName: string,
    resultTypeName: string,
  ): ts.FunctionDeclaration {
    const docComment = tool.description
      ? ts.factory.createJSDocComment(tool.description)
      : undefined;

    const fn = ts.factory.createFunctionDeclaration(
      [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      undefined,
      ts.factory.createIdentifier(this.toCamelCase(tool.toolName)),
      undefined,
      [
        ts.factory.createParameterDeclaration(
          undefined,
          undefined,
          ts.factory.createIdentifier('input'),
          undefined,
          ts.factory.createTypeReferenceNode(ts.factory.createIdentifier(inputTypeName)),
          undefined,
        ),
      ],
      ts.factory.createTypeReferenceNode(ts.factory.createIdentifier('Promise'), [
        ts.factory.createTypeReferenceNode(ts.factory.createIdentifier(resultTypeName)),
      ]),
      ts.factory.createBlock(
        [
          ts.factory.createReturnStatement(
            ts.factory.createCallExpression(
              ts.factory.createIdentifier('callMCPTool'),
              [ts.factory.createTypeReferenceNode(ts.factory.createIdentifier(resultTypeName))],
              [
                ts.factory.createStringLiteral(tool.qualifiedName),
                ts.factory.createIdentifier('input'),
              ],
            ),
          ),
        ],
        true,
      ),
    );

    if (docComment) {
      ts.addSyntheticLeadingComment(
        fn,
        ts.SyntaxKind.MultiLineCommentTrivia,
        `*\n * ${tool.description}\n `,
        true,
      );
    }

    return fn;
  }

  private async writeServerIndex(serverDir: string, tools: ToolSchemaSummary[]): Promise<void> {
    const statements = tools.map((tool) =>
      ts.factory.createExportDeclaration(
        undefined,
        false,
        ts.factory.createNamedExports([
          ts.factory.createExportSpecifier(
            false,
            undefined,
            ts.factory.createIdentifier(this.toCamelCase(tool.toolName)),
          ),
        ]),
        ts.factory.createStringLiteral(`./${tool.toolName}.ts`),
        undefined,
      ),
    );

    const content = this.printStatements(statements);
    await fs.writeFile(path.join(serverDir, 'index.ts'), content, 'utf-8');
  }

  private async writeRootIndex(servers: string[]): Promise<void> {
    const statements = servers.map((server) =>
      ts.factory.createExportDeclaration(
        undefined,
        false,
        undefined,
        ts.factory.createStringLiteral(`./${server}/index.ts`),
        undefined,
      ),
    );
    const content = this.printStatements(statements);
    await fs.writeFile(path.join(this.options.outputDir, 'index.ts'), content, 'utf-8');
  }

  private async writeManifest(grouped: Map<string, ToolSchemaSummary[]>): Promise<void> {
    const manifest = Array.from(grouped.entries()).map(([server, tools]) => ({
      server,
      tools: tools.map((tool) => ({
        name: tool.toolName,
        qualifiedName: tool.qualifiedName,
        description: tool.description,
        inputSchema: tool.inputSchema, // Include full schema for runtime introspection
      })),
    }));

    if (!this.options.manifestPath) return;
    await fs.writeFile(this.options.manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  private async ensureRuntimeHelpers(): Promise<void> {
    const runtimeDir = path.resolve(this.options.outputDir, '../runtime');
    await fs.mkdir(runtimeDir, { recursive: true });
    const filePath = path.join(runtimeDir, 'callMCPTool.ts');
    const content = `declare global {
  // eslint-disable-next-line no-var
  var __callMCPTool: ((qualifiedName: string, args: unknown) => Promise<unknown>) | undefined;
}

export async function callMCPTool<T = unknown>(qualifiedName: string, args: unknown): Promise<T> {
  if (typeof globalThis.__callMCPTool !== 'function') {
    throw new Error('callMCPTool bridge not initialized');
  }
  const fn = globalThis.__callMCPTool as (name: string, params: unknown) => Promise<T>;
  return fn(qualifiedName, args);
}
`;
    await fs.writeFile(filePath, content, 'utf-8');

    const searchHelperPath = path.join(runtimeDir, 'toolSearch.ts');
    const searchContent = `import manifest from '../servers/manifest.json';

export interface ToolManifestEntry {
  server: string;
  name: string;
  qualifiedName: string;
  description?: string;
}

const tools: ToolManifestEntry[] = manifest.flatMap((serverEntry) =>
  serverEntry.tools.map((tool) => ({
    server: serverEntry.server,
    ...tool,
  })),
);

export function listServers(): string[] {
  return manifest.map((entry) => entry.server);
}

export function listTools(server?: string): ToolManifestEntry[] {
  if (!server) return tools;
  return tools.filter((tool) => tool.server === server);
}

export function searchTools(query: string, limit = 10): ToolManifestEntry[] {
  const normalized = query.toLowerCase();
  return tools
    .filter(
      (tool) =>
        tool.name.toLowerCase().includes(normalized) ||
        (tool.description ?? '').toLowerCase().includes(normalized),
    )
    .slice(0, limit);
}
`;
    await fs.writeFile(searchHelperPath, searchContent, 'utf-8');

    const workspaceHelperPath = path.join(runtimeDir, 'workspaceFs.ts');
    const workspaceContent = `declare global {
  // eslint-disable-next-line no-var
  var __workspaceFs:
    | {
        readFile(path: string): Promise<string>;
        writeFile(path: string, data: string): Promise<void>;
        listDir(path?: string): Promise<string[]>;
        exists(path: string): Promise<boolean>;
      }
    | undefined;
}

function ensureWorkspaceFs() {
  if (!globalThis.__workspaceFs) {
    throw new Error('Workspace filesystem bridge not initialized');
  }
  return globalThis.__workspaceFs;
}

export async function readWorkspaceFile(path: string): Promise<string> {
  return ensureWorkspaceFs().readFile(path);
}

export async function writeWorkspaceFile(path: string, data: string): Promise<void> {
  return ensureWorkspaceFs().writeFile(path, data);
}

export async function listWorkspaceDir(path?: string): Promise<string[]> {
  return ensureWorkspaceFs().listDir(path);
}

export async function workspacePathExists(path: string): Promise<boolean> {
  return ensureWorkspaceFs().exists(path);
}
`;
    await fs.writeFile(workspaceHelperPath, workspaceContent, 'utf-8');
  }

  private printStatements(statements: ts.Statement[]): string {
    const sourceFile = ts.createSourceFile(
      'temp.ts',
      '',
      ts.ScriptTarget.ES2020,
      false,
      ts.ScriptKind.TS,
    );
    return statements
      .map((statement) => this.printer.printNode(ts.EmitHint.Unspecified, statement, sourceFile))
      .join('\n\n');
  }

  private toPascalCase(value: string): string {
    return value
      .replace(/[_-]+/g, ' ')
      .replace(/(?:^\w|[A-Z]|\b\w)/g, (word) => word.toUpperCase())
      .replace(/\s+/g, '');
  }

  private toCamelCase(value: string): string {
    const pascal = this.toPascalCase(value);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
  }
}

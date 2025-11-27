import ivm from 'isolated-vm';
import { promises as fs } from 'fs';
import path from 'path';
import ts from 'typescript';
import type { Logger } from 'winston';

export interface CodeExecutorOptions {
  workspaceDir: string;
  timeoutMs?: number;
  logger?: Logger;
}

interface CompiledModule {
  module: ivm.Module;
  path: string;
}

export class CodeExecutor {
  private readonly moduleCache = new Map<string, Promise<CompiledModule>>();
  private readonly modulePaths = new Map<ivm.Module, string>();

  constructor(
    private readonly isolate: ivm.Isolate,
    private readonly context: ivm.Context,
    private readonly options: CodeExecutorOptions,
  ) {}

  public async execute(entryFile: string): Promise<void> {
    const entryPath = this.resolveAbsolutePath(entryFile, path.resolve(this.options.workspaceDir));
    const compiled = await this.loadModule(entryPath);
    await compiled.module.evaluate({ timeout: this.options.timeoutMs ?? 5_000 });
  }

  private async loadModule(resolvedPath: string): Promise<CompiledModule> {
    if (this.moduleCache.has(resolvedPath)) {
      return this.moduleCache.get(resolvedPath)!;
    }

    const promise = this.compileModule(resolvedPath);
    this.moduleCache.set(resolvedPath, promise);
    return promise;
  }

  private async compileModule(resolvedPath: string): Promise<CompiledModule> {
    const source = await fs.readFile(resolvedPath, 'utf-8');
    const transpiled = resolvedPath.endsWith('.json')
      ? this.wrapJsonModule(source)
      : ts.transpileModule(source, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            moduleResolution: ts.ModuleResolutionKind.NodeNext,
            esModuleInterop: true,
            jsx: ts.JsxEmit.Preserve,
          },
          fileName: resolvedPath,
        }).outputText;

    const module = await this.isolate.compileModule(transpiled, { filename: resolvedPath });
    this.modulePaths.set(module, resolvedPath);
    await module.instantiate(this.context, (specifier, referencingModule) =>
      this.resolveImport(specifier, referencingModule),
    );

    return { module, path: resolvedPath };
  }

  private async resolveImport(
    specifier: string,
    referencingModule: ivm.Module,
  ): Promise<ivm.Module> {
    const basePath =
      this.modulePaths.get(referencingModule) ?? path.resolve(this.options.workspaceDir);

    const resolvedPath = await this.resolveModulePath(specifier, basePath);
    const compiled = await this.loadModule(resolvedPath);
    return compiled.module;
  }

  private async resolveModulePath(specifier: string, basePath: string): Promise<string> {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
      throw new Error(`Only relative imports are supported inside sandbox. Got: ${specifier}`);
    }

    const resolutionBase = specifier.startsWith('.')
      ? path.dirname(basePath)
      : path.resolve(this.options.workspaceDir);

    const candidates = this.expandCandidates(path.resolve(resolutionBase, specifier));
    for (const candidate of candidates) {
      if (await this.pathExists(candidate)) {
        return candidate;
      }
    }

    throw new Error(`Unable to resolve module '${specifier}' from '${basePath}'`);
  }

  private expandCandidates(resolved: string): string[] {
    const candidates = [resolved];
    const extensions = ['.ts', '.js', '.mjs', '.cjs', '.json'];
    for (const ext of extensions) {
      candidates.push(resolved + ext);
    }
    candidates.push(path.join(resolved, 'index.ts'));
    candidates.push(path.join(resolved, 'index.js'));
    return candidates;
  }

  private async pathExists(target: string): Promise<boolean> {
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }

  private resolveAbsolutePath(filePath: string, baseDir: string): string {
    return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
  }

  private wrapJsonModule(source: string): string {
    const sanitized = source.trim() || 'null';
    return `const data = ${sanitized};\nexport default data;\n`;
  }
}

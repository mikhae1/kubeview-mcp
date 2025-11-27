import vm from 'node:vm';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import type { Logger } from 'winston';

export interface NodeVmExecutorOptions {
  workspaceDir: string;
  timeoutMs?: number;
  logger?: Logger;
}

type ModuleExports = Record<string, unknown>;

export class NodeVmCodeExecutor {
  private readonly moduleCache = new Map<string, ModuleExports>();

  constructor(
    private readonly context: vm.Context,
    private readonly options: NodeVmExecutorOptions,
  ) {}

  public execute(entryFile: string): void {
    const entryPath = this.resolveAbsolutePath(entryFile, path.resolve(this.options.workspaceDir));
    this.loadModule(entryPath);
  }

  private loadModule(resolvedPath: string): ModuleExports {
    if (this.moduleCache.has(resolvedPath)) {
      return this.moduleCache.get(resolvedPath)!;
    }

    const source = fs.readFileSync(resolvedPath, 'utf-8');
    const transpiled = resolvedPath.endsWith('.json')
      ? this.wrapJsonModule(source)
      : ts.transpileModule(source, {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            moduleResolution: ts.ModuleResolutionKind.NodeNext,
            esModuleInterop: true,
            jsx: ts.JsxEmit.Preserve,
          },
          fileName: resolvedPath,
        }).outputText;

    const wrapped = `(function (exports, require, module, __filename, __dirname) { ${transpiled}\n})`;
    const script = new vm.Script(wrapped, { filename: resolvedPath });
    const fn = script.runInContext(this.context, { timeout: this.options.timeoutMs ?? 5_000 }) as (
      exports: ModuleExports,
      require: (specifier: string) => ModuleExports,
      module: { exports: ModuleExports },
      filename: string,
      dirname: string,
    ) => void;

    const module = { exports: {} as ModuleExports };
    this.moduleCache.set(resolvedPath, module.exports);

    const dirname = path.dirname(resolvedPath);
    const requireFn = (specifier: string) => {
      const resolved = this.resolveModulePath(specifier, resolvedPath);
      return this.loadModule(resolved);
    };

    fn(module.exports, requireFn, module, resolvedPath, dirname);
    return module.exports;
  }

  private resolveModulePath(specifier: string, parentPath: string): string {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
      throw new Error(`Only relative imports are supported inside sandbox. Got: ${specifier}`);
    }

    const resolutionBase = specifier.startsWith('.')
      ? path.dirname(parentPath)
      : path.resolve(this.options.workspaceDir);

    const candidates = this.expandCandidates(path.resolve(resolutionBase, specifier));
    for (const candidate of candidates) {
      if (this.pathExists(candidate)) {
        return candidate;
      }
    }

    throw new Error(`Unable to resolve module '${specifier}' from '${parentPath}'`);
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

  private pathExists(target: string): boolean {
    try {
      fs.accessSync(target);
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
    return `module.exports = ${sanitized};`;
  }
}

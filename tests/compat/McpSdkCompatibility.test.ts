import fs from 'fs';
import path from 'path';

const SDK_TYPES_IMPORT = '@modelcontextprotocol/sdk/types.js';
const BANNED_LEGACY_TYPES = new Set(['Tools', 'Prompts', 'Resources', 'Roots', 'Sampling']);

function collectTypeScriptFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

function getNamedImportsFromSdkTypes(fileContent: string): string[] {
  const imports: string[] = [];
  const pattern =
    /import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+['"]@modelcontextprotocol\/sdk\/types\.js['"]/gm;

  for (const match of fileContent.matchAll(pattern)) {
    const rawSpecifiers = match[1]
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    for (const specifier of rawSpecifiers) {
      const specifierWithoutAlias = specifier.split(/\s+as\s+/i)[0].trim();
      const specifierWithoutTypePrefix = specifierWithoutAlias.replace(/^type\s+/, '').trim();
      if (specifierWithoutTypePrefix) {
        imports.push(specifierWithoutTypePrefix);
      }
    }
  }

  return imports;
}

describe('MCP SDK 1.25.3 compatibility', () => {
  it('pins @modelcontextprotocol/sdk to ^1.25.3 in package.json and package-lock.json', () => {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageLockPath = path.join(process.cwd(), 'package-lock.json');

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));

    expect(packageJson.dependencies['@modelcontextprotocol/sdk']).toBe('^1.25.3');
    expect(packageLock.packages[''].dependencies['@modelcontextprotocol/sdk']).toBe('^1.25.3');
  });

  it('does not use removed loose SDK type exports from @modelcontextprotocol/sdk/types.js', () => {
    const workspaceRoot = process.cwd();
    const filesToScan = [
      ...collectTypeScriptFiles(path.join(workspaceRoot, 'src')),
      ...collectTypeScriptFiles(path.join(workspaceRoot, 'tests')),
    ];
    const violations: string[] = [];

    for (const filePath of filesToScan) {
      const content = fs.readFileSync(filePath, 'utf8');

      if (!content.includes(SDK_TYPES_IMPORT)) {
        continue;
      }

      const imports = getNamedImportsFromSdkTypes(content);
      for (const importedName of imports) {
        if (BANNED_LEGACY_TYPES.has(importedName)) {
          violations.push(
            `${path.relative(workspaceRoot, filePath)} imports banned legacy type "${importedName}"`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

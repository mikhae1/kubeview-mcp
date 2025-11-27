#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import winston from 'winston';
import { MCPBridge } from '../agent/bridge/MCPBridge.js';
import { ToolSchemaIntrospector } from '../agent/codegen/ToolSchemaIntrospector.js';
import { CodegenManager } from '../agent/codegen/CodegenManager.js';
import { createSandboxManager } from '../agent/runtime/createSandboxManager.js';
import {
  parseCodeModeConfig,
  toBridgeConfig,
  type CodeModeConfig,
} from '../agent/config/CodeModeConfig.js';

interface CliOptions {
  code?: string;
  file?: string;
  config?: string;
  help?: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-c' || arg === '--code') {
      options.code = args[++i];
    } else if (arg === '-f' || arg === '--file') {
      options.file = args[++i];
    } else if (arg === '--config') {
      options.config = args[++i];
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (!arg.startsWith('-') && !options.code && !options.file) {
      // Treat first non-flag argument as inline code
      options.code = arg;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Usage: kubeview-mcp-code-mode [options] [code]

Run TypeScript code in the kubeview-mcp sandbox with access to Kubernetes, Helm, and Argo tools.

Options:
  -c, --code <code>    Inline TypeScript code to execute
  -f, --file <path>    Path to TypeScript file to execute
  --config <path>      Path to code-mode config (default: kube-mcp.code-mode.json)
  -h, --help           Show this help message

Examples:
  # Run inline code
  npm run code-mode -- -c "const pods = await kubeList({}); console.log(pods);"

  # Run a file
  npm run code-mode -- -f ./my-script.ts

  # Run with piped code
  echo 'console.log(await kubeMetrics({}));' | npm run code-mode

  # Run default workspace/main.ts
  npm run code-mode

Available functions in sandbox:
  kubeList(), kubeGet(), kubeLogs(), kubeMetrics(), kubeExec(), kubeNet(), kubePort(), kubeLog()
  helmList(), helmGet()
  argoList(), argoGet(), argoLogs()
  argocdApp()
  listServers(), listTools(), searchTools()
`);
}

async function readStdin(): Promise<string | undefined> {
  // Check if stdin has data (non-TTY means piped input)
  if (process.stdin.isTTY) {
    return undefined;
  }

  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data.trim() || undefined);
    });
    // Timeout for stdin read
    setTimeout(() => resolve(data.trim() || undefined), 100);
  });
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    return;
  }

  const logger = winston.createLogger({
    level: process.env.MCP_LOG_LEVEL || 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.Console()],
  });

  const configPath = path.resolve(
    options.config ?? process.env.KUBE_MCP_CODE_MODE_CONFIG ?? 'kube-mcp.code-mode.json',
  );

  const config = await loadConfig(configPath, logger);
  const workspaceDir = path.resolve(config.workspaceDir);
  const generatedDir = path.resolve(config.generatedDir);

  await ensureWorkspaceStructure(workspaceDir, logger);

  logger.info('Connecting to MCP servers...');
  const bridge = new MCPBridge(toBridgeConfig(config), {
    enablePII: config.enablePII,
    logger,
  });
  await bridge.initialize();

  const introspector = new ToolSchemaIntrospector(bridge);
  const codegen = new CodegenManager(introspector, {
    outputDir: generatedDir,
  });
  await codegen.generate();

  const sandbox = await createSandboxManager(bridge, {
    workspaceDir,
    memoryLimitMb: config.sandbox.memoryLimitMb,
    timeoutMs: config.sandbox.timeoutMs,
    logger,
  });

  // Determine what code to run
  let entryFile: string;
  let tempFile: string | undefined;

  // Check for inline code, file path, or stdin
  const stdinCode = await readStdin();
  const code = options.code ?? stdinCode;

  if (code) {
    // Write inline code to temp file
    tempFile = path.join(workspaceDir, `.temp-${Date.now()}.ts`);
    const wrappedCode = wrapCode(code);
    await fs.writeFile(tempFile, wrappedCode, 'utf-8');
    entryFile = tempFile;
    logger.info('Executing inline code...');
  } else if (options.file) {
    entryFile = path.resolve(options.file);
    logger.info(`Executing file: ${entryFile}`);
  } else {
    entryFile = process.env.KUBE_MCP_AGENT_ENTRY || path.join(workspaceDir, 'main.ts');
    logger.info(`Executing default entry: ${entryFile}`);
  }

  try {
    await sandbox.run(entryFile);
  } finally {
    // Cleanup temp file
    if (tempFile) {
      try {
        await fs.unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
    await sandbox.dispose();
    await bridge.close();
  }
}

/**
 * Wrap inline code in an async IIFE if it uses await at top level
 */
function wrapCode(code: string): string {
  // Check if code already has top-level structure
  if (code.includes('async function main') || code.includes('void main()')) {
    return code;
  }

  // Wrap in async IIFE to support top-level await
  return `(async () => {
${code}
})().catch(console.error);
`;
}

async function loadConfig(configPath: string, logger: winston.Logger): Promise<CodeModeConfig> {
  if (!(await fileExists(configPath))) {
    logger.warn(`Config not found at ${configPath}, using defaults`);
    return {
      workspaceDir: './workspace',
      generatedDir: './generated/servers',
      enablePII: false,
      sandbox: {
        memoryLimitMb: 256,
        timeoutMs: 30000,
      },
      servers: [
        {
          name: 'kubeview-mcp',
          command: 'node',
          args: ['./dist/src/cli/cli.js'],
          timeoutMs: 15000,
        },
      ],
    };
  }
  const content = await fs.readFile(configPath, 'utf-8');
  return parseCodeModeConfig(JSON.parse(content));
}

async function ensureWorkspaceStructure(
  workspaceDir: string,
  logger: winston.Logger,
): Promise<void> {
  await fs.mkdir(workspaceDir, { recursive: true });
  const skillsDir = path.join(workspaceDir, 'skills');
  await fs.mkdir(skillsDir, { recursive: true });

  const skillDoc = path.join(skillsDir, 'SKILL.md');
  if (!(await fileExists(skillDoc))) {
    await fs.writeFile(
      skillDoc,
      '# Skills Directory\n\nDocument reusable agent snippets here. Provide intent, inputs, and outputs for each skill.',
      'utf-8',
    );
  }

  const entryFile = path.join(workspaceDir, 'main.ts');
  if (!(await fileExists(entryFile))) {
    logger.info(`Creating starter agent script at ${entryFile}`);
    await fs.writeFile(
      entryFile,
      `// Default entry point - edit this file or use -c flag for inline code
console.log('kubeview-mcp code-mode ready');
console.log('Available tools:', listTools().map(t => t.name).join(', '));
`,
      'utf-8',
    );
  }
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error('Code-mode execution failed:', error);
  process.exit(1);
});

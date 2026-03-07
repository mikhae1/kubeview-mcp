#!/usr/bin/env tsx

import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const rootDir = process.cwd();

type RunnerResult = {
  status: number;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
};

type RunnerOptions = {
  interactive?: boolean;
  quiet?: boolean;
  env?: NodeJS.ProcessEnv;
};

export type Runner = (command: string, args: string[], options?: RunnerOptions) => RunnerResult;

type PublishStep = 'all' | 'commit' | 'tag' | 'npm' | 'git' | 'mcp';

type PackageInfo = {
  name: string;
  version: string;
};

function readPackageInfo(cwd = rootDir): PackageInfo {
  const packageJsonPath = join(cwd, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageInfo;
  return {
    name: packageJson.name,
    version: packageJson.version,
  };
}

export function createRunner(
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdout?: Pick<NodeJS.WriteStream, 'write'>;
    stderr?: Pick<NodeJS.WriteStream, 'write'>;
  } = {},
): Runner {
  const {
    cwd = rootDir,
    env = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
  } = options;

  return (command, args, commandOptions = {}) => {
    const { interactive = false, quiet = false } = commandOptions;
    const result = spawnSync(command, args, {
      cwd,
      env: { ...env, ...(commandOptions.env || {}) },
      encoding: 'utf8',
      stdio: interactive ? 'inherit' : 'pipe',
    });

    const normalized: RunnerResult = {
      status: result.status ?? (result.error ? 1 : 0),
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
      error: result.error,
    };

    if (!interactive && !quiet) {
      if (normalized.stdout) stdout.write(normalized.stdout);
      if (normalized.stderr) stderr.write(normalized.stderr);
    }

    return normalized;
  };
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(' ');
}

function describeFailure(command: string, args: string[], result: RunnerResult): string {
  if (result.error?.code === 'ENOENT') {
    return `Command not found: ${command}`;
  }
  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  const details = stderr || stdout;
  return details
    ? `${formatCommand(command, args)} failed: ${details}`
    : `${formatCommand(command, args)} failed with exit code ${result.status}`;
}

function assertSuccess(command: string, args: string[], result: RunnerResult): RunnerResult {
  if (result.status === 0 && !result.error) {
    return result;
  }

  throw new Error(describeFailure(command, args, result));
}

function runCommand(
  runner: Runner,
  command: string,
  args: string[],
  options?: RunnerOptions,
): RunnerResult {
  return runner(command, args, options);
}

function hasStagedChanges(runner: Runner): boolean {
  const result = runCommand(runner, 'git', ['diff', '--cached', '--quiet'], { quiet: true });
  if (result.status === 0) {
    return false;
  }
  if (result.status === 1) {
    return true;
  }

  throw new Error(describeFailure('git', ['diff', '--cached', '--quiet'], result));
}

function getCurrentBranch(runner: Runner): string {
  const result = assertSuccess(
    'git',
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    runCommand(runner, 'git', ['rev-parse', '--abbrev-ref', 'HEAD'], { quiet: true }),
  );
  const branch = result.stdout.trim();
  if (!branch || branch === 'HEAD') {
    throw new Error('Refusing to publish from a detached HEAD');
  }
  return branch;
}

function tagExists(runner: Runner, tagName: string): boolean {
  const args = ['rev-parse', '-q', '--verify', `refs/tags/${tagName}`];
  const result = runCommand(runner, 'git', args, { quiet: true });
  if (result.status === 0) {
    return true;
  }
  if (result.status === 1) {
    return false;
  }

  throw new Error(describeFailure('git', args, result));
}

function npmVersionExists(runner: Runner, packageName: string, version: string): boolean {
  const result = runCommand(runner, 'npm', ['view', `${packageName}@${version}`, 'version'], {
    quiet: true,
  });
  return result.status === 0;
}

function ensureNpmLogin(runner: Runner): void {
  const whoAmIResult = runCommand(runner, 'npm', ['whoami'], { quiet: true });
  if (whoAmIResult.status === 0) {
    return;
  }

  assertSuccess('npm', ['login'], runCommand(runner, 'npm', ['login'], { interactive: true }));
}

function isDuplicateMcpVersion(output: string): boolean {
  return output.includes('invalid version: cannot publish duplicate version');
}

export function publishMcp(
  options: { runner?: Runner; cwd?: string } = {},
): 'published' | 'skipped' {
  const runner = options.runner || createRunner({ cwd: options.cwd });
  const attempts: Array<[string, string[]]> = [
    ['mcp-publisher', ['publish', 'server.json']],
    ['npx', ['-y', 'mcp-publisher', 'publish', 'server.json']],
  ];

  for (const [command, args] of attempts) {
    const result = runCommand(runner, command, args, { quiet: true });
    const output = `${result.stdout}\n${result.stderr}`;

    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }

    if (result.status === 0 && !result.error) {
      return 'published';
    }
    if (isDuplicateMcpVersion(output)) {
      console.log('Version already published to MCP registry, skipping');
      return 'skipped';
    }

    if (result.error?.code !== 'ENOENT') {
      throw new Error(describeFailure(command, args, result));
    }
  }

  throw new Error(
    'Unable to publish to the MCP registry because neither `mcp-publisher` nor `npx mcp-publisher` is available',
  );
}

function runCommit(runner: Runner, version: string): 'committed' | 'skipped' {
  if (!hasStagedChanges(runner)) {
    console.log('No staged changes, skipping commit');
    return 'skipped';
  }

  assertSuccess(
    'git',
    ['commit', '-m', `Release v${version}`],
    runCommand(runner, 'git', ['commit', '-m', `Release v${version}`], { interactive: true }),
  );
  return 'committed';
}

function runTag(runner: Runner, version: string): 'tagged' | 'skipped' {
  const tagName = `v${version}`;
  if (tagExists(runner, tagName)) {
    console.log(`Tag ${tagName} already exists, skipping`);
    return 'skipped';
  }

  assertSuccess(
    'git',
    ['tag', tagName],
    runCommand(runner, 'git', ['tag', tagName], { interactive: true }),
  );
  console.log(`Tagged version ${tagName}`);
  return 'tagged';
}

function runNpmPublish(
  runner: Runner,
  packageName: string,
  version: string,
): 'published' | 'skipped' {
  if (npmVersionExists(runner, packageName, version)) {
    console.log(`Version ${version} already published to npm, skipping`);
    return 'skipped';
  }

  ensureNpmLogin(runner);
  assertSuccess('npm', ['publish'], runCommand(runner, 'npm', ['publish'], { interactive: true }));
  return 'published';
}

function runGitPush(runner: Runner): string {
  const branch = getCurrentBranch(runner);
  assertSuccess(
    'git',
    ['push', 'origin', branch, '--follow-tags'],
    runCommand(runner, 'git', ['push', 'origin', branch, '--follow-tags'], { interactive: true }),
  );
  return branch;
}

const stepHandlers: Record<
  Exclude<PublishStep, 'all'>,
  (context: { cwd: string; runner: Runner; packageInfo: PackageInfo }) => unknown
> = {
  commit: ({ runner, packageInfo }) => runCommit(runner, packageInfo.version),
  tag: ({ runner, packageInfo }) => runTag(runner, packageInfo.version),
  npm: ({ runner, packageInfo }) => runNpmPublish(runner, packageInfo.name, packageInfo.version),
  git: ({ runner }) => runGitPush(runner),
  mcp: ({ runner, cwd }) => publishMcp({ runner, cwd }),
};

export function runPublishWorkflow(
  options: {
    step?: PublishStep;
    cwd?: string;
    runner?: Runner;
    packageInfo?: PackageInfo;
  } = {},
): void {
  const {
    step = 'all',
    cwd = rootDir,
    runner = createRunner({ cwd }),
    packageInfo = readPackageInfo(cwd),
  } = options;

  const context = { cwd, runner, packageInfo };

  if (step === 'all') {
    stepHandlers.commit(context);
    stepHandlers.tag(context);
    stepHandlers.git(context);
    stepHandlers.npm(context);
    stepHandlers.mcp(context);
    return;
  }

  const handler = stepHandlers[step];
  if (!handler) {
    throw new Error(`Unknown publish step: ${step}`);
  }

  handler(context);
}

const invokedPath = process.argv[1] || '';
const isDirectRun =
  invokedPath.endsWith('/scripts/release-publish.ts') ||
  invokedPath.endsWith('\\scripts\\release-publish.ts') ||
  invokedPath.endsWith('/scripts/release-publish.js') ||
  invokedPath.endsWith('\\scripts\\release-publish.js');

if (isDirectRun) {
  try {
    const step = (process.argv[2] as PublishStep | undefined) || 'all';
    runPublishWorkflow({ step });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

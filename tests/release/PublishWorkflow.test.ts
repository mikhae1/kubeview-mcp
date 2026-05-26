import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

type CommandResult = {
  status: number;
  stdout?: string;
  stderr?: string;
  error?: NodeJS.ErrnoException;
};

function createMcpPublisherHome(options: { loggedIn?: boolean } = {}): string {
  const homeDir = mkdtempSync(join(tmpdir(), 'mcp-publisher-home-'));
  if (options.loggedIn) {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString('base64url');
    const tokenDir = join(homeDir, '.config', 'mcp-publisher');
    mkdirSync(tokenDir, { recursive: true });
    writeFileSync(
      join(tokenDir, 'token.json'),
      JSON.stringify({ token: `${header}.${payload}.signature` }),
    );
  }
  return homeDir;
}

describe('release publish workflow', () => {
  let publishMcp: typeof import('../../scripts/release-publish').publishMcp;
  let runPublishWorkflow: typeof import('../../scripts/release-publish').runPublishWorkflow;
  let isMcpPublisherLoggedIn: typeof import('../../scripts/release-publish').isMcpPublisherLoggedIn;

  const packageInfo = {
    name: 'kubeview-mcp',
    version: '1.7.0',
  };

  beforeAll(async () => {
    const module = await import('../../scripts/release-publish');
    publishMcp = module.publishMcp;
    runPublishWorkflow = module.runPublishWorkflow;
    isMcpPublisherLoggedIn = module.isMcpPublisherLoggedIn;
  });

  function createRunner(handler: (command: string, args: string[]) => CommandResult) {
    return jest.fn((command: string, args: string[]) => {
      const result = handler(command, args);
      return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        error: result.error,
      };
    });
  }

  it('pushes tags immediately before MCP publish during publish:all', () => {
    const homeDir = createMcpPublisherHome({ loggedIn: true });
    const runner = createRunner((command, args) => {
      if (command === 'git' && args.join(' ') === 'diff --cached --quiet') {
        return { status: 1 };
      }
      if (command === 'git' && args.join(' ') === 'rev-parse -q --verify refs/tags/v1.7.0') {
        return { status: 1 };
      }
      if (command === 'git' && args.join(' ') === 'rev-parse --abbrev-ref HEAD') {
        return { status: 0, stdout: 'release/main\n' };
      }
      if (command === 'npm' && args.join(' ') === 'view kubeview-mcp@1.7.0 version') {
        return { status: 1 };
      }
      if (command === 'npm' && args.join(' ') === 'whoami') {
        return { status: 0, stdout: 'mikhae1\n' };
      }
      return { status: 0 };
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    runPublishWorkflow({ runner, packageInfo, step: 'all', homeDir });

    const executedCommands = runner.mock.calls.map(
      ([command, args]) => `${command} ${args.join(' ')}`,
    );
    expect(executedCommands).toEqual([
      'git diff --cached --quiet',
      'git commit -m Release v1.7.0',
      'git rev-parse -q --verify refs/tags/v1.7.0',
      'git tag v1.7.0',
      'npm view kubeview-mcp@1.7.0 version',
      'npm whoami',
      'npm publish',
      'git rev-parse --abbrev-ref HEAD',
      'git push origin release/main --follow-tags',
      'mcp-publisher publish server.json',
    ]);
    expect(logSpy).toHaveBeenCalledWith('Tagged version v1.7.0');
  });

  it('skips the commit step when nothing is staged', () => {
    const runner = createRunner((command, args) => {
      if (command === 'git' && args.join(' ') === 'diff --cached --quiet') {
        return { status: 0 };
      }
      return { status: 0 };
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    runPublishWorkflow({ runner, packageInfo, step: 'commit' });

    expect(logSpy).toHaveBeenCalledWith('No staged changes, skipping commit');
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('falls back to npx for MCP publish and treats duplicate versions as success', () => {
    const homeDir = createMcpPublisherHome({ loggedIn: true });
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const runner = createRunner((command, args) => {
      if (command === 'mcp-publisher') {
        return {
          status: 1,
          error: Object.assign(new Error('not found'), { code: 'ENOENT' }),
        };
      }
      if (command === 'npx' && args.join(' ') === '-y mcp-publisher publish server.json') {
        return {
          status: 1,
          stderr: 'invalid version: cannot publish duplicate version',
        };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    });

    const result = publishMcp({ runner, homeDir });

    expect(result).toBe('skipped');
    expect(runner).toHaveBeenNthCalledWith(1, 'mcp-publisher', ['publish', 'server.json'], {
      quiet: true,
    });
    expect(runner).toHaveBeenNthCalledWith(
      2,
      'npx',
      ['-y', 'mcp-publisher', 'publish', 'server.json'],
      { quiet: true },
    );
    expect(stderrSpy).toHaveBeenCalledWith('invalid version: cannot publish duplicate version');
    expect(logSpy).toHaveBeenCalledWith('Version already published to MCP registry, skipping');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('pushes tags before starting standalone MCP publish', () => {
    const homeDir = createMcpPublisherHome({ loggedIn: true });
    const runner = createRunner((command, args) => {
      if (command === 'git' && args.join(' ') === 'rev-parse --abbrev-ref HEAD') {
        return { status: 0, stdout: 'release/main\n' };
      }
      if (command === 'mcp-publisher' && args.join(' ') === 'publish server.json') {
        return { status: 0 };
      }
      return { status: 0 };
    });

    runPublishWorkflow({ runner, packageInfo, step: 'mcp', homeDir });

    const executedCommands = runner.mock.calls.map(
      ([command, args]) => `${command} ${args.join(' ')}`,
    );
    expect(executedCommands).toEqual([
      'git rev-parse --abbrev-ref HEAD',
      'git push origin release/main --follow-tags',
      'mcp-publisher publish server.json',
    ]);
  });

  it('logs in to the MCP registry before publishing when not authenticated', () => {
    const homeDir = createMcpPublisherHome();
    const runner = createRunner((command, args) => {
      if (command === 'mcp-publisher' && args.join(' ') === '--help') {
        return { status: 0 };
      }
      if (command === 'mcp-publisher' && args.join(' ') === 'login github') {
        return { status: 0 };
      }
      if (command === 'mcp-publisher' && args.join(' ') === 'publish server.json') {
        return { status: 0 };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    });

    const result = publishMcp({ runner, homeDir });

    expect(result).toBe('published');
    expect(isMcpPublisherLoggedIn(homeDir)).toBe(false);
    expect(runner.mock.calls.map(([command, args]) => `${command} ${args.join(' ')}`)).toEqual([
      'mcp-publisher --help',
      'mcp-publisher login github',
      'mcp-publisher publish server.json',
    ]);
  });

  it('skips MCP login when a valid token is already stored', () => {
    const homeDir = createMcpPublisherHome({ loggedIn: true });
    const runner = createRunner((command, args) => {
      if (command === 'mcp-publisher' && args.join(' ') === 'publish server.json') {
        return { status: 0 };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    });

    publishMcp({ runner, homeDir });

    expect(isMcpPublisherLoggedIn(homeDir)).toBe(true);
    expect(runner.mock.calls.map(([command, args]) => `${command} ${args.join(' ')}`)).toEqual([
      'mcp-publisher publish server.json',
    ]);
  });
});

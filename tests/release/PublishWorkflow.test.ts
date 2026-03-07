type CommandResult = {
  status: number;
  stdout?: string;
  stderr?: string;
  error?: NodeJS.ErrnoException;
};

describe('release publish workflow', () => {
  let publishMcp: typeof import('../../scripts/release-publish').publishMcp;
  let runPublishWorkflow: typeof import('../../scripts/release-publish').runPublishWorkflow;

  const packageInfo = {
    name: 'kubeview-mcp',
    version: '1.7.0',
  };

  beforeAll(async () => {
    const module = await import('../../scripts/release-publish');
    publishMcp = module.publishMcp;
    runPublishWorkflow = module.runPublishWorkflow;
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

  it('creates the tag before pushing during publish:all', () => {
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

    runPublishWorkflow({ runner, packageInfo, step: 'all' });

    const executedCommands = runner.mock.calls.map(
      ([command, args]) => `${command} ${args.join(' ')}`,
    );
    expect(executedCommands).toEqual([
      'git diff --cached --quiet',
      'git commit -m Release v1.7.0',
      'git rev-parse -q --verify refs/tags/v1.7.0',
      'git tag v1.7.0',
      'git rev-parse --abbrev-ref HEAD',
      'git push origin release/main --follow-tags',
      'npm view kubeview-mcp@1.7.0 version',
      'npm whoami',
      'npm publish',
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

    const result = publishMcp({ runner });

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
});

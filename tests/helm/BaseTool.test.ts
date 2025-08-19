import { executeHelmCommand, validateHelmCLI } from '../../src/tools/helm/BaseTool.js';
import { spawn } from 'child_process';
import type { EventEmitter } from 'events';

// Mock child_process module
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
}));

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('BaseTool', () => {
  let mockChildProcess: Partial<
    EventEmitter & {
      stdout: EventEmitter | null;
      stderr: EventEmitter | null;
      kill: jest.Mock;
    }
  >;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a mock child process
    mockChildProcess = {
      stdout: {
        on: jest.fn(),
      } as any,
      stderr: {
        on: jest.fn(),
      } as any,
      on: jest.fn(),
      kill: jest.fn(),
    };

    mockSpawn.mockReturnValue(mockChildProcess as any);
  });

  afterEach(() => {
    delete process.env.MCP_LOG_LEVEL;
    delete process.env.MCP_HELM_TIMEOUT;
    delete process.env.SHELL;
  });

  describe('executeHelmCommand', () => {
    it('should execute helm command with proper shell options', async () => {
      const args = ['list', '--output', 'json'];
      const expectedOutput = [{ name: 'test-release' }];

      // Mock successful execution
      mockChildProcess.on = jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
        return mockChildProcess as any;
      });

      mockChildProcess.stdout!.on = jest.fn((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from(JSON.stringify(expectedOutput))), 5);
        }
        return mockChildProcess.stdout as EventEmitter;
      });

      mockChildProcess.stderr!.on = jest.fn();

      const resultPromise = executeHelmCommand(args);
      const result = await resultPromise;

      expect(result).toEqual(expectedOutput);
      expect(mockSpawn).toHaveBeenCalledWith(
        'helm',
        args,
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
          env: expect.objectContaining(process.env),
          // Should NOT use shell by default for security
        }),
      );
    });

    it('should prioritize security by not using shell by default', async () => {
      const args = ['version'];

      // Mock successful execution
      mockChildProcess.on = jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
        return mockChildProcess as any;
      });

      mockChildProcess.stdout!.on = jest.fn((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('version output')), 5);
        }
        return mockChildProcess.stdout as any;
      });

      mockChildProcess.stderr!.on = jest.fn();

      await executeHelmCommand(args);

      // Verify spawn was called without shell option (secure by default)
      expect(mockSpawn).toHaveBeenCalledWith(
        'helm',
        args,
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
          env: expect.objectContaining(process.env),
        }),
      );

      // Ensure no shell property is set for security
      const callArgs = mockSpawn.mock.calls[0][2] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty('shell');
    });

    it('should handle command failure with proper error message', async () => {
      const args = ['invalid-command'];
      const errorOutput = 'Error: unknown command "invalid-command"';

      // Mock failed execution
      mockChildProcess.on = jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(1), 10);
        }
        return mockChildProcess as any;
      });

      mockChildProcess.stdout!.on = jest.fn();
      mockChildProcess.stderr!.on = jest.fn((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from(errorOutput)), 5);
        }
        return mockChildProcess.stderr as any;
      });

      await expect(executeHelmCommand(args)).rejects.toThrow(
        'helm command failed (exit code 1): Error: unknown command "invalid-command"',
      );
    });

    it('should handle spawn errors', async () => {
      const args = ['list'];

      // Mock spawn error
      mockChildProcess.on = jest.fn((event, callback) => {
        if (event === 'error') {
          setTimeout(() => callback(new Error('ENOENT: no such file or directory')), 10);
        }
        return mockChildProcess as any;
      });

      mockChildProcess.stdout!.on = jest.fn();
      mockChildProcess.stderr!.on = jest.fn();

      await expect(executeHelmCommand(args)).rejects.toThrow(
        'Failed to execute helm command "helm list": ENOENT: no such file or directory',
      );
    });

    it('should handle timeout for long-running commands', async () => {
      process.env.MCP_HELM_TIMEOUT = '100'; // 100ms timeout for testing
      const args = ['list'];

      // Mock long-running process that doesn't complete
      mockChildProcess.on = jest.fn();
      mockChildProcess.stdout!.on = jest.fn();
      mockChildProcess.stderr!.on = jest.fn();

      await expect(executeHelmCommand(args)).rejects.toThrow(
        'helm command timed out after 100ms: helm list',
      );

      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should return raw output for non-JSON responses', async () => {
      const args = ['version', '--short'];
      const textOutput = 'v3.12.0+g4f11b4f';

      // Mock successful execution with text output
      mockChildProcess.on = jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
        return mockChildProcess as any;
      });

      mockChildProcess.stdout!.on = jest.fn((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from(textOutput)), 5);
        }
        return mockChildProcess.stdout as any;
      });

      mockChildProcess.stderr!.on = jest.fn();

      const result = await executeHelmCommand(args);

      expect(result).toEqual({ output: textOutput });
    });

    it('should log debug information when LOG_LEVEL is debug', async () => {
      process.env.MCP_LOG_LEVEL = 'debug';
      const consoleSpy = jest.spyOn(console, 'debug').mockImplementation();

      const args = ['list'];

      // Mock successful execution
      mockChildProcess.on = jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
        return mockChildProcess as any;
      });

      mockChildProcess.stdout!.on = jest.fn((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('[]')), 5);
        }
        return mockChildProcess.stdout as any;
      });

      mockChildProcess.stderr!.on = jest.fn();

      await executeHelmCommand(args);

      expect(consoleSpy).toHaveBeenCalledWith('Executing: helm list');
      expect(consoleSpy).toHaveBeenCalledWith('Using shell: false'); // Security-first approach

      consoleSpy.mockRestore();
    });
  });

  describe('validateHelmCLI', () => {
    it('should validate helm CLI availability', async () => {
      // Mock successful helm version check
      mockChildProcess.on = jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
        return mockChildProcess as any;
      });

      mockChildProcess.stdout!.on = jest.fn();
      mockChildProcess.stderr!.on = jest.fn();

      await expect(validateHelmCLI()).resolves.not.toThrow();

      expect(mockSpawn).toHaveBeenCalledWith('helm', ['version', '--short'], expect.any(Object));
    });

    it('should fallback to use default system shell for helm cli detection (with proper PATH to find helm cli) and also fallback to check in common paths', async () => {
      const fs = await import('fs');
      const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;

      // Mock that helm exists in /usr/local/bin/helm (common path)
      mockExistsSync.mockImplementation((path) => {
        return path === '/usr/local/bin/helm';
      });

      let callCount = 0;
      // Mock first call to fail (PATH lookup), subsequent calls to succeed
      mockChildProcess.on = jest.fn((event, callback) => {
        if (event === 'close') {
          callCount++;
          if (callCount === 1) {
            // First call fails (PATH lookup in validateHelmCLI)
            setTimeout(() => callback(1), 10);
          } else if (callCount === 2) {
            // Second call fails (PATH detection in findHelmExecutable)
            setTimeout(() => callback(1), 10);
          } else {
            // Third call succeeds (using found common path)
            setTimeout(() => callback(0), 10);
          }
        }
        return mockChildProcess as any;
      });

      mockChildProcess.stdout!.on = jest.fn();
      mockChildProcess.stderr!.on = jest.fn();

      await expect(validateHelmCLI()).resolves.not.toThrow();

      // Should try PATH first, then fallback to common path detection
      expect(mockSpawn).toHaveBeenCalledTimes(3); // 1. Initial PATH lookup, 2. findHelmExecutable PATH test, 3. final validation with found path
      expect(mockExistsSync).toHaveBeenCalledWith('/usr/local/bin/helm');

      mockExistsSync.mockReset();
    });

    it('should throw error when helm CLI is not available', async () => {
      // Mock failed helm version check
      mockChildProcess.on = jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => callback(1), 10);
        }
        return mockChildProcess as any;
      });

      mockChildProcess.stdout!.on = jest.fn();
      mockChildProcess.stderr!.on = jest.fn((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('helm: command not found')), 5);
        }
        return mockChildProcess.stderr as any;
      });

      await expect(validateHelmCLI()).rejects.toThrow(
        'helm CLI not found. Please install helm CLI to use helm tools.',
      );
    });
  });
});

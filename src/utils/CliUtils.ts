import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { existsSync } from 'fs';

/**
 * Common CLI utilities for various tools (helm, argo, etc.)
 */

/**
 * Gets common installation paths for a CLI tool based on the platform
 * @param toolName The name of the CLI tool
 * @returns Array of possible installation paths
 */
function getCommonCliPaths(toolName: string): string[] {
  const paths = [
    `/usr/local/bin/${toolName}`,
    `/usr/bin/${toolName}`,
    `/opt/homebrew/bin/${toolName}`,
    `/snap/bin/${toolName}`,
  ];

  if (process.platform === 'win32') {
    paths.push(
      `C:\\Program Files\\${toolName}\\${toolName}.exe`,
      `C:\\ProgramData\\chocolatey\\bin\\${toolName}.exe`,
    );
  }

  return paths.filter(Boolean);
}

/**
 * Finds a CLI executable path
 * @param toolName The name of the CLI tool (e.g., 'helm', 'argo')
 * @param versionArgs Arguments to check version (e.g., ['version', '--short'])
 * @returns Promise with the executable path or null if not found
 */
export async function findCliExecutable(
  toolName: string,
  versionArgs: string[] = ['version'],
): Promise<string | null> {
  // First try to use the tool directly (relies on PATH)
  try {
    await new Promise<void>((resolve, reject) => {
      const testProcess = spawn(toolName, versionArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${toolName} not found in PATH`));
        }
      });

      testProcess.on('error', reject);
    });

    return toolName; // Found in PATH
  } catch {
    // Continue to fallback options
  }

  // Fallback: Check common installation paths
  const commonPaths = getCommonCliPaths(toolName);
  for (const cliPath of commonPaths) {
    if (existsSync(cliPath)) {
      return cliPath;
    }
  }

  return null;
}

/**
 * Executes a CLI command for any tool
 * @param toolName The name of the CLI tool
 * @param args Array of command arguments
 * @param executablePath Optional executable path (for fallback scenarios)
 * @param timeoutEnvVar Environment variable name for timeout (e.g., 'HELM_TIMEOUT', 'ARGO_TIMEOUT')
 * @returns Promise with the command output
 */
export async function executeCliCommand(
  toolName: string,
  args: string[],
  executablePath = toolName,
  timeoutEnvVar = `${toolName.toUpperCase()}_TIMEOUT`,
): Promise<any> {
  const timeout = parseInt(process.env[timeoutEnvVar] || '30000', 10);
  const useShell = false; // Security-first approach: never use shell

  if (process.env.LOG_LEVEL === 'debug') {
    console.debug(`Executing: ${toolName} ${args.join(' ')}`);
    console.debug(`Using shell: ${useShell}`);
  }

  return new Promise((resolve, reject) => {
    const spawnOptions: {
      stdio: ['pipe', 'pipe', 'pipe'];
      env: typeof process.env;
    } = {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    };

    const childProcess: ChildProcessWithoutNullStreams = spawn(executablePath, args, spawnOptions);

    let stdout = '';
    let stderr = '';
    let timeoutHandle: NodeJS.Timeout | null = null;

    // Set up timeout
    if (timeout > 0) {
      timeoutHandle = setTimeout(() => {
        childProcess.kill('SIGTERM');
        reject(
          new Error(
            `${toolName} command timed out after ${timeout}ms: ${toolName} ${args.join(' ')}`,
          ),
        );
      }, timeout);
    }

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    };

    childProcess.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    childProcess.on('close', (code: number | null) => {
      cleanup();

      if (code !== 0) {
        reject(new Error(`${toolName} command failed (exit code ${code}): ${stderr || stdout}`));
        return;
      }

      try {
        // Try to parse as JSON first
        if (stdout.trim().startsWith('{') || stdout.trim().startsWith('[')) {
          resolve(JSON.parse(stdout));
        } else {
          // Return raw output for non-JSON responses
          resolve({ output: stdout.trim() });
        }
      } catch {
        // If JSON parsing fails, return raw output
        resolve({ output: stdout.trim() });
      }
    });

    childProcess.on('error', (err: Error) => {
      cleanup();
      reject(
        new Error(
          `Failed to execute ${toolName} command "${toolName} ${args.join(' ')}": ${err.message}`,
        ),
      );
    });
  });
}

/**
 * Validates that a CLI tool is available with fallback detection
 * @param toolName The name of the CLI tool
 * @param versionArgs Arguments to check version (e.g., ['version', '--short'])
 * @param timeoutEnvVar Environment variable name for timeout
 */
export async function validateCli(
  toolName: string,
  versionArgs: string[] = ['version'],
  timeoutEnvVar = `${toolName.toUpperCase()}_TIMEOUT`,
): Promise<void> {
  try {
    // First try standard PATH lookup
    await executeCliCommand(toolName, versionArgs, toolName, timeoutEnvVar);
  } catch {
    // If PATH lookup fails, try fallback detection
    try {
      const cliExecutable = await findCliExecutable(toolName, versionArgs);
      if (!cliExecutable) {
        throw new Error(
          `${toolName} CLI not found. Please install ${toolName} CLI to use ${toolName} tools.`,
        );
      }

      // Test the found executable
      await executeCliCommand(toolName, versionArgs, cliExecutable, timeoutEnvVar);
    } catch (fallbackError) {
      if (fallbackError instanceof Error && fallbackError.message.includes('timed out')) {
        throw fallbackError; // Re-throw timeout errors as-is
      }
      throw new Error(
        `${toolName} CLI not found. Please install ${toolName} CLI to use ${toolName} tools.`,
      );
    }
  }
}

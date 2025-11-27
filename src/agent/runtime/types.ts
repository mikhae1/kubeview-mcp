import type { Logger } from 'winston';

export interface SandboxOptions {
  workspaceDir: string;
  memoryLimitMb?: number;
  timeoutMs?: number;
  logger?: Logger;
}

export interface SandboxRuntime {
  run(entryFile: string): Promise<void>;
  dispose(): Promise<void>;
}

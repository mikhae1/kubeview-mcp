import { z } from 'zod';
import type { MCPServerConfig } from '../bridge/MCPBridge.js';

export const CodeModeConfigSchema = z.object({
  workspaceDir: z.string().default('./workspace'),
  enablePII: z.boolean().default(false),
  sandbox: z
    .object({
      memoryLimitMb: z.number().optional(),
      timeoutMs: z.number().optional(),
    })
    .default({}),
  servers: z
    .array(
      z.object({
        name: z.string(),
        command: z.string(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string()).optional(),
        timeoutMs: z.number().optional(),
      }),
    )
    .min(1)
    .default([
      {
        name: 'kubeview-mcp',
        command: 'node',
        args: ['./dist/src/cli/cli.js'],
        timeoutMs: 15000,
      },
    ]),
});

export type CodeModeConfig = z.infer<typeof CodeModeConfigSchema>;

export function parseCodeModeConfig(raw: unknown): CodeModeConfig {
  return CodeModeConfigSchema.parse(raw);
}

export function toBridgeConfig(config: CodeModeConfig): MCPServerConfig[] {
  return config.servers.map((server) => ({
    name: server.name,
    command: server.command,
    args: server.args,
    env: server.env,
    timeoutMs: server.timeoutMs,
  }));
}

import fs from 'fs';
import path from 'path';
import { z } from 'zod';

export const CodeModeConfigSchema = z.object({
  workspaceDir: z.string().default('./workspace'),
  enablePII: z.boolean().default(false),
  sandbox: z
    .object({
      memoryLimitMb: z.number().default(256),
      timeoutMs: z.number().default(5000),
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
    .default([]),
});

export type CodeModeConfig = z.infer<typeof CodeModeConfigSchema>;

export function loadCodeModeConfig(cwd: string = process.cwd()): CodeModeConfig {
  const configFiles = ['kube-mcp.code-mode.json', 'kube-mcp.code-mode.example.json'];

  for (const file of configFiles) {
    const configPath = path.resolve(cwd, file);
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const json = JSON.parse(content);
        return CodeModeConfigSchema.parse(json);
      } catch (error) {
        console.warn(`Failed to load config from ${file}:`, error);
      }
    }
  }

  // Return defaults if no config found
  return CodeModeConfigSchema.parse({});
}

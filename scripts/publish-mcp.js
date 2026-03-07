#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const result = spawnSync('mcp-publisher', ['publish', 'server.json'], {
  cwd: rootDir,
  encoding: 'utf8',
});

if (result.stdout) {
  process.stdout.write(result.stdout);
}

if (result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.status === 0) {
  process.exit(0);
}

const output = `${result.stdout || ''}\n${result.stderr || ''}`;
if (output.includes('invalid version: cannot publish duplicate version')) {
  console.log('Version already published to MCP registry, skipping');
  process.exit(0);
}

process.exit(result.status ?? 1);

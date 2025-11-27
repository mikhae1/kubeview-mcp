#!/usr/bin/env node

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { spawn, execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function ensureBuild() {
  const distDir = path.join(projectRoot, 'dist');
  const cliPath = path.join(distDir, 'src', 'cli', 'code-mode.js');
  if (fs.existsSync(cliPath)) {
    return cliPath;
  }

  console.error('[kubeview-mcp] Building project for code-mode CLI...');
  try {
    execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
  } catch (error) {
    console.error('Failed to build project for code-mode CLI.');
    console.error(error);
    process.exit(1);
  }

  if (!fs.existsSync(cliPath)) {
    console.error('code-mode CLI not found after build. Expected at:', cliPath);
    process.exit(1);
  }

  return cliPath;
}

function runCodeMode() {
  const cliPath = ensureBuild();
  // Pass all arguments to the CLI
  const args = process.argv.slice(2);

  const child = spawn('node', [cliPath, ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      KUBE_MCP_FORCE_VM_SANDBOX: '1',
    },
  });

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error('Failed to start code-mode CLI:', error);
    process.exit(1);
  });
}

runCodeMode();

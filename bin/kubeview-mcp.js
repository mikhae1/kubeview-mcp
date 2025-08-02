#!/usr/bin/env node

import { fileURLToPath } from 'url';
import path from 'path';
import { execSync } from 'child_process';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for console output
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function error(message) {
  console.error(`${colors.red}${message}${colors.reset}`);
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const distDir = path.join(projectRoot, 'dist');
  const indexPath = path.join(distDir, 'src', 'index.js');

  // Check if project is built
  if (!fs.existsSync(distDir) || !fs.existsSync(indexPath)) {
    log('🔧 Building kubeview-mcp...', colors.yellow);
    
    try {
      // Install dependencies if node_modules doesn't exist
      const nodeModulesPath = path.join(projectRoot, 'node_modules');
      if (!fs.existsSync(nodeModulesPath)) {
        log('📦 Installing dependencies...', colors.blue);
        execSync('npm install', { cwd: projectRoot, stdio: 'inherit' });
      }

      // Build the project
      execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
      log('✅ Build completed successfully', colors.green);
    } catch (buildError) {
      error('❌ Build failed:');
      console.error(buildError);
      process.exit(1);
    }
  }

  // Run the CLI
  try {
    const { main } = await import(`file://${indexPath}`);
    await main();
  } catch (runError) {
    error('❌ Failed to start kubeview-mcp:');
    console.error(runError);
    process.exit(1);
  }
}

main().catch((err) => {
  error('❌ Unexpected error:');
  console.error(err);
  process.exit(1);
});
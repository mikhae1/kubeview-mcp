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
  console.error(`${color}${message}${colors.reset}`);
}

function error(message) {
  console.error(`${colors.red}${message}${colors.reset}`);
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const distDir = path.join(projectRoot, 'dist');

  // Try both possible locations for the index.js file
  const indexPathFlat = path.join(distDir, 'index.js');
  const indexPathNested = path.join(distDir, 'src', 'index.js');

  // Check if project is built
  if (!fs.existsSync(distDir) || (!fs.existsSync(indexPathFlat) && !fs.existsSync(indexPathNested))) {
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
    // Determine the correct index path after build
    const finalIndexPath = fs.existsSync(indexPathFlat) ? indexPathFlat : indexPathNested;

    // Debug: Check if the file actually exists
    if (!fs.existsSync(finalIndexPath)) {
      error(`❌ Built file not found at either location:`);
      log(`   - Flat: ${indexPathFlat}`, colors.red);
      log(`   - Nested: ${indexPathNested}`, colors.red);

      // List what files do exist
      const distContents = fs.existsSync(distDir) ? fs.readdirSync(distDir) : ['dist directory not found'];
      log(`📂 Contents of dist/: ${distContents.join(', ')}`, colors.blue);

      const srcDir = path.join(distDir, 'src');
      if (fs.existsSync(srcDir)) {
        const srcContents = fs.readdirSync(srcDir);
        log(`📂 Contents of dist/src/: ${srcContents.join(', ')}`, colors.blue);
      }

      process.exit(1);
    }

    log(`🚀 Starting kubeview-mcp from: ${finalIndexPath}`, colors.green);
    const { main } = await import(`file://${finalIndexPath}`);
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

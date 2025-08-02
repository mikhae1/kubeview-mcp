#!/usr/bin/env node

import { fileURLToPath } from 'url';
import path from 'path';
import { execSync, spawn } from 'child_process';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for console output
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

class KubeMCPCLI {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
    this.setupScript = path.join(this.projectRoot, 'bin', 'setup.js');
    this.cliScript = path.join(this.projectRoot, 'dist', 'src', 'cli', 'cli.js');
  }

  log(message, color = colors.reset) {
    console.error(`${color}${message}${colors.reset}`);
  }

  error(message) {
    console.error(`${colors.red}${message}${colors.reset}`);
  }

  info(message) {
    this.log(message, colors.blue);
  }

  // Check if project is built and build if necessary
  ensureBuild() {
    const distDir = path.join(this.projectRoot, 'dist');
    const indexPathFlat = path.join(distDir, 'index.js');
    const indexPathNested = path.join(distDir, 'src', 'index.js');

    // Check if project is built
    if (!fs.existsSync(distDir) || (!fs.existsSync(indexPathFlat) && !fs.existsSync(indexPathNested))) {
      this.log('🔧 Building kubeview-mcp...', colors.yellow);

      try {
        // Install dependencies if node_modules doesn't exist
        const nodeModulesPath = path.join(this.projectRoot, 'node_modules');
        if (!fs.existsSync(nodeModulesPath)) {
          this.log('📦 Installing dependencies...', colors.blue);
          execSync('npm install', { cwd: this.projectRoot, stdio: 'inherit' });
        }

        // Build the project
        execSync('npm run build', { cwd: this.projectRoot, stdio: 'inherit' });
        this.log('✅ Build completed successfully', colors.green);
      } catch (buildError) {
        this.error('❌ Build failed:');
        console.error(buildError);
        process.exit(1);
      }
    }
  }

  // Display help information
  displayHelp() {
    this.log('Kube MCP - Kubernetes MCP Server', colors.cyan);
    console.log('\nA Kubernetes MCP server for Claude Desktop and Cursor IDE');
    console.log('\nUsage:');
    console.log('  kubeview-mcp <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  setup [target]     Setup configuration for Claude Desktop and/or Cursor IDE');
    console.log('                     Targets: claude, cursor, both (default)');
    console.log('  serve              Start the MCP server (default if no command specified)');
    console.log('  build              Build the project');
    console.log('  test               Run tests');
    console.log('  lint               Run linter');
    console.log('  help               Show this help message');
    console.log('  version            Show version information');
    console.log('');
    console.log('Setup Examples:');
    console.log('  kubeview-mcp setup           # Setup both Claude and Cursor');
    console.log('  kubeview-mcp setup claude    # Setup Claude Desktop only');
    console.log('  kubeview-mcp setup cursor    # Setup Cursor IDE only');
    console.log('');
    console.log('Server Examples:');
    console.log('  kubeview-mcp                 # Start MCP server');
    console.log('  kubeview-mcp serve           # Start MCP server explicitly');
    console.log('');
    console.log('Development Examples:');
    console.log('  kubeview-mcp build           # Build the project');
    console.log('  kubeview-mcp test            # Run tests');
    console.log('  kubeview-mcp lint            # Run linter');
    console.log('');
    console.log('For more information, visit: https://github.com/your-org/kubeview-mcp');
  }

  // Display version information
  displayVersion() {
    try {
      const packageJsonPath = path.join(this.projectRoot, 'package.json');
      const packageContent = fs.readFileSync(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(packageContent);
      this.log(`Kube MCP v${packageJson.version}`, colors.cyan);
      console.log(`Description: ${packageJson.description}`);
      console.log(`License: ${packageJson.license}`);
      console.log(`Node.js: ${process.version}`);
      console.log(`Platform: ${process.platform} ${process.arch}`);
    } catch {
      this.error('Could not read package.json');
    }
  }

  // Run setup command
  runSetup(target = 'both') {
    this.info(`Running setup for: ${target}`);
    try {
      const setupProcess = spawn('node', [this.setupScript, target], {
        stdio: 'inherit',
        cwd: this.projectRoot
      });

      setupProcess.on('close', (code) => {
        if (code === 0) {
          this.log('\n✓ Setup completed successfully', colors.green);
        } else {
          this.error(`Setup failed with exit code ${code}`);
          process.exit(code);
        }
      });

      setupProcess.on('error', (error) => {
        this.error(`Setup failed: ${error.message}`);
        process.exit(1);
      });
    } catch (error) {
      this.error(`Failed to run setup: ${error.message}`);
      process.exit(1);
    }
  }

  // Run MCP server using the built index.js file
  async runServer(_args = []) {
    this.ensureBuild();

    const distDir = path.join(this.projectRoot, 'dist');
    const indexPathFlat = path.join(distDir, 'index.js');
    const indexPathNested = path.join(distDir, 'src', 'index.js');

    try {
      // Determine the correct index path after build
      const finalIndexPath = fs.existsSync(indexPathFlat) ? indexPathFlat : indexPathNested;

      // Debug: Check if the file actually exists
      if (!fs.existsSync(finalIndexPath)) {
        this.error(`❌ Built file not found at either location:`);
        this.log(`   - Flat: ${indexPathFlat}`, colors.red);
        this.log(`   - Nested: ${indexPathNested}`, colors.red);

        // List what files do exist
        const distContents = fs.existsSync(distDir) ? fs.readdirSync(distDir) : ['dist directory not found'];
        this.log(`📂 Contents of dist/: ${distContents.join(', ')}`, colors.blue);

        const srcDir = path.join(distDir, 'src');
        if (fs.existsSync(srcDir)) {
          const srcContents = fs.readdirSync(srcDir);
          this.log(`📂 Contents of dist/src/: ${srcContents.join(', ')}`, colors.blue);
        }

        process.exit(1);
      }

      this.log(`🚀 Starting kubeview-mcp from: ${finalIndexPath}`, colors.green);
      const { main } = await import(`file://${finalIndexPath}`);
      await main();
    } catch (runError) {
      this.error('❌ Failed to start kubeview-mcp:');
      console.error(runError);
      process.exit(1);
    }
  }

  // Run npm script
  runNpmScript(script, args = []) {
    this.info(`Running: npm run ${script}`);
    try {
      const command = args.length > 0 ? `npm run ${script} -- ${args.join(' ')}` : `npm run ${script}`;
      execSync(command, {
        cwd: this.projectRoot,
        stdio: 'inherit'
      });
    } catch (error) {
      this.error(`Failed to run npm script: ${script}`);
      process.exit(error.status || 1);
    }
  }

  // Main command router
  async run() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
      // Default to running the server
      await this.runServer();
      return;
    }

    const command = args[0].toLowerCase();
    const commandArgs = args.slice(1);

    switch (command) {
      case 'setup':
        this.runSetup(commandArgs[0] || 'both');
        break;

      case 'serve':
      case 'server':
      case 'start':
        await this.runServer(commandArgs);
        break;

      case 'build':
        this.runNpmScript('build', commandArgs);
        break;

      case 'test':
        this.runNpmScript('test', commandArgs);
        break;

      case 'lint':
        this.runNpmScript('lint', commandArgs);
        break;

      case 'format':
        this.runNpmScript('format', commandArgs);
        break;

      case 'typecheck':
        this.runNpmScript('typecheck', commandArgs);
        break;

      case 'help':
      case '--help':
      case '-h':
        this.displayHelp();
        break;

      case 'version':
      case '--version':
      case '-v':
        this.displayVersion();
        break;

      default:
        // For any other command, pass it directly to the MCP CLI
        this.ensureBuild();
        await this.runServer(args);
        break;
    }
  }
}

// Run the CLI
const cli = new KubeMCPCLI();
cli.run().catch((err) => {
  console.error(`${colors.red}❌ Unexpected error:${colors.reset}`);
  console.error(err);
  process.exit(1);
});

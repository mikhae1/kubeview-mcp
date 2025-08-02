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
    this.setupScript = path.join(__dirname, 'setup.js');
    this.cliScript = path.join(this.projectRoot, 'dist', 'src', 'cli', 'cli.js');
  }

  log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
  }

  error(message) {
    console.error(`${colors.red}${message}${colors.reset}`);
  }

  info(message) {
    this.log(message, colors.blue);
  }

  // Check if project is built
  checkBuild() {
    const distExists = fs.existsSync(path.join(this.projectRoot, 'dist'));
    if (!distExists) {
      this.log('Project not built. Building now...', colors.yellow);
      try {
        execSync('npm run build', { cwd: this.projectRoot, stdio: 'inherit' });
        this.log('✓ Build completed successfully', colors.green);
      } catch (error) {
        this.error('Build failed. Please run "npm run build" manually.');
        process.exit(1);
      }
    }
  }

  // Display help information
  displayHelp() {
    this.log('Kube MCP - Kubernetes MCP Server', colors.cyan);
    console.log('\nA Kubernetes MCP server for Claude Desktop and Cursor IDE');
    console.log('\nUsage:');
    console.log('  npm start <command> [options]');
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
    console.log('  npm start setup           # Setup both Claude and Cursor');
    console.log('  npm start setup claude    # Setup Claude Desktop only');
    console.log('  npm start setup cursor    # Setup Cursor IDE only');
    console.log('');
    console.log('Server Examples:');
    console.log('  npm start                 # Start MCP server');
    console.log('  npm start serve           # Start MCP server explicitly');
    console.log('');
    console.log('Development Examples:');
    console.log('  npm start build           # Build the project');
    console.log('  npm start test            # Run tests');
    console.log('  npm start lint            # Run linter');
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
    } catch (error) {
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

  // Run MCP server
  runServer(args = []) {
    this.checkBuild();
    this.error('Starting Kube MCP server...');

    try {
      const serverProcess = spawn('node', [this.cliScript, ...args], {
        stdio: 'inherit',
        cwd: this.projectRoot
      });

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        this.log('\n\nShutting down server...', colors.yellow);
        serverProcess.kill('SIGINT');
      });

      process.on('SIGTERM', () => {
        this.log('\n\nShutting down server...', colors.yellow);
        serverProcess.kill('SIGTERM');
      });

      serverProcess.on('close', (code) => {
        if (code !== 0 && code !== null) {
          this.error(`Server exited with code ${code}`);
          process.exit(code);
        }
      });

      serverProcess.on('error', (error) => {
        this.error(`Failed to start server: ${error.message}`);
        process.exit(1);
      });
    } catch (error) {
      this.error(`Failed to run server: ${error.message}`);
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
  run() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
      // Default to running the server
      this.runServer();
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
        this.runServer(commandArgs);
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
        this.checkBuild();
        this.runServer(args);
        break;
    }
  }
}

// Run the CLI
const cli = new KubeMCPCLI();
cli.run();

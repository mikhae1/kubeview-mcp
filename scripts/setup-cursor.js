#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

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

console.log(`${colors.blue}Kube MCP Cursor Setup${colors.reset}\n`);

// Get project root
const projectRoot = path.resolve(__dirname, '..');
const cursorDir = path.join(projectRoot, '.cursor');
const mcpConfigPath = path.join(cursorDir, 'mcp.json');

// Default kubeconfig path
const defaultKubeconfig = path.join(os.homedir(), '.kube', 'config');

// Check if .cursor directory exists
if (!fs.existsSync(cursorDir)) {
  console.log(`${colors.yellow}Creating .cursor directory...${colors.reset}`);
  fs.mkdirSync(cursorDir, { recursive: true });
}

// Load existing config or create new one
let config = {
  mcpServers: {}
};

if (fs.existsSync(mcpConfigPath)) {
  console.log(`${colors.yellow}Found existing mcp.json, updating...${colors.reset}`);
  try {
    const content = fs.readFileSync(mcpConfigPath, 'utf8');
    config = JSON.parse(content);
  } catch (error) {
    console.error(`${colors.red}Error reading existing mcp.json:${colors.reset}`, error);
    process.exit(1);
  }
}

// Add or update kube-mcp configuration
config.mcpServers['kube-mcp'] = {
  command: 'node',
  args: ['dist/index.js'],
  cwd: projectRoot,
  env: {
    KUBECONFIG: process.env.KUBECONFIG || defaultKubeconfig,
    LOG_LEVEL: 'info',
    ENABLE_CONNECTION_POOLING: 'true'
  }
};

// Save the configuration
try {
  fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 4));
  console.log(`${colors.green}✓ Successfully configured kube-mcp in ${mcpConfigPath}${colors.reset}\n`);

  console.log('Configuration details:');
  console.log(`  Project root: ${projectRoot}`);
  console.log(`  Kubeconfig: ${config.mcpServers['kube-mcp'].env.KUBECONFIG}`);
  console.log(`  Log level: ${config.mcpServers['kube-mcp'].env.LOG_LEVEL}`);
  console.log(`  Connection pooling: ${config.mcpServers['kube-mcp'].env.ENABLE_CONNECTION_POOLING}\n`);

  console.log(`${colors.yellow}Next steps:${colors.reset}`);
  console.log('1. Build the project: npm run build');
  console.log('2. Restart Cursor IDE');
  console.log('3. Test with: "List all pods in the default namespace"\n');

  // Check if kubeconfig exists
  if (!fs.existsSync(config.mcpServers['kube-mcp'].env.KUBECONFIG)) {
    console.log(`${colors.red}⚠️  Warning: Kubeconfig file not found at ${config.mcpServers['kube-mcp'].env.KUBECONFIG}${colors.reset}`);
    console.log('   Make sure your kubeconfig is properly configured.\n');
  }

} catch (error) {
  console.error(`${colors.red}Error writing mcp.json:${colors.reset}`, error);
  process.exit(1);
}

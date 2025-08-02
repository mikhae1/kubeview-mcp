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
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

class SetupManager {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
    this.defaultKubeconfig = path.join(os.homedir(), '.kube', 'config');
  }

  log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
  }

  error(message, error = null) {
    console.error(`${colors.red}${message}${colors.reset}`, error || '');
  }

  success(message) {
    this.log(`✓ ${message}`, colors.green);
  }

  warning(message) {
    this.log(`⚠️  ${message}`, colors.yellow);
  }

  info(message) {
    this.log(message, colors.blue);
  }

  // Get platform-specific config path
  getConfigPath(appName, configFileName) {
    const platform = os.platform();
    const home = os.homedir();

    // Define platform-specific base paths
    const platformPaths = {
      'darwin': {
        'Claude': path.join(home, 'Library', 'Application Support', 'Claude'),
        'Cursor': path.join(home, '.cursor')
      },
      'win32': {
        'Claude': path.join(home, 'AppData', 'Roaming', 'Claude'),
        'Cursor': path.join(home, 'AppData', 'Roaming', 'Cursor')
      },
      'linux': {
        'Claude': path.join(home, '.config', 'Claude'),
        'Cursor': path.join(home, '.cursor')
      }
    };

    if (!platformPaths[platform]) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    if (!platformPaths[platform][appName]) {
      throw new Error(`Unsupported app: ${appName} on platform: ${platform}`);
    }

    return path.join(platformPaths[platform][appName], configFileName);
  }

  // Get Claude Desktop config path
  getClaudeConfigPath() {
    return this.getConfigPath('Claude', 'claude_desktop_config.json');
  }

  // Get Cursor config path (global)
  getCursorConfigPath() {
    return this.getConfigPath('Cursor', 'mcp.json');
  }

  // Ensure directory exists
  ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
      this.log(`Creating directory: ${dirPath}`, colors.yellow);
      fs.mkdirSync(dirPath, { recursive: true });
      return true;
    }
    return false;
  }

  // Load or create config file
  loadConfig(configPath) {
    const defaultConfig = { mcpServers: {} };

    if (fs.existsSync(configPath)) {
      this.log(`Found existing config at ${configPath}, updating...`, colors.yellow);
      try {
        const content = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(content);

        // Ensure mcpServers exists
        if (!config.mcpServers) {
          config.mcpServers = {};
        }

        return config;
      } catch (error) {
        this.error(`Error reading existing config at ${configPath}:`, error);
        process.exit(1);
      }
    } else {
      this.log(`Creating new config at ${configPath}...`, colors.yellow);
      return defaultConfig;
    }
  }

  // Save config file
  saveConfig(configPath, config, indent = 2) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, indent));
      this.success(`Successfully configured kubeview-mcp in ${configPath}`);
      return true;
    } catch (error) {
      this.error(`Error writing config file ${configPath}:`, error);
      return false;
    }
  }

  // Check if kubeconfig exists
  validateKubeconfig(kubeconfigPath) {
    if (!fs.existsSync(kubeconfigPath)) {
      this.warning(`Kubeconfig file not found at ${kubeconfigPath}`);
      this.log('   Make sure your kubeconfig is properly configured.');
      return false;
    }
    return true;
  }

  // Create MCP server configuration
  createMcpServerConfig() {
    return {
      command: 'npx',
      args: ['-y', 'https://github.com/mikhae1/kubeview-mcp'],
      env: {
        KUBECONFIG: process.env.KUBECONFIG || this.defaultKubeconfig
      }
    };
  }

  // Generic setup method for any IDE
  setupIde(ideName, configPathGetter, jsonIndent = 2, showPlatformNotes = false) {
    this.info(`Setting up ${ideName} configuration...`);

    const configPath = configPathGetter.call(this);
    const configDir = path.dirname(configPath);

    this.log(`Platform detected: ${os.platform()}`, colors.yellow);
    this.log(`${ideName} config path: ${configPath}`, colors.yellow);

    // Ensure directory exists
    this.ensureDirectoryExists(configDir);

    // Load existing config or create new one
    const config = this.loadConfig(configPath);

    // Add or update kubeview-mcp configuration
    config.mcpServers['kubeview-mcp'] = this.createMcpServerConfig();

    // Save configuration
    if (this.saveConfig(configPath, config, jsonIndent)) {
      this.displayInfo(ideName, config);
      if (showPlatformNotes) {
        this.displayPlatformNotes(ideName);
      }
    }
  }

  // Setup Claude Desktop
  setupClaude() {
    this.setupIde('Claude Desktop', this.getClaudeConfigPath, 2, true);
  }

  // Setup Cursor IDE
  setupCursor() {
    this.setupIde('Cursor IDE global', this.getCursorConfigPath, 4, true);
  }

  // Generic display configuration info
  displayInfo(ideName, config) {
    const serverConfig = config.mcpServers['kubeview-mcp'];

    console.log(`\n${ideName} Configuration:`);
    console.log(`  Project root: ${this.projectRoot}`);
    console.log(`  Entry point: ${serverConfig.args[0]}`);
    console.log(`  Kubeconfig: ${serverConfig.env.KUBECONFIG}`);

    if (serverConfig.env.LOG_LEVEL) {
      console.log(`  Log level: ${serverConfig.env.LOG_LEVEL}`);
    }

    this.validateKubeconfig(serverConfig.env.KUBECONFIG);

    const appName = ideName.split(' ')[0]; // Extract first word for app name
    this.log(`\nNext steps for ${appName}:`, colors.yellow);
    console.log('1. Build the project: npm run build');
    console.log(`2. Restart ${ideName.includes('Desktop') ? 'Claude Desktop application' : 'Cursor IDE'}`);
    console.log('3. Test with: "List all pods in the default namespace"');
  }

  // Legacy method for backward compatibility - now uses generic method
  displayClaudeInfo(config) {
    this.displayInfo('Claude Desktop', config);
  }

  // Legacy method for backward compatibility - now uses generic method
  displayCursorInfo(config) {
    this.displayInfo('Cursor IDE Global', config);
  }

  // Generic platform-specific notes display
  displayPlatformNotes(ideName) {
    const appName = ideName.split(' ')[0].toLowerCase(); // Extract first word and make lowercase
    const title = appName === 'claude' ? 'Platform-specific notes:' : `Platform-specific notes for ${ideName}:`;

    this.log(`\n${title}`, colors.blue);

    const platform = os.platform();
    const platformMessages = this.getPlatformMessages(appName, platform);

    platformMessages.forEach(message => console.log(`• ${message}`));
  }

  // Get platform-specific messages for different apps
  getPlatformMessages(appName, platform) {
    const messages = {
      claude: {
        darwin: [
          'On macOS, make sure Claude Desktop is downloaded from the official website',
          'You may need to grant permissions for Claude to access your files'
        ],
        win32: [
          'On Windows, ensure Claude Desktop has proper permissions',
          'You may need to run as administrator for the first setup'
        ],
        linux: [
          'On Linux, ensure the .config directory has proper permissions',
          'Some distributions may require additional setup steps'
        ]
      },
      cursor: {
        darwin: [
          'Global configuration stored in ~/.cursor/mcp.json',
          'Make sure Cursor IDE has proper permissions to access your files',
          'You may need to restart Cursor completely for changes to take effect'
        ],
        win32: [
          'Global configuration stored in %APPDATA%/Cursor/mcp.json',
          'Ensure Cursor IDE has proper permissions',
          'You may need to run as administrator for the first setup'
        ],
        linux: [
          'Global configuration stored in ~/.cursor/mcp.json',
          'Ensure the .cursor directory has proper permissions',
          'Some distributions may require additional setup steps'
        ]
      }
    };

    return messages[appName]?.[platform] || [`Generic setup notes for ${appName} on ${platform}`];
  }

  // Legacy method for backward compatibility
  displayClaudePlatformNotes() {
    this.displayPlatformNotes('Claude Desktop');
  }

  // Legacy method for backward compatibility
  displayCursorPlatformNotes() {
    this.displayPlatformNotes('Cursor IDE');
  }

  // Display usage help
  displayHelp() {
    this.log('Kube MCP Setup Tool', colors.blue);
    console.log('\nUsage:');
    console.log('  npm start setup [target]');
    console.log('  node scripts/setup.js [target]');
    console.log('\nTargets:');
    console.log('  claude   - Setup Claude Desktop configuration');
    console.log('  cursor   - Setup Cursor IDE configuration');
    console.log('  both     - Setup both Claude and Cursor (default)');
    console.log('  help     - Show this help message');
    console.log('\nExamples:');
    console.log('  npm start setup claude');
    console.log('  npm start setup cursor');
    console.log('  npm start setup both');
    console.log('  npm start setup');

    console.log('\nZero-install via npx:\n');
    console.log('npx https://github.com/mikhae1/kubeview-mcp\n');
    console.log('Add the following to your mcp.json (e.g. ~/.cursor/mcp.json):\n');
    console.log(`{
  "mcpServers": {
    "kubeview-mcp": {
      "command": "npx",
      "args": ["https://github.com/mikhae1/kubeview-mcp"],
      "env": {
        "KUBECONFIG": "$HOME/.kube/config"
      }
    }
  }
}`);
  }

  // Main setup method
  run(target = 'both') {
    this.log(`Kube MCP Setup Tool`, colors.cyan);
    console.log();

    switch (target.toLowerCase()) {
      case 'claude':
        this.setupClaude();
        break;
      case 'cursor':
        this.setupCursor();
        break;
      case 'both':
        this.setupClaude();
        console.log('\n' + '='.repeat(50) + '\n');
        this.setupCursor();
        break;
      case 'help':
      case '--help':
      case '-h':
        this.displayHelp();
        break;
      default:
        this.error(`Unknown target: ${target}`);
        this.displayHelp();
        process.exit(1);
    }
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
let target = 'both';

if (args.length > 0) {
  // Handle both "setup claude" and just "claude" formats
  if (args[0] === 'setup' && args[1]) {
    target = args[1];
  } else {
    target = args[0];
  }
}

// Run setup
const setup = new SetupManager();
setup.run(target);

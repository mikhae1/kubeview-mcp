#!/usr/bin/env node

/**
 * CLI script for running Kubernetes, Helm, Argo, and ArgoCD MCP commands directly
 * Usage: node scripts/run-command.js <command_name> [params]
 * Examples:
 *   Kubernetes: node scripts/run-command.js get_pods
 *   Kubernetes: node scripts/run-command.js get_metrics --namespace=kube-system
 *   Helm: node scripts/run-command.js helm_list
 *   Helm: node scripts/run-command.js helm_status --releaseName=argo-workflows --namespace=argo
 *   Argo: node scripts/run-command.js argo_list
 *   ArgoCD: node scripts/run-command.js argocd_app_list
 */

import { KubernetesToolsPlugin } from '../../dist/src/plugins/KubernetesToolsPlugin.js';
import { HelmToolsPlugin } from '../../dist/src/plugins/HelmToolsPlugin.js';
import { ArgoToolsPlugin } from '../../dist/src/plugins/ArgoToolsPlugin.js';
import { ArgoCDToolsPlugin } from '../../dist/src/plugins/ArgoCDToolsPlugin.js';
import { RunCodeTool } from '../../dist/src/tools/RunCodeTool.js';
import * as KubernetesToolClasses from '../../dist/src/tools/kubernetes/index.js';
import * as HelmToolClasses from '../../dist/src/tools/helm/index.js';
import * as ArgoToolClasses from '../../dist/src/tools/argo/index.js';
import * as ArgoCDToolClasses from '../../dist/src/tools/argocd/index.js';

// Create run_code tool instance for CLI usage
function createRunCodeToolForCLI() {
  // Create a minimal tool executor that can call the other CLI commands
  const toolExecutor = async (toolName, args) => {
    // For CLI usage, we'll simulate calling other tools by creating instances
    // This is a simplified version - in a real implementation we'd want to reuse the plugin instances
    try {
      let result;
      if (toolName.startsWith('helm_')) {
        result = await HelmToolsPlugin.executeCommand(toolName, args);
      } else if (toolName.startsWith('argo_') && !toolName.startsWith('argocd_')) {
        result = await ArgoToolsPlugin.executeCommand(toolName, args);
      } else if (toolName.startsWith('argocd_')) {
        result = await ArgoCDToolsPlugin.executeCommand(toolName, args);
      } else {
        // Default to Kubernetes tools
        result = await KubernetesToolsPlugin.executeCommand(toolName, args);
      }
      return result;
    } catch (error) {
      throw new Error(`Tool execution failed: ${error.message}`);
    }
  };

  const runCodeTool = new RunCodeTool();
  runCodeTool.setToolExecutor(toolExecutor);

  // Set up available tools for the run_code tool description
  const allTools = [];

  // Add Kubernetes tools
  // eslint-disable-next-line no-unused-vars
  const { CommonSchemas: _CommonSchemas, BaseTool: _BaseTool, ...kubernetesToolClasses } = KubernetesToolClasses;
  // eslint-disable-next-line no-unused-vars
  for (const [_exportName, ToolClass] of Object.entries(kubernetesToolClasses)) {
    if (typeof ToolClass === 'function') {
      try {
        const instance = new ToolClass();
        if (instance.tool) {
          allTools.push(instance.tool);
        }
      } catch {
        // Ignore instantiation errors
      }
    }
  }

  // Add Helm tools
  // eslint-disable-next-line no-unused-vars
  const { HelmCommonSchemas: _HelmCommonSchemas, HelmBaseTool: _HelmBaseTool, ...helmToolClasses } = HelmToolClasses;
  // eslint-disable-next-line no-unused-vars
  for (const [_exportName, ToolClass] of Object.entries(helmToolClasses)) {
    if (typeof ToolClass === 'function') {
      try {
        const instance = new ToolClass();
        if (instance.tool) {
          allTools.push(instance.tool);
        }
      } catch {
        // Ignore instantiation errors
      }
    }
  }

  // Add Argo tools
  // eslint-disable-next-line no-unused-vars
  const { ArgoCommonSchemas: _ArgoCommonSchemas, ...argoToolClasses } = ArgoToolClasses;
  // eslint-disable-next-line no-unused-vars
  for (const [_exportName, ToolClass] of Object.entries(argoToolClasses)) {
    if (typeof ToolClass === 'function') {
      try {
        const instance = new ToolClass();
        if (instance.tool) {
          allTools.push(instance.tool);
        }
      } catch {
        // Ignore instantiation errors
      }
    }
  }

  // Add ArgoCD tools
  // eslint-disable-next-line no-unused-vars
  const { ArgoCDCommonSchemas: _ArgoCDCommonSchemas, ...argoCDToolClasses } = ArgoCDToolClasses;
  // eslint-disable-next-line no-unused-vars
  for (const [_exportName, ToolClass] of Object.entries(argoCDToolClasses)) {
    if (typeof ToolClass === 'function') {
      try {
        const instance = new ToolClass();
        if (instance.tool) {
          allTools.push(instance.tool);
        }
      } catch {
        // Ignore instantiation errors
      }
    }
  }

  runCodeTool.setTools(allTools);
  return runCodeTool;
}

// Dynamically extract command descriptions from Kubernetes, Helm, Argo, and ArgoCD tool classes
function extractCommandDescriptions() {
  const descriptions = {};

  // Add run_code tool
  const runCodeTool = createRunCodeToolForCLI();
  const tool = runCodeTool.tool;
  const params = {};

  if (tool.inputSchema && tool.inputSchema.properties) {
    for (const [param, schema] of Object.entries(tool.inputSchema.properties)) {
      params[param] = schema.description || 'No description available';
    }
  }

  descriptions[tool.name] = {
    description: tool.description,
    params,
    type: 'run_code',
  };

  // Process Kubernetes tools
  // eslint-disable-next-line no-unused-vars
  const { CommonSchemas, BaseTool, ...kubernetesToolClasses } = KubernetesToolClasses;
  // eslint-disable-next-line no-unused-vars
  for (const [exportName, ToolClass] of Object.entries(kubernetesToolClasses)) {
    // Skip non-class exports (functions, objects, etc.)
    if (typeof ToolClass !== 'function') continue;

    let instance;
    try {
      instance = new ToolClass();
    } catch {
      continue; // Not a class constructor or failed to instantiate
    }

    if (!instance.tool || typeof instance.tool !== 'object') continue;

    const tool = instance.tool;
    const params = {};

    if (tool.inputSchema && tool.inputSchema.properties) {
      for (const [param, schema] of Object.entries(tool.inputSchema.properties)) {
        // If schema is a reference to CommonSchemas, resolve description
        let desc = schema.description;
        if (!desc && CommonSchemas && CommonSchemas[param] && CommonSchemas[param].description) {
          desc = CommonSchemas[param].description;
        }
        params[param] = desc || 'No description available';
      }
    }

    descriptions[tool.name] = {
      description: tool.description,
      params,
      type: 'kubernetes',
    };
  }

  // Process Helm tools
  // eslint-disable-next-line no-unused-vars
  const { HelmCommonSchemas, HelmBaseTool, ...helmToolClasses } = HelmToolClasses;
  // eslint-disable-next-line no-unused-vars
  for (const [exportName, ToolClass] of Object.entries(helmToolClasses)) {
    // Skip non-class exports (functions, objects, etc.)
    if (typeof ToolClass !== 'function') continue;

    let instance;
    try {
      instance = new ToolClass();
    } catch {
      continue; // Not a class constructor or failed to instantiate
    }

    if (!instance.tool || typeof instance.tool !== 'object') continue;

    const tool = instance.tool;
    const params = {};

    if (tool.inputSchema && tool.inputSchema.properties) {
      for (const [param, schema] of Object.entries(tool.inputSchema.properties)) {
        // If schema is a reference to HelmCommonSchemas, resolve description
        let desc = schema.description;
        if (!desc && HelmCommonSchemas && HelmCommonSchemas[param] && HelmCommonSchemas[param].description) {
          desc = HelmCommonSchemas[param].description;
        }
        params[param] = desc || 'No description available';
      }
    }

    descriptions[tool.name] = {
      description: tool.description,
      params,
      type: 'helm',
    };
  }

  // Process Argo tools
  const { ArgoCommonSchemas, ...argoToolClasses } = ArgoToolClasses;
  // eslint-disable-next-line no-unused-vars
  for (const [exportName, ToolClass] of Object.entries(argoToolClasses)) {
    // Skip non-class exports (functions, objects, etc.)
    if (typeof ToolClass !== 'function') continue;

    let instance;
    try {
      instance = new ToolClass();
    } catch {
      continue; // Not a class constructor or failed to instantiate
    }

    if (!instance.tool || typeof instance.tool !== 'object') continue;

    const tool = instance.tool;
    const params = {};

    if (tool.inputSchema && tool.inputSchema.properties) {
      for (const [param, schema] of Object.entries(tool.inputSchema.properties)) {
        // If schema is a reference to ArgoCommonSchemas, resolve description
        let desc = schema.description;
        if (!desc && ArgoCommonSchemas && ArgoCommonSchemas[param] && ArgoCommonSchemas[param].description) {
          desc = ArgoCommonSchemas[param].description;
        }
        params[param] = desc || 'No description available';
      }
    }

    descriptions[tool.name] = {
      description: tool.description,
      params,
      type: 'argo',
    };
  }

  // Process ArgoCD tools
  const { ArgoCDCommonSchemas, ...argoCDToolClasses } = ArgoCDToolClasses;
  // eslint-disable-next-line no-unused-vars
  for (const [exportName, ToolClass] of Object.entries(argoCDToolClasses)) {
    // Skip non-class exports (functions, objects, etc.)
    if (typeof ToolClass !== 'function') continue;

    let instance;
    try {
      instance = new ToolClass();
    } catch {
      continue; // Not a class constructor or failed to instantiate
    }

    if (!instance.tool || typeof instance.tool !== 'object') continue;

    const tool = instance.tool;
    const params = {};

    if (tool.inputSchema && tool.inputSchema.properties) {
      for (const [param, schema] of Object.entries(tool.inputSchema.properties)) {
        // If schema is a reference to ArgoCDCommonSchemas, resolve description
        let desc = schema.description;
        if (!desc && ArgoCDCommonSchemas && ArgoCDCommonSchemas[param] && ArgoCDCommonSchemas[param].description) {
          desc = ArgoCDCommonSchemas[param].description;
        }
        params[param] = desc || 'No description available';
      }
    }

    descriptions[tool.name] = {
      description: tool.description,
      params,
      type: 'argocd',
    };
  }

  return descriptions;
}

const COMMAND_DESCRIPTIONS = extractCommandDescriptions();

const COMMAND_ALIASES = {
  argocd_app_list: { target: 'argocd_app', type: 'argocd', inject: { operation: 'list' } },
  argocd_app_get: { target: 'argocd_app', type: 'argocd', inject: { operation: 'get' } },
  argocd_app_resources: {
    target: 'argocd_app',
    type: 'argocd',
    inject: { operation: 'resources' },
  },
  argocd_app_history: { target: 'argocd_app', type: 'argocd', inject: { operation: 'history' } },
  argocd_app_status: { target: 'argocd_app', type: 'argocd', inject: { operation: 'status' } },
};

for (const [alias, cfg] of Object.entries(COMMAND_ALIASES)) {
  if (COMMAND_DESCRIPTIONS[alias]) continue;
  const base = COMMAND_DESCRIPTIONS[cfg.target];
  if (!base) continue;
  const params = { ...(base.params || {}) };
  delete params.operation;
  COMMAND_DESCRIPTIONS[alias] = {
    description: base.description,
    params,
    type: cfg.type,
  };
}

// Show help for a specific command
function showCommandHelp(commandName) {
  const commandInfo = COMMAND_DESCRIPTIONS[commandName];
  if (!commandInfo) {
    console.error(`Unknown command: ${commandName}`);
    showGeneralHelp();
    return;
  }

  console.log(`\nCommand: ${commandName}`);
  console.log(`Description: ${commandInfo.description}`);
  console.log('\nParameters:');

  if (Object.keys(commandInfo.params).length === 0) {
    console.log('  No parameters required');
  } else {
    for (const [param, desc] of Object.entries(commandInfo.params)) {
      console.log(`  --${param}: ${desc}`);
    }
  }

  console.log('\nExample:');
  console.log(
    `  npm run command -- ${commandName} ${generateExampleParams(commandName, commandInfo.params)}`,
  );
}

// Generate example parameters for a command
function generateExampleParams(commandName, params) {
  const overrides = {
    argocd_app_list: ['--selector=app=myapp'],
    argocd_app_get: ['--appName=my-app'],
    argocd_app_resources: ['--appName=my-app'],
    argocd_app: ['--operation=logs', '--appName=my-app', '--container=main'],
    argocd_app_history: ['--appName=my-app'],
    argocd_app_status: ['--appName=my-app'],
  };

  if (overrides[commandName]) {
    return overrides[commandName].join(' ');
  }

  const examples = [];
  for (const param of Object.keys(params)) {
    if (param === 'random_string') continue;

    // Create simple examples based on parameter name
    if (param === 'namespace') examples.push('--namespace=default');
    else if (param === 'resourceType') examples.push('--resourceType=pod');
    else if (param === 'name' || param === 'podName') examples.push(`--${param}=example-name`);
    else if (param === 'appName') examples.push('--appName=my-app');
    else if (param === 'releaseName') examples.push('--releaseName=my-release');
    else if (param === 'workflowName') examples.push('--workflowName=my-workflow');
    else if (param === 'tailLines') examples.push('--tailLines=100');
    else if (param === 'limit') examples.push('--limit=50');
    else if (param === 'revision') examples.push('--revision=1');
    else if (param === 'outputFormat') examples.push('--outputFormat=json');
    else if (param === 'container') examples.push('--container=main');
    else if (param === 'timestamps' || param === 'previous' || param === 'fetchPodSpecs' || param === 'allValues' || param === 'showResources' || param === 'refresh') examples.push(`--${param}=true`);
  }

  // Only include a few examples to keep it readable
  return examples.slice(0, 2).join(' ');
}

function pickExampleCommand(type, preferred) {
  for (const name of preferred) {
    const info = COMMAND_DESCRIPTIONS[name];
    if (info && info.type === type) return name;
  }
  for (const [name, info] of Object.entries(COMMAND_DESCRIPTIONS)) {
    if (info.type === type) return name;
  }
  return null;
}

// Show general help
function showGeneralHelp() {
  console.log('\nUsage: npm run command -- <command_name> [params]');

  // Separate commands by type
  const kubernetesCommands = {};
  const helmCommands = {};
  const argoCommands = {};
  const argoCDCommands = {};
  const runCodeCommands = {};

  for (const [command, info] of Object.entries(COMMAND_DESCRIPTIONS)) {
    if (info.type === 'run_code') {
      runCodeCommands[command] = info;
    } else if (info.type === 'helm') {
      helmCommands[command] = info;
    } else if (info.type === 'argo') {
      argoCommands[command] = info;
    } else if (info.type === 'argocd') {
      argoCDCommands[command] = info;
    } else {
      kubernetesCommands[command] = info;
    }
  }

  console.log('\nCode execution commands:');
  for (const [command, info] of Object.entries(runCodeCommands)) {
    console.log(`  ${command.padEnd(20)} ${info.description}`);
  }

  console.log('\nKubernetes commands:');
  for (const [command, info] of Object.entries(kubernetesCommands)) {
    console.log(`  ${command.padEnd(20)} ${info.description}`);
  }

  console.log('\nHelm commands:');
  for (const [command, info] of Object.entries(helmCommands)) {
    console.log(`  ${command.padEnd(20)} ${info.description}`);
  }

  console.log('\nArgo commands:');
  for (const [command, info] of Object.entries(argoCommands)) {
    console.log(`  ${command.padEnd(20)} ${info.description}`);
  }

  console.log('\nArgoCD commands:');
  for (const [command, info] of Object.entries(argoCDCommands)) {
    console.log(`  ${command.padEnd(20)} ${info.description}`);
  }

  console.log('\nFor command-specific help:');
  console.log('  npm run command help <command_name>');
  console.log('\nExamples:');

  const codeCmd = pickExampleCommand('run_code', ['run_code']);
  const kubeCmd = pickExampleCommand('kubernetes', ['kube_list', 'kube_metrics', 'kube_get', 'kube_logs']);
  const helmCmd = pickExampleCommand('helm', ['helm_list', 'helm_get']);
  const argoCmd = pickExampleCommand('argo', ['argo_list', 'argo_get', 'argo_logs']);
  const argoCdCmd = pickExampleCommand('argocd', ['argocd_app_list', 'argocd_app_get', 'argocd_app']);

  if (codeCmd) {
    console.log('  # Code execution');
    console.log(
      '  npm run command -- run_code --code="console.log(await tools.kubernetes.list({}));"',
    );
  }

  if (kubeCmd) {
    console.log('  # Kubernetes');
    console.log(`  npm run command -- ${kubeCmd} ${generateExampleParams(kubeCmd, COMMAND_DESCRIPTIONS[kubeCmd].params)}`);
  }

  if (helmCmd) {
    console.log('  # Helm');
    console.log(`  npm run command -- ${helmCmd} ${generateExampleParams(helmCmd, COMMAND_DESCRIPTIONS[helmCmd].params)}`);
  }

  if (argoCmd) {
    console.log('  # Argo');
    console.log(`  npm run command -- ${argoCmd} ${generateExampleParams(argoCmd, COMMAND_DESCRIPTIONS[argoCmd].params)}`);
  }

  if (argoCdCmd) {
    console.log('  # ArgoCD');
    console.log(
      `  npm run command -- ${argoCdCmd} ${generateExampleParams(argoCdCmd, COMMAND_DESCRIPTIONS[argoCdCmd].params)}`,
    );
  }
}

// Parse parameters from command line arguments
function parseParams() {
  const params = {};
  for (let i = 3; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2).split('=')[0];
      const splitValue = arg.slice(2).split('=').slice(1).join('=');

      if (splitValue === '') {
        // Check if the next argument exists and doesn't start with '--'
        // If so, treat it as the value for this parameter
        if (i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) {
          const nextArg = process.argv[i + 1];
          // Try to parse numbers and booleans
          if (nextArg === 'true') params[key] = true;
          else if (nextArg === 'false') params[key] = false;
          else if (!isNaN(Number(nextArg))) params[key] = Number(nextArg);
          else params[key] = nextArg;
          i++; // Skip the next argument since we consumed it
        } else {
          // Handle boolean flags
          params[key] = true;
        }
      } else {
        // Handle key=value format, but preserve all content after the first =
        let value = splitValue;
        // Try to parse numbers and booleans
        if (value === 'true') params[key] = true;
        else if (value === 'false') params[key] = false;
        else if (!isNaN(Number(value))) params[key] = Number(value);
        else params[key] = value;
      }
    }
  }
  return params;
}

async function main() {
  // Get the command from command line arguments
  const commandName = process.argv[2];

  // Handle help requests
  if (!commandName || commandName === 'help') {
    if (process.argv[3] && COMMAND_DESCRIPTIONS[process.argv[3]]) {
      showCommandHelp(process.argv[3]);
    } else {
      showGeneralHelp();
    }
    return;
  }

  // Check if command exists
  if (!COMMAND_DESCRIPTIONS[commandName]) {
    console.error(`Error: Unknown command '${commandName}'`);
    showGeneralHelp();
    process.exit(1);
  }

  // Parse parameters from command line
  const params = parseParams();

  const aliasCfg = COMMAND_ALIASES[commandName];
  const resolvedCommandName = aliasCfg?.target || commandName;
  if (aliasCfg?.inject && params && typeof params === 'object') {
    for (const [k, v] of Object.entries(aliasCfg.inject)) {
      if (params[k] === undefined) params[k] = v;
    }
  }

  // Display command info
  console.log(`Executing command: ${commandName}`);
  if (Object.keys(params).length > 0) {
    console.log('Parameters:', JSON.stringify(params, null, 2));
  } else {
    console.log('No parameters provided');
  }

  try {
    let result;
    const commandInfo = COMMAND_DESCRIPTIONS[commandName];

    if (commandInfo.type === 'run_code') {
      // Handle run_code tool execution
      console.log('\nExecuting run_code in sandboxed environment...');
      const runCodeTool = createRunCodeToolForCLI();
      result = await runCodeTool.execute(params);
    } else if (commandInfo.type === 'helm') {
      // Use HelmToolsPlugin for Helm commands
      console.log('\nExecuting Helm CLI command...');
      result = await HelmToolsPlugin.executeCommand(resolvedCommandName, params);
    } else if (commandInfo.type === 'argo') {
      // Use ArgoToolsPlugin for Argo commands
      console.log('\nExecuting Argo CLI command...');
      result = await ArgoToolsPlugin.executeCommand(resolvedCommandName, params);
    } else if (commandInfo.type === 'argocd') {
      // Use ArgoCDToolsPlugin for ArgoCD commands
      result = await ArgoCDToolsPlugin.executeCommand(resolvedCommandName, params);
      const transport = result && typeof result === 'object' ? result.__transport : undefined;
      if (transport === 'k8s') {
        console.log('\nExecuting ArgoCD API call...');
      } else {
        console.log('\nExecuting ArgoCD CLI command...');
      }
    } else {
      // Use KubernetesToolsPlugin for Kubernetes commands
      console.log('\nConnecting to Kubernetes cluster...');
      result = await KubernetesToolsPlugin.executeCommand(resolvedCommandName, params);
    }

    // Output the result
    console.log('\nResult:');
    if (result && result.output && typeof result.output === 'string') {
      // For YAML or text output, print directly
      console.log(result.output);
    } else {
      // For JSON output, pretty print
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error('Error executing command:', error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});

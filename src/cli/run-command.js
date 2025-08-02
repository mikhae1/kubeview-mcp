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
import * as KubernetesToolClasses from '../../dist/src/tools/kubernetes/index.js';
import * as HelmToolClasses from '../../dist/src/tools/helm/index.js';
import * as ArgoToolClasses from '../../dist/src/tools/argo/index.js';
import * as ArgoCDToolClasses from '../../dist/src/tools/argocd/index.js';

// Dynamically extract command descriptions from Kubernetes, Helm, Argo, and ArgoCD tool classes
function extractCommandDescriptions() {
  const descriptions = {};

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
  console.log(`  npm run command -- ${commandName} ${generateExampleParams(commandInfo.params)}`);
}

// Generate example parameters for a command
function generateExampleParams(params) {
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

// Show general help
function showGeneralHelp() {
  console.log('\nUsage: npm run command -- <command_name> [params]');

  // Separate commands by type
  const kubernetesCommands = {};
  const helmCommands = {};
  const argoCommands = {};
  const argoCDCommands = {};

  for (const [command, info] of Object.entries(COMMAND_DESCRIPTIONS)) {
    if (info.type === 'helm') {
      helmCommands[command] = info;
    } else if (info.type === 'argo') {
      argoCommands[command] = info;
    } else if (info.type === 'argocd') {
      argoCDCommands[command] = info;
    } else {
      kubernetesCommands[command] = info;
    }
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
  console.log('  # Kubernetes');
  console.log('  npm run command -- get_pods');
  console.log('  npm run command -- get_metrics --namespace=kube-system');
  console.log('  npm run command -- pod_logs --podName=nginx-pod --namespace=default --tailLines=100');
  console.log('  # Helm');
  console.log('  npm run command -- helm_list');
  console.log('  npm run command -- helm_status --releaseName=my-release --namespace=default');
  console.log('  npm run command -- helm_get_values --releaseName=my-release --namespace=default');
  console.log('  # Argo');
  console.log('  npm run command -- argo_list');
  console.log('  npm run command -- argo_logs --workflowName=my-workflow --namespace=argo');
  console.log('  npm run command -- argo_cron_list');
  console.log('  # ArgoCD');
  console.log('  npm run command -- argocd_app_list');
  console.log('  npm run command -- argocd_app_get --appName=my-app');
  console.log('  npm run command -- argocd_app_logs --appName=my-app --container=main');
}

// Parse parameters from command line arguments
function parseParams() {
  const params = {};
  for (let i = 3; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      if (value === undefined) {
        // Handle boolean flags
        params[key] = true;
      } else {
        // Handle key-value pairs
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

    if (commandInfo.type === 'helm') {
      // Use HelmToolsPlugin for Helm commands
      console.log('\nExecuting Helm CLI command...');
      result = await HelmToolsPlugin.executeCommand(commandName, params);
    } else if (commandInfo.type === 'argo') {
      // Use ArgoToolsPlugin for Argo commands
      console.log('\nExecuting Argo CLI command...');
      result = await ArgoToolsPlugin.executeCommand(commandName, params);
    } else if (commandInfo.type === 'argocd') {
      // Use ArgoCDToolsPlugin for ArgoCD commands
      console.log('\nExecuting ArgoCD CLI command...');
      result = await ArgoCDToolsPlugin.executeCommand(commandName, params);
    } else {
      // Use KubernetesToolsPlugin for Kubernetes commands
      console.log('\nConnecting to Kubernetes cluster...');
      result = await KubernetesToolsPlugin.executeCommand(commandName, params);
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

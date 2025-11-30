#!/usr/bin/env node
/**
 * Prompts for version and updates package.json and server.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  const currentVersion = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')).version;
  console.log(`Current version: ${currentVersion}`);

  const newVersion = await question('Enter new version: ');

  if (!newVersion || !newVersion.trim()) {
    console.error('Error: Version cannot be empty');
    process.exit(1);
  }

  const version = newVersion.trim();

  // Update package.json
  const packageJsonPath = join(rootDir, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  packageJson.version = version;
  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  console.log(`Updated package.json version to ${version}`);

  // Update server.json
  const serverJsonPath = join(rootDir, 'server.json');
  const serverJson = JSON.parse(readFileSync(serverJsonPath, 'utf8'));
  serverJson.version = version;
  if (serverJson.packages && serverJson.packages[0]) {
    serverJson.packages[0].version = version;
  }
  writeFileSync(serverJsonPath, JSON.stringify(serverJson, null, 2) + '\n');
  console.log(`Updated server.json version to ${version}`);

  try {
    execSync('git add package.json server.json CHANGELOG.md', {
      cwd: rootDir,
      stdio: 'inherit'
    });
    console.log('Staged package.json, server.json, and CHANGELOG.md for release');
  } catch (error) {
    console.error('Warning: Failed to stage files:', error.message);
    process.exit(1);
  }

  rl.close();
}

main().catch(err => {
  console.error('Error:', err);
  rl.close();
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Prompts for version and updates package.json, server.json, version.ts, and CHANGELOG.md
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

function getLastTag() {
  try {
    return execSync('git describe --tags --abbrev=0', { encoding: 'utf8', cwd: rootDir }).trim();
  } catch {
    return null;
  }
}

function getCommitsSinceTag(tag) {
  try {
    const range = tag ? `${tag}..HEAD` : 'HEAD';
    const commits = execSync(`git log ${range} --pretty=format:"%h|%s|%b" --no-merges`, {
      encoding: 'utf8',
      cwd: rootDir
    }).trim();
    return commits ? commits.split('\n')
      .map(line => {
        const [hash, subject, ...bodyParts] = line.split('|');
        const body = bodyParts.join('|');
        return { hash, subject: subject || '', body: body || '' };
      })
      .filter(commit => commit.subject && commit.hash) : [];
  } catch {
    return [];
  }
}

function categorizeCommit(commit) {
  const subject = (commit.subject || '').toLowerCase();
  const body = (commit.body || '').toLowerCase();
  const combined = `${subject} ${body}`;

  if (subject.startsWith('feat:') || subject.startsWith('add:') || /^(add|feature|feat)\b/i.test(subject)) {
    return 'Added';
  }
  if (subject.startsWith('fix:') || subject.startsWith('bug:') || /^(fix|bug|resolve)\b/i.test(subject)) {
    return 'Fixed';
  }
  if (subject.startsWith('chore:') || subject.startsWith('refactor:') || subject.startsWith('change:') || /^(change|refactor|update|improve|enhance)\b/i.test(subject)) {
    return 'Changed';
  }
  if (subject.startsWith('remove:') || subject.startsWith('delete:') || /^(remove|delete|deprecate)\b/i.test(subject)) {
    return 'Removed';
  }
  if (subject.startsWith('security:') || /^(security|vulnerability)\b/i.test(subject)) {
    return 'Security';
  }

  if (/fix|bug|error|issue|problem/i.test(combined)) {
    return 'Fixed';
  }
  if (/add|new|implement|create|introduce/i.test(combined)) {
    return 'Added';
  }

  return 'Changed';
}

function replaceVersionTokens(message, version) {
  const patterns = [
    /\$\(\s*node\s+-p\s+["']?require\([^)]*package\.json[^)]*\)\.version["']?\s*\)/gi,
    /\$\{?npm_package_version\}?/gi,
    /%npm_package_version%/gi
  ];

  return patterns.reduce((text, regex) => text.replace(regex, version), message);
}

function formatCommitMessage(subject, version) {
  if (!subject) return '';
  const cleaned = subject
    .replace(/^(feat|fix|chore|refactor|add|change|remove|security|docs|style|test|perf|ci|build|revert):\s*/i, '')
    .trim();

  return replaceVersionTokens(cleaned, version);
}

function generateChangelogEntry(version, date, commits) {
  if (commits.length === 0) {
    return `## [${version}] - ${date}\n\n### Changed\n- Version bump to ${version}\n\n`;
  }

  const categorized = {
    Added: [],
    Changed: [],
    Fixed: [],
    Removed: [],
    Security: []
  };

  commits.forEach(commit => {
    const category = categorizeCommit(commit);
    const message = formatCommitMessage(commit.subject, version);
    if (message) {
      categorized[category].push(`- **${message}**`);
    }
  });

  let entry = `## [${version}] - ${date}\n\n`;

  ['Added', 'Changed', 'Fixed', 'Removed', 'Security'].forEach(category => {
    if (categorized[category].length > 0) {
      entry += `### ${category}\n`;
      categorized[category].forEach(item => {
        entry += `${item}\n`;
      });
      entry += '\n';
    }
  });

  return entry;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeExistingVersionEntries(changelog, version) {
  const versionPattern = new RegExp(`\\n## \\[${escapeRegExp(version)}\\][\\s\\S]*?(?=\\n## \\[|$)`, 'g');
  let updated = changelog.replace(versionPattern, '\n').replace(/\n{3,}/g, '\n\n');
  const leadingPattern = new RegExp(`^## \\[${escapeRegExp(version)}\\][\\s\\S]*?(?=\\n## \\[|$)`, 'g');
  updated = updated.replace(leadingPattern, '').replace(/\n{3,}/g, '\n\n');
  return updated;
}

function updateChangelog(version, date, commits) {
  const changelogPath = join(rootDir, 'CHANGELOG.md');
  const changelog = readFileSync(changelogPath, 'utf8');

  const sanitizedChangelog = removeExistingVersionEntries(changelog, version);

  const newEntry = generateChangelogEntry(version, date, commits);

  const unreleasedIndex = sanitizedChangelog.indexOf('## [Unreleased]');
  if (unreleasedIndex === -1) {
    throw new Error('Could not find [Unreleased] section in CHANGELOG.md');
  }

  const nextSectionIndex = sanitizedChangelog.indexOf('\n## [', unreleasedIndex + 1);
  const insertIndex = nextSectionIndex === -1
    ? sanitizedChangelog.indexOf('\n', unreleasedIndex) + 1
    : nextSectionIndex;

  const updatedChangelog = sanitizedChangelog.slice(0, insertIndex) + '\n' + newEntry + sanitizedChangelog.slice(insertIndex);
  writeFileSync(changelogPath, updatedChangelog);
  console.log(`Updated CHANGELOG.md with version ${version}`);
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

  // Generate version.ts
  const versionTs = `// Auto-generated by scripts/update-version.js - DO NOT EDIT
export const VERSION = '${version}';\n`;
  writeFileSync(join(rootDir, 'src', 'version.ts'), versionTs);
  console.log(`Generated src/version.ts with version ${version}`);

  // Update CHANGELOG.md
  const lastTag = getLastTag();
  const commits = getCommitsSinceTag(lastTag);
  const date = new Date().toISOString().split('T')[0];

  updateChangelog(version, date, commits);

  // Stage files
  try {
    execSync('git add package.json server.json CHANGELOG.md', {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    console.log('Staged package.json, server.json, and CHANGELOG.md');
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

#!/usr/bin/env node
/**
 * Generates src/version.ts from package.json version and updates CHANGELOG.md
 * Run before TypeScript compilation to bake version into the build.
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

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
    return commits ? commits.split('\n').map(line => {
      const [hash, subject, ...bodyParts] = line.split('|');
      const body = bodyParts.join('|');
      return { hash, subject, body };
    }) : [];
  } catch {
    return [];
  }
}

function categorizeCommit(commit) {
  const subject = commit.subject.toLowerCase();
  const body = commit.body.toLowerCase();
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

  // Default categorization based on keywords
  if (/fix|bug|error|issue|problem/i.test(combined)) {
    return 'Fixed';
  }
  if (/add|new|implement|create|introduce/i.test(combined)) {
    return 'Added';
  }

  return 'Changed';
}

function replaceVersionTokens(message, version) {
  // Normalize common version placeholders that may appear in commit messages
  const patterns = [
    /\$\(\s*node\s+-p\s+["']?require\([^)]*package\.json[^)]*\)\.version["']?\s*\)/gi,
    /\$\{?npm_package_version\}?/gi,
    /%npm_package_version%/gi
  ];

  return patterns.reduce((text, regex) => text.replace(regex, version), message);
}

function formatCommitMessage(subject, version) {
  // Remove common prefixes
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
  // If entry was at the very top (no leading newline), ensure header removal
  const leadingPattern = new RegExp(`^## \\[${escapeRegExp(version)}\\][\\s\\S]*?(?=\\n## \\[|$)`, 'g');
  updated = updated.replace(leadingPattern, '').replace(/\n{3,}/g, '\n\n');
  return updated;
}

function updateChangelog(version, date, commits) {
  const changelogPath = join(rootDir, 'CHANGELOG.md');
  const changelog = readFileSync(changelogPath, 'utf8');

  const sanitizedChangelog = removeExistingVersionEntries(changelog, version);

  const newEntry = generateChangelogEntry(version, date, commits);

  // Insert after ## [Unreleased] section
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
  console.error(`Updated CHANGELOG.md with version ${version}`);
}

function main() {
  const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
  const version = packageJson.version;

  // Generate version.ts
  const versionTs = `// Auto-generated by scripts/build-release.js - DO NOT EDIT
export const VERSION = '${version}';\n`;
  writeFileSync(join(rootDir, 'src', 'version.ts'), versionTs);
  console.error(`Generated src/version.ts with version ${version}`);

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
    console.error('Staged package.json, server.json, and CHANGELOG.md');
  } catch (error) {
    console.error('Warning: Failed to stage files:', error.message);
    process.exit(1);
  }
}

main();

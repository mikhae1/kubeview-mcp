#!/usr/bin/env node
import { main } from '../index.js';

function isMainModule(): boolean {
  try {
    // Check if this file is being executed directly
    // This works for both direct execution and npx
    const mainFile = process.argv[1];
    return Boolean(
      mainFile &&
        (mainFile.endsWith('cli.js') ||
          mainFile.endsWith('cli.ts') ||
          mainFile.includes('kubeview-mcp')),
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

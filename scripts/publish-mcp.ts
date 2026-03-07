#!/usr/bin/env tsx

import { publishMcp } from './release-publish';

try {
  publishMcp();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

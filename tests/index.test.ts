import { VERSION } from '../src/index.js';

describe('Kubernetes MCP Server', () => {
  it('should have a valid semver version', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

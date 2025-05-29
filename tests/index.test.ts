import { VERSION } from '../src/index.js';

describe('Kubernetes MCP Server', () => {
  it('should have a version', () => {
    expect(VERSION).toBe('0.1.0');
  });

  it('should pass basic test', () => {
    expect(1 + 1).toBe(2);
  });
});

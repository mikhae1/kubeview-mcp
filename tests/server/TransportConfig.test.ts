import { loadTransportConfig } from '../../src/server/TransportConfig.js';

describe('loadTransportConfig', () => {
  it('does not enforce HTTP host validation when transport remains stdio', () => {
    expect(() =>
      loadTransportConfig({
        MCP_HTTP_HOST: '0.0.0.0',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('still enforces HTTP host validation in HTTP mode', () => {
    expect(() =>
      loadTransportConfig({
        MCP_TRANSPORT: 'http',
        MCP_HTTP_HOST: '0.0.0.0',
      } as NodeJS.ProcessEnv),
    ).toThrow('MCP_HTTP_HOST=0.0.0.0 requires explicit MCP_ALLOWED_HOSTS');
  });
});

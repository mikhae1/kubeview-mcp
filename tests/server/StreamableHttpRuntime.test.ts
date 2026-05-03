import { jest } from '@jest/globals';
import { Readable } from 'node:stream';
import { StreamableHttpRuntime } from '../../src/server/StreamableHttpRuntime.js';

const transportInstances: MockStreamableTransport[] = [];
let nextSessionId = 'session-1';
let transportHandleRequestImpl: (
  transport: MockStreamableTransport,
  req: { method?: string },
  res: MockServerResponse,
  body?: unknown,
) => Promise<void>;

class MockStreamableTransport {
  public sessionId?: string;
  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: (message: unknown) => void;
  public readonly start = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  public readonly send = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  public readonly close = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  public readonly handleRequest = jest.fn(
    async (req: { method?: string }, res: MockServerResponse, body?: unknown) =>
      transportHandleRequestImpl(this, req, res, body),
  );

  constructor(
    readonly options: {
      sessionIdGenerator?: () => string;
      onsessioninitialized?: (sessionId: string) => void | Promise<void>;
      onsessionclosed?: (sessionId: string) => void | Promise<void>;
    } = {},
  ) {
    transportInstances.push(this);
  }
}

jest.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: jest.fn().mockImplementation((options) => {
    return new MockStreamableTransport(options as any);
  }),
}));

function createRequest(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
  url = '/mcp',
): Readable & { method: string; url: string; headers: Record<string, string> } {
  const stream = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as Readable & {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  stream.method = method;
  stream.url = url;
  stream.headers = headers;
  return stream;
}

class MockServerResponse {
  public statusCode = 200;
  public headersSent = false;
  public body = '';
  private readonly headers = new Map<string, string>();

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  end(chunk?: string): void {
    this.headersSent = true;
    if (chunk) {
      this.body += chunk;
    }
  }
}

class MockHttpServer {
  private readonly listeners = new Map<string, Set<(...args: any[]) => void>>();
  private boundAddress: { address: string; port: number } | null = null;

  once(event: string, handler: (...args: any[]) => void): this {
    const wrapped = (...args: any[]) => {
      this.off(event, wrapped);
      handler(...args);
    };
    return this.on(event, wrapped);
  }

  on(event: string, handler: (...args: any[]) => void): this {
    const handlers = this.listeners.get(event) ?? new Set();
    handlers.add(handler);
    this.listeners.set(event, handlers);
    return this;
  }

  off(event: string, handler: (...args: any[]) => void): this {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  listen(port?: number, host?: string): this {
    this.boundAddress = {
      address: host ?? '127.0.0.1',
      port: port === 0 ? 43127 : (port ?? 0),
    };
    this.emit('listening');
    return this;
  }

  close(callback?: (error?: Error) => void): this {
    callback?.();
    return this;
  }

  address(): { address: string; port: number } | null {
    return this.boundAddress;
  }

  private emit(event: string, ...args: any[]): void {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(...args);
    }
  }
}

describe('StreamableHttpRuntime', () => {
  beforeEach(() => {
    transportInstances.length = 0;
    nextSessionId = 'session-1';
    transportHandleRequestImpl = async (transport, req, res) => {
      if (!transport.sessionId && transport.options.sessionIdGenerator) {
        transport.sessionId = nextSessionId;
        await transport.options.onsessioninitialized?.(transport.sessionId);
        res.setHeader('mcp-session-id', transport.sessionId);
      }

      if (req.method === 'DELETE' && transport.sessionId) {
        await transport.options.onsessionclosed?.(transport.sessionId);
      }

      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
    };
  });

  it('creates a stateful session on initialize and reuses it on follow-up requests', async () => {
    const appServer = {
      startWithTransport: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      stop: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      logStartupBegin: jest.fn(),
      logStartupSuccess: jest.fn(),
    };
    const runtime = new StreamableHttpRuntime(
      {
        host: '127.0.0.1',
        port: 3000,
        path: '/mcp',
        stateless: false,
        jsonResponse: true,
        allowedHosts: ['127.0.0.1'],
      },
      { createAppServer: async () => appServer as any },
    );

    const initReq = createRequest(
      'POST',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'jest', version: '1.0.0' },
        },
      },
      { host: '127.0.0.1' },
    );
    const initRes = new MockServerResponse();
    await runtime.handleNodeRequest(initReq as any, initRes as any);

    expect(appServer.startWithTransport).toHaveBeenCalledTimes(1);
    expect(initRes.getHeader('mcp-session-id')).toBe('session-1');
    expect(transportInstances).toHaveLength(1);

    const callReq = createRequest(
      'POST',
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { host: '127.0.0.1', 'mcp-session-id': 'session-1' },
    );
    const callRes = new MockServerResponse();
    await runtime.handleNodeRequest(callReq as any, callRes as any);

    expect(transportInstances[0].handleRequest).toHaveBeenCalledTimes(2);
    expect(callRes.statusCode).toBe(200);
  });

  it('returns 400 for a follow-up POST request without a session id', async () => {
    const runtime = new StreamableHttpRuntime(
      {
        host: '127.0.0.1',
        port: 3000,
        path: '/mcp',
        stateless: false,
        jsonResponse: true,
        allowedHosts: ['127.0.0.1'],
      },
      { createAppServer: async () => ({}) as any },
    );

    const req = createRequest(
      'POST',
      { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
      { host: '127.0.0.1' },
    );
    const res = new MockServerResponse();
    await runtime.handleNodeRequest(req as any, res as any);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toContain('No valid session ID provided');
  });

  it('returns 404 for an unknown session id', async () => {
    const runtime = new StreamableHttpRuntime(
      {
        host: '127.0.0.1',
        port: 3000,
        path: '/mcp',
        stateless: false,
        jsonResponse: true,
        allowedHosts: ['127.0.0.1'],
      },
      { createAppServer: async () => ({}) as any },
    );

    const req = createRequest(
      'POST',
      { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} },
      { host: '127.0.0.1', 'mcp-session-id': 'missing-session' },
    );
    const res = new MockServerResponse();
    await runtime.handleNodeRequest(req as any, res as any);

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.message).toContain('Session not found');
  });

  it('rejects requests with invalid host or origin headers', async () => {
    const runtime = new StreamableHttpRuntime(
      {
        host: '127.0.0.1',
        port: 3000,
        path: '/mcp',
        stateless: false,
        jsonResponse: true,
        allowedHosts: ['127.0.0.1'],
        allowedOrigins: ['https://allowed.example'],
      },
      { createAppServer: async () => ({}) as any },
    );

    const invalidHostReq = createRequest('GET', undefined, { host: 'evil.example' });
    const invalidHostRes = new MockServerResponse();
    await runtime.handleNodeRequest(invalidHostReq as any, invalidHostRes as any);

    expect(invalidHostRes.statusCode).toBe(403);

    const invalidOriginReq = createRequest('GET', undefined, {
      host: '127.0.0.1',
      origin: 'https://evil.example',
    });
    const invalidOriginRes = new MockServerResponse();
    await runtime.handleNodeRequest(invalidOriginReq as any, invalidOriginRes as any);

    expect(invalidOriginRes.statusCode).toBe(403);
  });

  it('closes sessions on DELETE', async () => {
    const appServer = {
      startWithTransport: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      stop: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      logStartupBegin: jest.fn(),
      logStartupSuccess: jest.fn(),
    };
    const runtime = new StreamableHttpRuntime(
      {
        host: '127.0.0.1',
        port: 3000,
        path: '/mcp',
        stateless: false,
        jsonResponse: true,
        allowedHosts: ['127.0.0.1'],
      },
      { createAppServer: async () => appServer as any },
    );

    const initReq = createRequest(
      'POST',
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'jest', version: '1.0.0' },
        },
      },
      { host: '127.0.0.1' },
    );
    await runtime.handleNodeRequest(initReq as any, new MockServerResponse() as any);

    const deleteReq = createRequest('DELETE', undefined, {
      host: '127.0.0.1',
      'mcp-session-id': 'session-1',
    });
    const deleteRes = new MockServerResponse();
    await runtime.handleNodeRequest(deleteReq as any, deleteRes as any);

    expect(deleteRes.statusCode).toBe(200);
    expect(appServer.stop).toHaveBeenCalledTimes(1);
  });

  it('preloads the app server during HTTP startup and reuses it for the first session', async () => {
    const appServer = {
      startWithTransport: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      stop: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      logStartupBegin: jest.fn(),
      logStartupSuccess: jest.fn(),
    };
    const createAppServer = jest.fn(async () => appServer as any);
    const runtime = new StreamableHttpRuntime(
      {
        host: '127.0.0.1',
        port: 0,
        path: '/mcp',
        stateless: false,
        jsonResponse: true,
        allowedHosts: ['127.0.0.1'],
      },
      { createAppServer, createHttpServer: () => new MockHttpServer() as any },
    );

    await runtime.start();

    expect(createAppServer).toHaveBeenCalledTimes(1);
    expect(appServer.logStartupBegin).toHaveBeenCalledTimes(1);
    expect(appServer.logStartupSuccess).toHaveBeenCalledTimes(1);

    const initReq = createRequest(
      'POST',
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'jest', version: '1.0.0' },
        },
      },
      { host: '127.0.0.1' },
    );
    const initRes = new MockServerResponse();
    await runtime.handleNodeRequest(initReq as any, initRes as any);

    expect(createAppServer).toHaveBeenCalledTimes(1);
    expect(appServer.startWithTransport).toHaveBeenCalledTimes(1);

    await runtime.stop();
  });

  it('reports the bound port after starting with MCP_HTTP_PORT=0', async () => {
    const appServer = {
      startWithTransport: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      stop: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      logStartupBegin: jest.fn(),
      logStartupSuccess: jest.fn(),
    };
    const runtime = new StreamableHttpRuntime(
      {
        host: '127.0.0.1',
        port: 0,
        path: '/mcp',
        stateless: false,
        jsonResponse: true,
        allowedHosts: ['127.0.0.1'],
      },
      {
        createAppServer: async () => appServer as any,
        createHttpServer: () => new MockHttpServer() as any,
      },
    );

    await runtime.start();

    expect(runtime.getAddress()).toEqual({
      host: '127.0.0.1',
      port: 43127,
      path: '/mcp',
    });

    await runtime.stop();
  });

  it('handles stateless requests without returning a session id', async () => {
    const appServer = {
      startWithTransport: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      stop: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    const runtime = new StreamableHttpRuntime(
      {
        host: '127.0.0.1',
        port: 3000,
        path: '/mcp',
        stateless: true,
        jsonResponse: true,
        allowedHosts: ['127.0.0.1'],
      },
      { createAppServer: async () => appServer as any },
    );

    const req = createRequest(
      'POST',
      { jsonrpc: '2.0', id: 6, method: 'tools/list', params: {} },
      { host: '127.0.0.1' },
    );
    const res = new MockServerResponse();
    await runtime.handleNodeRequest(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.getHeader('mcp-session-id')).toBeUndefined();
    expect(appServer.startWithTransport).toHaveBeenCalledTimes(1);
    expect(appServer.stop).toHaveBeenCalledTimes(1);
  });

  it('accepts requests when bound to ::1', async () => {
    const runtime = new StreamableHttpRuntime(
      {
        host: '::1',
        port: 3000,
        path: '/mcp',
        stateless: false,
        jsonResponse: true,
        allowedHosts: ['[::1]'],
      },
      { createAppServer: async () => ({}) as any },
    );

    const req = createRequest('GET', undefined, { host: '[::1]' });
    const res = new MockServerResponse();
    await runtime.handleNodeRequest(req as any, res as any);

    expect(res.statusCode).toBe(405);
  });

  it('returns a JSON-RPC parse error for malformed JSON bodies', async () => {
    const runtime = new StreamableHttpRuntime(
      {
        host: '127.0.0.1',
        port: 3000,
        path: '/mcp',
        stateless: true,
        jsonResponse: true,
        allowedHosts: ['127.0.0.1'],
      },
      { createAppServer: async () => ({}) as any },
    );

    const req = Readable.from(['{invalid']) as Readable & {
      method: string;
      url: string;
      headers: Record<string, string>;
    };
    req.method = 'POST';
    req.url = '/mcp';
    req.headers = { host: '127.0.0.1' };

    const res = new MockServerResponse();
    await runtime.handleNodeRequest(req as any, res as any);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe(-32700);
  });

  it('stops the app server when initialize is rejected before a session is created', async () => {
    transportHandleRequestImpl = async (_transport, _req, res) => {
      res.statusCode = 406;
      res.end(JSON.stringify({ error: 'Not Acceptable' }));
    };

    const appServer = {
      startWithTransport: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      stop: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      logStartupBegin: jest.fn(),
      logStartupSuccess: jest.fn(),
    };
    const runtime = new StreamableHttpRuntime(
      {
        host: '127.0.0.1',
        port: 3000,
        path: '/mcp',
        stateless: false,
        jsonResponse: true,
        allowedHosts: ['127.0.0.1'],
      },
      { createAppServer: async () => appServer as any },
    );

    const initReq = createRequest(
      'POST',
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'jest', version: '1.0.0' },
        },
      },
      { host: '127.0.0.1' },
    );
    const initRes = new MockServerResponse();
    await runtime.handleNodeRequest(initReq as any, initRes as any);

    expect(initRes.statusCode).toBe(406);
    expect(appServer.stop).toHaveBeenCalledTimes(1);
  });
});

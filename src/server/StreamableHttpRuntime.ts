import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { MCPServer } from './MCPServer.js';
import type { StreamableHttpConfig } from './TransportConfig.js';

class RequestBodyParseError extends Error {
  constructor(message = 'Parse error: Invalid JSON') {
    super(message);
    this.name = 'RequestBodyParseError';
  }
}

interface RuntimeDependencies {
  createAppServer: () => Promise<MCPServer>;
  createHttpServer?: (handler: (req: IncomingMessage, res: ServerResponse) => void) => HttpServer;
}

interface SessionEntry {
  appServer: MCPServer;
  transport: StreamableHTTPServerTransport;
}

export class StreamableHttpRuntime {
  private readonly sessions = new Map<string, SessionEntry>();
  private httpServer?: HttpServer;
  private isStopping = false;
  private preloadedAppServer?: MCPServer;

  constructor(
    private readonly config: StreamableHttpConfig,
    private readonly dependencies: RuntimeDependencies,
  ) {}

  async start(): Promise<void> {
    if (this.httpServer) {
      throw new Error('StreamableHttpRuntime already started');
    }

    this.preloadedAppServer = await this.dependencies.createAppServer();
    this.preloadedAppServer.logStartupBegin();

    try {
      const createHttpServer = this.dependencies.createHttpServer ?? createServer;
      this.httpServer = createHttpServer((req, res) => {
        void this.handleNodeRequest(req, res);
      });

      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          this.httpServer?.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          this.httpServer?.off('error', onError);
          resolve();
        };

        this.httpServer?.once('error', onError);
        this.httpServer?.once('listening', onListening);
        this.httpServer?.listen(this.config.port, this.config.host);
      });

      this.preloadedAppServer.logStartupSuccess();
    } catch (error) {
      const preloadedAppServer = this.preloadedAppServer;
      this.preloadedAppServer = undefined;
      if (preloadedAppServer) {
        preloadedAppServer.cleanup?.();
        await preloadedAppServer.stop().catch(() => undefined);
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.isStopping) return;
    this.isStopping = true;

    const closePromises = Array.from(this.sessions.entries()).map(async ([sessionId]) => {
      await this.closeSession(sessionId);
    });
    await Promise.all(closePromises);
    this.sessions.clear();

    const preloadedAppServer = this.preloadedAppServer;
    this.preloadedAppServer = undefined;
    if (preloadedAppServer) {
      await preloadedAppServer.stop();
    }

    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer?.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      this.httpServer = undefined;
    }
  }

  getAddress(): { host: string; port: number; path: string } {
    const boundAddress = this.httpServer?.address();
    const boundPort =
      boundAddress && typeof boundAddress !== 'string'
        ? (boundAddress as AddressInfo).port
        : this.config.port;

    return {
      host: this.config.host,
      port: boundPort,
      path: this.config.path,
    };
  }

  logInfo(message: string): void {
    this.preloadedAppServer?.getLogger().info(message);
  }

  async handleNodeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!this.isPathMatch(req.url)) {
        this.writePlainResponse(res, 404, 'Not Found');
        return;
      }

      const hostError = this.validateHostHeader(req.headers.host);
      if (hostError) {
        this.writePlainResponse(res, 403, hostError);
        return;
      }

      const originError = this.validateOriginHeader(req.headers.origin);
      if (originError) {
        this.writePlainResponse(res, 403, originError);
        return;
      }

      const parsedBody = await this.readRequestBody(req);

      if (this.config.stateless) {
        await this.handleStatelessRequest(req, res, parsedBody);
        return;
      }

      await this.handleStatefulRequest(req, res, parsedBody);
    } catch (error) {
      if (error instanceof RequestBodyParseError) {
        this.writeJsonRpcError(res, 400, -32700, error.message);
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        this.writeJsonRpcError(res, 500, -32603, message);
      } else {
        res.end();
      }
    }
  }

  private async handleStatelessRequest(
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody: unknown,
  ): Promise<void> {
    if (req.method !== 'POST') {
      this.writeMethodNotAllowed(res, 'POST');
      return;
    }

    const appServer = await this.takeAppServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: this.config.jsonResponse,
    });

    await appServer.startWithTransport(transport);

    try {
      await transport.handleRequest(req, res, parsedBody);
    } finally {
      await appServer.stop();
    }
  }

  private async handleStatefulRequest(
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody: unknown,
  ): Promise<void> {
    const sessionId = this.getSessionId(req);
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        this.writeJsonRpcError(res, 404, -32001, `Session not found: ${sessionId}`);
        return;
      }

      await session.transport.handleRequest(req, res, parsedBody);
      return;
    }

    if (req.method === 'GET') {
      this.writeMethodNotAllowed(res, 'POST');
      return;
    }

    if (req.method !== 'POST') {
      this.writeJsonRpcError(res, 400, -32000, 'Bad Request: No valid session ID provided');
      return;
    }

    if (!isInitializeRequest(parsedBody)) {
      this.writeJsonRpcError(res, 400, -32000, 'Bad Request: No valid session ID provided');
      return;
    }

    const appServer = await this.takeAppServer();
    let registeredSessionId: string | undefined;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: this.config.jsonResponse,
      onsessioninitialized: (newSessionId) => {
        registeredSessionId = newSessionId;
        this.sessions.set(newSessionId, { appServer, transport });
      },
      onsessionclosed: async (closedSessionId) => {
        await this.closeSession(closedSessionId);
      },
    });

    transport.onclose = () => {
      if (registeredSessionId) {
        void this.closeSession(registeredSessionId);
      }
    };

    try {
      await appServer.startWithTransport(transport);
      await transport.handleRequest(req, res, parsedBody);
      if (!registeredSessionId) {
        await appServer.stop();
      }
    } catch (error) {
      if (registeredSessionId) {
        this.sessions.delete(registeredSessionId);
      }
      await appServer.stop();
      throw error;
    }
  }

  private async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.sessions.delete(sessionId);
    await session.appServer.stop();
  }

  private async takeAppServer(): Promise<MCPServer> {
    const appServer = this.preloadedAppServer;
    if (appServer) {
      this.preloadedAppServer = undefined;
      return appServer;
    }

    return this.dependencies.createAppServer();
  }

  private async readRequestBody(req: IncomingMessage): Promise<unknown> {
    if (req.method !== 'POST') return undefined;

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    if (chunks.length === 0) {
      return undefined;
    }

    const body = Buffer.concat(chunks).toString('utf8').trim();
    if (!body) return undefined;

    try {
      return JSON.parse(body);
    } catch {
      throw new RequestBodyParseError();
    }
  }

  private getSessionId(req: IncomingMessage): string | undefined {
    const rawHeader = req.headers['mcp-session-id'];
    if (Array.isArray(rawHeader)) {
      return rawHeader[0];
    }
    return rawHeader;
  }

  private isPathMatch(url: string | undefined): boolean {
    if (!url) return false;

    const host =
      this.config.host.includes(':') && !this.config.host.startsWith('[')
        ? `[${this.config.host}]`
        : this.config.host;
    const parsedUrl = new globalThis.URL(url, `http://${host}`);
    return parsedUrl.pathname === this.config.path;
  }

  private validateHostHeader(hostHeader: string | undefined): string | undefined {
    if (!this.config.allowedHosts || this.config.allowedHosts.length === 0) {
      return undefined;
    }

    if (!hostHeader) {
      return 'Forbidden: Missing Host header';
    }

    const normalized = this.normalizeHostHeader(hostHeader);
    if (this.config.allowedHosts.includes(normalized)) {
      return undefined;
    }

    return `Forbidden: Host header "${normalized}" is not allowed`;
  }

  private validateOriginHeader(originHeader: string | undefined): string | undefined {
    if (!originHeader || !this.config.allowedOrigins || this.config.allowedOrigins.length === 0) {
      return undefined;
    }

    if (this.config.allowedOrigins.includes(originHeader)) {
      return undefined;
    }

    return `Forbidden: Origin "${originHeader}" is not allowed`;
  }

  private normalizeHostHeader(hostHeader: string): string {
    if (hostHeader.startsWith('[')) {
      const closingBracketIndex = hostHeader.indexOf(']');
      if (closingBracketIndex >= 0) {
        return hostHeader.slice(0, closingBracketIndex + 1);
      }
      return hostHeader;
    }

    const colonIndex = hostHeader.indexOf(':');
    return colonIndex >= 0 ? hostHeader.slice(0, colonIndex) : hostHeader;
  }

  private writeMethodNotAllowed(res: ServerResponse, allowed: string): void {
    res.statusCode = 405;
    res.setHeader('Allow', allowed);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Method Not Allowed');
  }

  private writePlainResponse(res: ServerResponse, statusCode: number, body: string): void {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(body);
  }

  private writeJsonRpcError(
    res: ServerResponse,
    statusCode: number,
    code: number,
    message: string,
  ): void {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code, message },
        id: null,
      }),
    );
  }
}

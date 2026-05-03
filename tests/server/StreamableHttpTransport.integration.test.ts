import { MCPServer } from '../../src/server/MCPServer.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

describe('Streamable HTTP transport integration', () => {
  let server: MCPServer | undefined;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }
  });

  it('supports initialize, tool calls, and session shutdown in stateful mode', async () => {
    server = new MCPServer({
      skipTransportErrorHandling: true,
      skipGracefulShutdown: true,
    });

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => 'session-1',
      enableJsonResponse: true,
    });
    await server.startWithTransport(transport);

    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'jest', version: '1.0.0' },
      },
    };

    const initResponse = await transport.handleRequest(
      new globalThis.Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(initRequest),
      }),
      { parsedBody: initRequest },
    );

    expect(initResponse.status).toBe(200);
    expect(initResponse.headers.get('mcp-session-id')).toBe('session-1');

    const initializedNotification = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    };
    await transport.handleRequest(
      new globalThis.Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-session-id': 'session-1',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(initializedNotification),
      }),
      { parsedBody: initializedNotification },
    );

    const planStepRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'plan_step',
        arguments: {
          step: 'Validate rollout health',
          nextStepNeeded: true,
          stepNumber: 1,
          totalSteps: 2,
        },
      },
    };
    const planStepResponse = await transport.handleRequest(
      new globalThis.Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-session-id': 'session-1',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(planStepRequest),
      }),
      { parsedBody: planStepRequest },
    );

    expect(planStepResponse.status).toBe(200);
    const planStepJson = (await planStepResponse.json()) as any;
    const planStepPayload = JSON.parse(planStepJson.result.content[0].text);
    expect(planStepPayload.stepNumber).toBe(1);
    expect(planStepPayload.totalSteps).toBe(2);

    const missingSessionResponse = await transport.handleRequest(
      new globalThis.Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(planStepRequest),
      }),
      { parsedBody: planStepRequest },
    );
    expect(missingSessionResponse.status).toBe(400);

    const unknownSessionResponse = await transport.handleRequest(
      new globalThis.Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-session-id': 'unknown-session',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(planStepRequest),
      }),
      { parsedBody: planStepRequest },
    );
    expect(unknownSessionResponse.status).toBe(404);

    const deleteResponse = await transport.handleRequest(
      new globalThis.Request('http://localhost/mcp', {
        method: 'DELETE',
        headers: {
          'mcp-session-id': 'session-1',
          accept: 'application/json, text/event-stream',
        },
      }),
    );
    expect(deleteResponse.status).toBeLessThan(400);
  });

  it('supports stateless single-request tool calls without a session id', async () => {
    server = new MCPServer({
      skipTransportErrorHandling: true,
      skipGracefulShutdown: true,
    });

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.startWithTransport(transport);

    const listToolsRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
      params: {},
    };
    const response = await transport.handleRequest(
      new globalThis.Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(listToolsRequest),
      }),
      { parsedBody: listToolsRequest },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('mcp-session-id')).toBeNull();

    const payload = (await response.json()) as any;
    expect(Array.isArray(payload.result.tools)).toBe(true);
    expect(payload.result.tools.some((tool: any) => tool.name === 'plan_step')).toBe(true);
  });
});

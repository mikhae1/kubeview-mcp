export type MCPTransportMode = 'stdio' | 'http';

export interface StreamableHttpConfig {
  host: string;
  port: number;
  path: string;
  stateless: boolean;
  jsonResponse: boolean;
  allowedHosts?: string[];
  allowedOrigins?: string[];
}

export interface TransportConfig {
  transport: MCPTransportMode;
  http: StreamableHttpConfig;
}

const DEFAULT_HTTP_HOST = '127.0.0.1';
const DEFAULT_HTTP_PORT = 3000;
const DEFAULT_HTTP_PATH = '/mcp';

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true') return true;
  if (normalized === '0' || normalized === 'false') return false;
  return defaultValue;
}

function parseCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function parsePort(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid MCP_HTTP_PORT value: ${value}`);
  }
  return parsed;
}

export function isLocalHostBinding(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export function getDefaultAllowedHosts(host: string): string[] | undefined {
  if (!isLocalHostBinding(host)) return undefined;
  return ['localhost', '127.0.0.1', '[::1]'];
}

export function loadTransportConfig(env: NodeJS.ProcessEnv = process.env): TransportConfig {
  const transportEnv = env.MCP_TRANSPORT?.trim().toLowerCase();
  const transport: MCPTransportMode = transportEnv === 'http' ? 'http' : 'stdio';

  const host = env.MCP_HTTP_HOST?.trim() || DEFAULT_HTTP_HOST;
  const path = normalizeHttpPath(env.MCP_HTTP_PATH?.trim() || DEFAULT_HTTP_PATH);
  const allowedHosts = parseCsv(env.MCP_ALLOWED_HOSTS) ?? getDefaultAllowedHosts(host);
  const allowedOrigins = parseCsv(env.MCP_ALLOWED_ORIGINS);

  if (
    transport === 'http' &&
    !isLocalHostBinding(host) &&
    (!allowedHosts || allowedHosts.length === 0)
  ) {
    throw new Error(
      `MCP_HTTP_HOST=${host} requires explicit MCP_ALLOWED_HOSTS to prevent DNS rebinding.`,
    );
  }

  return {
    transport,
    http: {
      host,
      port: parsePort(env.MCP_HTTP_PORT, DEFAULT_HTTP_PORT),
      path,
      stateless: parseBoolean(env.MCP_HTTP_STATELESS, false),
      jsonResponse: parseBoolean(env.MCP_HTTP_JSON_RESPONSE, false),
      allowedHosts,
      allowedOrigins,
    },
  };
}

function normalizeHttpPath(path: string): string {
  if (!path.startsWith('/')) {
    return `/${path}`;
  }
  return path;
}

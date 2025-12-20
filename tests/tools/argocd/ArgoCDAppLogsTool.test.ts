import { ArgoCDAppLogsTool } from '../../../src/tools/argocd/ArgoCDAppLogsTool';
import * as BaseTool from '../../../src/tools/argocd/BaseTool';

// Mock dependencies
jest.mock('../../../src/tools/argocd/BaseTool', () => ({
  ...jest.requireActual('../../../src/tools/argocd/BaseTool'),
  executeArgoCDCommand: jest.fn(),
  ArgoCDCommonSchemas: jest.requireActual('../../../src/tools/argocd/BaseTool').ArgoCDCommonSchemas,
}));

// Mock global fetch
global.fetch = jest.fn();

describe('ArgoCDAppLogsTool', () => {
  let tool: ArgoCDAppLogsTool;
  const executeArgoCDCommandMock = BaseTool.executeArgoCDCommand as jest.Mock;
  const fetchMock = global.fetch as jest.Mock;

  beforeEach(() => {
    tool = new ArgoCDAppLogsTool();
    jest.clearAllMocks();
    process.env.ARGOCD_AUTH_TOKEN = 'test-token';
    process.env.ARGOCD_SERVER = 'argocd.example.com';
  });

  afterEach(() => {
    delete process.env.ARGOCD_AUTH_TOKEN;
    delete process.env.ARGOCD_SERVER;
  });

  it('should fall back to CLI and unwrap output when API fails', async () => {
    // Setup API failure
    fetchMock.mockRejectedValue(new Error('API Error'));

    // Setup CLI success with wrapped output (simulating current CliUtils behavior)
    executeArgoCDCommandMock.mockResolvedValue({ output: 'log line 1\nlog line 2' });

    const result = await tool.execute({ appName: 'test-app' });

    // Should have tried API first (resource tree)
    expect(fetchMock).toHaveBeenCalled();

    // Should have called CLI
    expect(executeArgoCDCommandMock).toHaveBeenCalledWith(
      expect.arrayContaining(['app', 'logs', 'test-app']),
    );

    expect(result).toMatchObject({
      appName: 'test-app',
      lineCount: 2,
      logs: ['log line 1', 'log line 2'],
      transport: 'cli',
    });
  });

  it('should return raw text from direct API call when successful', async () => {
    // Setup Resource Tree response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        nodes: [{ kind: 'Pod', name: 'pod-1', health: { status: 'Healthy' } }],
      }),
    });

    // Setup Logs response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => 'api log line 1',
    });

    const result = await tool.execute({ appName: 'test-app' });

    expect(result).toMatchObject({
      appName: 'test-app',
      lineCount: 1,
      logs: ['api log line 1'],
      transport: 'api',
    });
    expect(executeArgoCDCommandMock).not.toHaveBeenCalled();
  });
});

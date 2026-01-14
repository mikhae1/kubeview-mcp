import { ArgoCDAppTool } from '../../../src/tools/argocd/ArgoCDAppTool';
import * as BaseTool from '../../../src/tools/argocd/BaseTool';
import { ArgoCDToolsPlugin } from '../../../src/plugins/ArgoCDToolsPlugin';

// Mock dependencies
jest.mock('../../../src/tools/argocd/BaseTool', () => ({
  ...jest.requireActual('../../../src/tools/argocd/BaseTool'),
  executeArgoCDCommand: jest.fn(),
  ArgoCDCommonSchemas: jest.requireActual('../../../src/tools/argocd/BaseTool').ArgoCDCommonSchemas,
}));

// Mock global fetch
global.fetch = jest.fn();

function parseMcpJson(result: any): any {
  const text = result?.content?.[0]?.text;
  return text ? JSON.parse(String(text)) : undefined;
}

jest.mock('../../../src/plugins/KubernetesToolsPlugin.js', () => {
  const createOrReuseClientMock = jest.fn();
  return {
    KubernetesToolsPlugin: jest.fn().mockImplementation(() => ({
      createOrReuseClient: createOrReuseClientMock,
    })),
    __k8sPluginMocks: { createOrReuseClientMock },
  };
});

describe('ArgoCDAppTool - logs operation', () => {
  let tool: ArgoCDAppTool;
  let consoleErrorSpy: jest.SpyInstance;
  const executeArgoCDCommandMock = BaseTool.executeArgoCDCommand as jest.Mock;
  const fetchMock = global.fetch as jest.Mock;

  beforeEach(() => {
    tool = new ArgoCDAppTool();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.clearAllMocks();
    process.env.ARGOCD_AUTH_TOKEN = 'test-token';
    process.env.ARGOCD_SERVER = 'argocd.example.com';
  });

  describe('ArgoCDToolsPlugin.executeCommand', () => {
    it('should try to create Kubernetes client and use Kubernetes API for list operation when available', async () => {
      const mockListNamespacedCustomObject = jest.fn();
      const mockRefreshCurrentContext = jest.fn();

      const mockClient = {
        refreshCurrentContext: mockRefreshCurrentContext,
        customObjects: {
          listNamespacedCustomObject: mockListNamespacedCustomObject,
        },
      } as any;

      const { __k8sPluginMocks } = jest.requireMock(
        '../../../src/plugins/KubernetesToolsPlugin.js',
      );
      (__k8sPluginMocks.createOrReuseClientMock as jest.Mock).mockResolvedValue(mockClient);

      const expected = { items: [{ metadata: { name: 'app-1' } }] };
      mockListNamespacedCustomObject.mockResolvedValue({ body: expected });

      const result = await ArgoCDToolsPlugin.executeCommand('argocd_app', {
        operation: 'list',
        outputFormat: 'json',
      });

      expect(__k8sPluginMocks.createOrReuseClientMock).toHaveBeenCalled();
      expect(mockRefreshCurrentContext).toHaveBeenCalled();
      expect(mockListNamespacedCustomObject).toHaveBeenCalledWith(
        expect.objectContaining({
          group: 'argoproj.io',
          version: 'v1alpha1',
          namespace: 'argocd',
          plural: 'applications',
        }),
      );
      expect(parseMcpJson(result)).toEqual(expected);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    delete process.env.ARGOCD_AUTH_TOKEN;
    delete process.env.ARGOCD_SERVER;
  });

  it('should fall back to CLI and unwrap output when API fails', async () => {
    // Setup API failure
    fetchMock.mockRejectedValue(new Error('API Error'));

    // Setup CLI success with wrapped output (simulating current CliUtils behavior)
    executeArgoCDCommandMock.mockResolvedValue({ output: 'log line 1\nlog line 2' });

    const result = await tool.execute({ operation: 'logs', appName: 'test-app' });

    // Should have tried API first (resource tree)
    expect(fetchMock).toHaveBeenCalled();

    // Should have called CLI
    expect(executeArgoCDCommandMock).toHaveBeenCalledWith(
      expect.arrayContaining(['app', 'logs', 'test-app']),
    );

    expect(parseMcpJson(result)).toMatchObject({
      appName: 'test-app',
      lineCount: 2,
      logs: ['log line 1', 'log line 2'],
      transport: 'cli',
    });
  });

  it('should log k8s errors before CLI fallback', async () => {
    fetchMock.mockRejectedValue(new Error('API Error'));
    executeArgoCDCommandMock.mockResolvedValue({ output: 'log line 1' });

    await tool.execute({ operation: 'logs', appName: 'test-app' });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'ArgoCD API log fetch failed, falling back to CLI: ',
      expect.stringContaining('listPodForAllNamespaces'),
    );
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

    const result = await tool.execute({ operation: 'logs', appName: 'test-app' });

    expect(parseMcpJson(result)).toMatchObject({
      appName: 'test-app',
      lineCount: 1,
      logs: ['api log line 1'],
      transport: 'api',
    });
    expect(executeArgoCDCommandMock).not.toHaveBeenCalled();
  });
});

import { HelmGetTool } from '../../src/tools/helm/HelmGetTool';
import { KubernetesClient } from '../../src/kubernetes/KubernetesClient';
import * as HelmBaseToolModule from '../../src/tools/helm/BaseTool';
import { HelmReleaseOperations } from '../../src/kubernetes/resources/HelmReleaseOperations';

jest.mock('../../src/kubernetes/resources/HelmReleaseOperations', () => ({
  __esModule: true,
  HelmReleaseOperations: jest.fn().mockImplementation(() => ({
    getReleaseValues: jest.fn(),
    getReleaseManifest: jest.fn(),
    getRelease: jest.fn(),
  })),
}));

jest.mock('../../src/tools/helm/BaseTool', () => ({
  __esModule: true,
  HelmCommonSchemas: {
    releaseName: { type: 'string' },
    namespace: { type: 'string', optional: true },
    revision: { type: 'number', optional: true },
    outputFormat: { type: 'string', optional: true },
  },
  executeHelmCommand: jest.fn(),
  validateHelmCLI: jest.fn(),
}));

describe('HelmGetTool API-first behavior', () => {
  let tool: HelmGetTool;
  let client: KubernetesClient;
  let releaseValuesMock: jest.Mock;
  let releaseManifestMock: jest.Mock;
  let getReleaseMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    releaseValuesMock = jest.fn();
    releaseManifestMock = jest.fn();
    getReleaseMock = jest.fn();
    (HelmReleaseOperations as unknown as jest.Mock).mockImplementation(() => ({
      getReleaseValues: releaseValuesMock,
      getReleaseManifest: releaseManifestMock,
      getRelease: getReleaseMock,
    }));
    tool = new HelmGetTool();
    client = {
      refreshCurrentContext: jest.fn().mockResolvedValue(undefined),
      getCurrentNamespace: jest.fn().mockReturnValue('default'),
      apps: {
        readNamespacedDeployment: jest.fn(),
      },
      core: {
        listNamespacedPod: jest.fn().mockResolvedValue({ items: [] }),
      },
    } as any;
  });

  function executeHelmCommandMock(): jest.Mock {
    return HelmBaseToolModule.executeHelmCommand as unknown as jest.Mock;
  }

  function validateHelmCLIMock(): jest.Mock {
    return HelmBaseToolModule.validateHelmCLI as unknown as jest.Mock;
  }

  it('uses Kubernetes API first and does not invoke CLI fallback when API succeeds', async () => {
    releaseValuesMock.mockResolvedValue({ image: { tag: '1.0.0' } });

    const result = await tool.execute(
      {
        what: 'values',
        releaseName: 'demo',
      },
      client,
    );

    expect(result).toEqual({ image: { tag: '1.0.0' } });
    expect(client.refreshCurrentContext).toHaveBeenCalled();
    expect(releaseValuesMock).toHaveBeenCalledWith(
      { releaseName: 'demo', namespace: 'default', revision: undefined },
      false,
    );
    expect(validateHelmCLIMock()).not.toHaveBeenCalled();
    expect(executeHelmCommandMock()).not.toHaveBeenCalled();
  });

  it('falls back to CLI when API path fails', async () => {
    releaseValuesMock.mockRejectedValue(new Error('API unavailable'));
    executeHelmCommandMock().mockResolvedValue({ output: '{"foo":"bar"}' });

    const result = await tool.execute(
      {
        what: 'values',
        releaseName: 'demo',
        namespace: 'apps',
        outputFormat: 'json',
      },
      client,
    );

    expect(result).toEqual({ output: '{"foo":"bar"}' });
    expect(releaseValuesMock).toHaveBeenCalled();
    expect(validateHelmCLIMock()).toHaveBeenCalledTimes(1);
    expect(executeHelmCommandMock()).toHaveBeenCalledWith([
      'get',
      'values',
      'demo',
      '--namespace',
      'apps',
      '--output',
      'json',
    ]);
  });

  it('keeps what=resources as stored manifest refs unless live is requested', async () => {
    releaseManifestMock.mockResolvedValue(`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
`);

    const result = await tool.execute(
      {
        what: 'resources',
        releaseName: 'demo',
      },
      client,
    );

    expect(result).toEqual([
      expect.objectContaining({
        kind: 'Deployment',
      }),
    ]);
    expect((client as any).apps.readNamespacedDeployment).not.toHaveBeenCalled();
  });

  it('returns live resource state for what=resources live=true', async () => {
    releaseManifestMock.mockResolvedValue(`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
`);
    (client as any).apps.readNamespacedDeployment.mockResolvedValue({
      metadata: { name: 'demo', namespace: 'default' },
      spec: { replicas: 1, selector: { matchLabels: { app: 'demo' } } },
      status: { replicas: 1, readyReplicas: 1 },
    });

    const result = await tool.execute(
      {
        what: 'resources',
        releaseName: 'demo',
        live: true,
      },
      client,
    );

    expect(result[0]).toEqual(
      expect.objectContaining({
        state: 'ready',
        ref: expect.objectContaining({ kind: 'Deployment', name: 'demo' }),
      }),
    );
    expect((client as any).apps.readNamespacedDeployment).toHaveBeenCalledWith({
      name: 'demo',
      namespace: 'default',
    });
    expect(validateHelmCLIMock()).not.toHaveBeenCalled();
  });

  it('uses live resources for what=status showResources=true on API path', async () => {
    getReleaseMock.mockResolvedValue({
      summary: {
        name: 'demo',
        namespace: 'default',
        revision: 3,
        status: 'deployed',
        chart: 'demo-1.0.0',
        app_version: '1.0.0',
      },
      release: {
        info: { description: 'ok', notes: 'notes' },
        manifest: `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
`,
      },
    });
    (client as any).apps.readNamespacedDeployment.mockResolvedValue({
      metadata: { name: 'demo', namespace: 'default' },
      spec: { replicas: 1, selector: { matchLabels: { app: 'demo' } } },
      status: { replicas: 1, readyReplicas: 1 },
    });

    const result = await tool.execute(
      {
        what: 'status',
        releaseName: 'demo',
        showResources: true,
      },
      client,
    );

    expect(result.resources[0]).toEqual(expect.objectContaining({ state: 'ready' }));
    expect((client as any).apps.readNamespacedDeployment).toHaveBeenCalled();
    expect(validateHelmCLIMock()).not.toHaveBeenCalled();
  });
});

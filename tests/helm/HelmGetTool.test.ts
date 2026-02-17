import { HelmGetTool } from '../../src/tools/helm/HelmGetTool';
import { KubernetesClient } from '../../src/kubernetes/KubernetesClient';
import * as HelmBaseToolModule from '../../src/tools/helm/BaseTool';
import { HelmReleaseOperations } from '../../src/kubernetes/resources/HelmReleaseOperations';

jest.mock('../../src/kubernetes/resources/HelmReleaseOperations', () => ({
  __esModule: true,
  HelmReleaseOperations: jest.fn().mockImplementation(() => ({
    getReleaseValues: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks();
    releaseValuesMock = jest.fn();
    (HelmReleaseOperations as unknown as jest.Mock).mockImplementation(() => ({
      getReleaseValues: releaseValuesMock,
    }));
    tool = new HelmGetTool();
    client = {
      refreshCurrentContext: jest.fn().mockResolvedValue(undefined),
      getCurrentNamespace: jest.fn().mockReturnValue('default'),
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
});

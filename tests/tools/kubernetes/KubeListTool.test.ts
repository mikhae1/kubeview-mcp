import { KubeListTool } from '../../../src/tools/kubernetes/KubeListTool';
import { KubernetesClient } from '../../../src/kubernetes/KubernetesClient';

const listFormattedMock = jest.fn();

jest.mock('../../../src/kubernetes/resources/PodOperations', () => ({
  PodOperations: jest.fn().mockImplementation(() => ({
    listFormatted: listFormattedMock,
  })),
}));

describe('KubeListTool', () => {
  let tool: KubeListTool;
  let client: KubernetesClient;

  beforeEach(() => {
    jest.clearAllMocks();
    listFormattedMock.mockReset();
    tool = new KubeListTool();
    client = {} as KubernetesClient;
  });

  it('defaults to pod listings when namespace is provided without resourceType', async () => {
    const podsResult = { items: [] };
    listFormattedMock.mockResolvedValue(podsResult);

    const result = await tool.execute({ namespace: 'does-not-exist' }, client);

    expect(result).toBe(podsResult);
    expect(listFormattedMock).toHaveBeenCalledWith({
      namespace: 'does-not-exist',
      labelSelector: undefined,
      fieldSelector: undefined,
    });
  });

  it('infers pod listings when only selectors are provided', async () => {
    listFormattedMock.mockResolvedValue({ items: [] });

    await tool.execute(
      { labelSelector: 'app=test', fieldSelector: 'status.phase=Running' },
      client,
    );

    expect(listFormattedMock).toHaveBeenCalledWith({
      namespace: undefined,
      labelSelector: 'app=test',
      fieldSelector: 'status.phase=Running',
    });
  });

  it('returns diagnostics when no resourceType or filters are provided', async () => {
    const diagnostics = { summary: { status: 'ok' } };
    const diagSpy = jest.spyOn(tool as any, 'getClusterDiagnostics').mockResolvedValue(diagnostics);

    const result = await tool.execute({}, client);

    expect(result).toBe(diagnostics);
    expect(diagSpy).toHaveBeenCalledWith(client);
  });
});

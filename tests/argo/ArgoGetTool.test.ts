import { ArgoGetTool } from '../../src/tools/argo/ArgoGetTool.js';
import { executeArgoCommand } from '../../src/tools/argo/BaseTool.js';

// Mock only the executeArgoCommand function while preserving other exports
jest.mock('../../src/tools/argo/BaseTool.js', () => ({
  ...jest.requireActual('../../src/tools/argo/BaseTool.js'),
  executeArgoCommand: jest.fn(),
}));

const mockExecuteArgoCommand = executeArgoCommand as jest.MockedFunction<typeof executeArgoCommand>;

describe('ArgoGetTool', () => {
  let argoGetTool: ArgoGetTool;

  beforeEach(() => {
    argoGetTool = new ArgoGetTool();
    jest.clearAllMocks();
  });

  describe('tool definition', () => {
    it('should have correct tool name and description', () => {
      expect(argoGetTool.tool.name).toBe('argo_get');
      expect(argoGetTool.tool.description).toBe(
        'Get details of an Argo workflow (similar to `argo get <workflow-name>`)',
      );
    });

    it('should require workflowName parameter', () => {
      expect(argoGetTool.tool.inputSchema.required).toContain('workflowName');
    });

    it('should have optional parameters', () => {
      const properties = argoGetTool.tool.inputSchema.properties as any;
      expect(properties.namespace.optional).toBe(true);
      expect(properties.outputFormat.optional).toBe(true);
      expect(properties.showParameters.optional).toBe(true);
      expect(properties.showArtifacts.optional).toBe(true);
      expect(properties.showEvents.optional).toBe(true);
      expect(properties.nodeFieldSelector.optional).toBe(true);
    });
  });

  describe('execute', () => {
    it('should execute basic argo get command', async () => {
      const params = {
        workflowName: 'test-workflow',
      };

      const expectedResult = {
        metadata: { name: 'test-workflow' },
        status: { phase: 'Succeeded' },
      };

      mockExecuteArgoCommand.mockResolvedValue(expectedResult);

      const result = await argoGetTool.execute(params);

      expect(mockExecuteArgoCommand).toHaveBeenCalledWith(['get', 'test-workflow', '-o', 'json']);
      expect(result).toEqual(expectedResult);
    });

    it('should include namespace when provided', async () => {
      const params = {
        workflowName: 'test-workflow',
        namespace: 'test-namespace',
      };

      const expectedResult = { metadata: { name: 'test-workflow' } };
      mockExecuteArgoCommand.mockResolvedValue(expectedResult);

      await argoGetTool.execute(params);

      expect(mockExecuteArgoCommand).toHaveBeenCalledWith([
        'get',
        'test-workflow',
        '-n',
        'test-namespace',
        '-o',
        'json',
      ]);
    });

    it('should include output format when provided', async () => {
      const params = {
        workflowName: 'test-workflow',
        outputFormat: 'yaml',
      };

      const expectedResult = 'yaml output';
      mockExecuteArgoCommand.mockResolvedValue(expectedResult);

      await argoGetTool.execute(params);

      expect(mockExecuteArgoCommand).toHaveBeenCalledWith(['get', 'test-workflow', '-o', 'yaml']);
    });

    it('should include optional flags when provided', async () => {
      const params = {
        workflowName: 'test-workflow',
        showParameters: true,
        showArtifacts: true,
        showEvents: true,
        nodeFieldSelector: 'status.phase=Running',
      };

      const expectedResult = { metadata: { name: 'test-workflow' } };
      mockExecuteArgoCommand.mockResolvedValue(expectedResult);

      await argoGetTool.execute(params);

      expect(mockExecuteArgoCommand).toHaveBeenCalledWith([
        'get',
        'test-workflow',
        '-o',
        'json',
        '--show-parameters',
        '--show-artifacts',
        '--show-events',
        '--node-field-selector',
        'status.phase=Running',
      ]);
    });

    it('should handle all parameters together', async () => {
      const params = {
        workflowName: 'test-workflow',
        namespace: 'test-namespace',
        outputFormat: 'wide',
        showParameters: true,
        showArtifacts: true,
        showEvents: true,
        nodeFieldSelector: 'status.phase=Running',
      };

      const expectedResult = { metadata: { name: 'test-workflow' } };
      mockExecuteArgoCommand.mockResolvedValue(expectedResult);

      await argoGetTool.execute(params);

      expect(mockExecuteArgoCommand).toHaveBeenCalledWith([
        'get',
        'test-workflow',
        '-n',
        'test-namespace',
        '-o',
        'wide',
        '--show-parameters',
        '--show-artifacts',
        '--show-events',
        '--node-field-selector',
        'status.phase=Running',
      ]);
    });

    it('should handle command execution failure', async () => {
      const params = {
        workflowName: 'non-existent-workflow',
      };

      const error = new Error('workflow not found');
      mockExecuteArgoCommand.mockRejectedValue(error);

      await expect(argoGetTool.execute(params)).rejects.toThrow(
        'Failed to get Argo workflow non-existent-workflow: workflow not found',
      );
    });

    it('should handle non-Error objects in catch block', async () => {
      const params = {
        workflowName: 'test-workflow',
      };

      mockExecuteArgoCommand.mockRejectedValue('string error');

      await expect(argoGetTool.execute(params)).rejects.toThrow(
        'Failed to get Argo workflow test-workflow: string error',
      );
    });
  });
});

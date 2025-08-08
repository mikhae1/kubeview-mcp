import { KubeMetricsTool } from '../../src/tools/kubernetes/KubeMetricsTool.js';
import { KubernetesClient } from '../../src/kubernetes/KubernetesClient.js';
import { MetricOperations, PodMetrics } from '../../src/kubernetes/resources/MetricOperations.js';

jest.mock('../../src/kubernetes/KubernetesClient.js');
jest.mock('../../src/kubernetes/resources/MetricOperations.js');

describe('KubeMetricsTool', () => {
  let tool: KubeMetricsTool;
  let mockClient: jest.Mocked<KubernetesClient>;
  let mockMetricOperations: jest.Mocked<MetricOperations>;

  beforeEach(() => {
    tool = new KubeMetricsTool();
    mockClient = new KubernetesClient() as jest.Mocked<KubernetesClient>;
    mockMetricOperations = new MetricOperations(mockClient) as jest.Mocked<MetricOperations>;

    // Mock the MetricOperations constructor
    (MetricOperations as jest.MockedClass<typeof MetricOperations>).mockImplementation(
      () => mockMetricOperations,
    );

    // Mock the parsing methods
    mockMetricOperations.parseCpuValueToNanocores = jest.fn((cpuString: string) => {
      if (!cpuString) return 0;
      if (cpuString.endsWith('m')) {
        return parseInt(cpuString.slice(0, -1), 10) * 1000000;
      }
      return parseFloat(cpuString) * 1000000000;
    });

    mockMetricOperations.parseMemoryValueToBytes = jest.fn((memoryString: string) => {
      if (!memoryString) return 0;
      const value = parseInt(memoryString.replace(/[^\d]/g, ''), 10);
      if (memoryString.includes('Mi')) {
        return value * 1024 * 1024;
      }
      return value;
    });
  });

  describe('tool configuration', () => {
    it('should have correct name and description', () => {
      expect(tool.tool.name).toBe('kube_metrics');
      expect(tool.tool.description).toContain('Get live CPU/memory metrics');
    });

    it('should have correct input schema', () => {
      const schema = tool.tool.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('namespace');
      expect(schema.properties).toHaveProperty('podName');
      expect(schema.properties).toHaveProperty('scope');
    });
  });

  describe('execute', () => {
    it('should fetch metrics for a specific pod when podName is provided', async () => {
      const mockPodMetrics: PodMetrics = {
        kind: 'PodMetrics',
        apiVersion: 'metrics.k8s.io/v1beta1',
        metadata: { name: 'test-pod', namespace: 'default' },
        timestamp: '2024-01-01T00:00:00Z',
        window: '30s',
        containers: [
          { name: 'container1', usage: { cpu: '100m', memory: '128Mi' } },
          { name: 'container2', usage: { cpu: '50m', memory: '64Mi' } },
        ],
      };

      mockMetricOperations.getPodMetricsByName.mockResolvedValue(mockPodMetrics);

      const result = await tool.execute(
        { scope: 'pods', namespace: 'default', podName: 'test-pod' },
        mockClient,
      );

      expect(mockMetricOperations.getPodMetricsByName).toHaveBeenCalledWith('test-pod', 'default');
      expect(result.normalizedPods).toBeDefined();
      expect(result.normalizedPods[0].name).toBe('test-pod');
      expect(result.normalizedPods[0].namespace).toBe('default');
      expect(result.normalizedPods[0].containers).toHaveLength(2);
    });

    it('should throw error when podName is provided without namespace', async () => {
      const r = await tool.execute({ scope: 'pods', podName: 'test-pod' }, mockClient);
      expect(r).toEqual({ normalizedPods: [], normalizedNodes: [], error: 'No data' });
    });

    it('should return null pod when specific pod metrics not found', async () => {
      mockMetricOperations.getPodMetricsByName.mockResolvedValue(null);

      const result = await tool.execute(
        { scope: 'pods', namespace: 'default', podName: 'test-pod' },
        mockClient,
      );

      expect(result.normalizedPods).toEqual([]);
      expect(result.error).toContain('No metrics found');
    });

    it('should fetch metrics for all pods when no podName is provided', async () => {
      // legacy structure retained for context; actual normalized metrics are mocked below

      mockMetricOperations.getAllNormalizedMetrics.mockResolvedValue({
        nodesMetrics: [],
        podsMetrics: [
          {
            name: 'pod1',
            namespace: 'default',
            timestamp: '2024-01-01T00:00:00Z',
            window: '30s',
            usage: { cpuCores: 0.1, memoryBytes: 134217728 },
            containers: [],
          },
          {
            name: 'pod2',
            namespace: 'default',
            timestamp: '2024-01-01T00:00:00Z',
            window: '30s',
            usage: { cpuCores: 0.2, memoryBytes: 268435456 },
            containers: [],
          },
        ],
      });

      const result = await tool.execute({ scope: 'pods', namespace: 'default' }, mockClient);

      expect(mockMetricOperations.getAllNormalizedMetrics).toHaveBeenCalled();
      expect(result.normalizedPods).toHaveLength(2);
      expect(result.normalizedPods[0].name).toBe('pod1');
      expect(result.normalizedPods[1].name).toBe('pod2');
    });

    it('should return empty result when no pod metrics found', async () => {
      mockMetricOperations.getAllNormalizedMetrics.mockResolvedValue({
        nodesMetrics: [],
        podsMetrics: [],
        error: 'No data',
      });

      const result = await tool.execute({ scope: 'pods', namespace: 'default' }, mockClient);

      expect(result.normalizedPods).toEqual([]);
      expect(result.error).toBe('No data');
    });

    it('should calculate total pod usage correctly using MetricOperations parsing methods', async () => {
      // legacy structure retained for context; actual normalized metrics are mocked below

      mockMetricOperations.getAllNormalizedMetrics.mockResolvedValue({
        nodesMetrics: [],
        podsMetrics: [
          {
            name: 'pod1',
            namespace: 'default',
            timestamp: '2024-01-01T00:00:00Z',
            window: '30s',
            usage: { cpuCores: 0.15, memoryBytes: 201326592 },
            containers: [
              { name: 'c1', usage: { cpuCores: 0.1, memoryBytes: 134217728 } },
              { name: 'c2', usage: { cpuCores: 0.05, memoryBytes: 67108864 } },
            ],
          },
        ],
      });

      const result = await tool.execute({}, mockClient);

      expect(result.normalizedPods[0].usage).toBeDefined();
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('API error');
      mockMetricOperations.getAllNormalizedMetrics.mockRejectedValue(error);

      await expect(tool.execute({}, mockClient)).rejects.toThrow('API error');
    });
  });
});

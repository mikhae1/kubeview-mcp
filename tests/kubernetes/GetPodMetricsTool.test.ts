import { GetPodMetricsTool } from '../../src/tools/kubernetes/GetPodMetricsTool.js';
import { KubernetesClient } from '../../src/kubernetes/KubernetesClient.js';
import {
  MetricOperations,
  PodMetrics,
  PodMetricsList,
} from '../../src/kubernetes/resources/MetricOperations.js';

jest.mock('../../src/kubernetes/KubernetesClient.js');
jest.mock('../../src/kubernetes/resources/MetricOperations.js');

describe('GetPodMetricsTool', () => {
  let tool: GetPodMetricsTool;
  let mockClient: jest.Mocked<KubernetesClient>;
  let mockMetricOperations: jest.Mocked<MetricOperations>;

  beforeEach(() => {
    tool = new GetPodMetricsTool();
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
      expect(tool.tool.name).toBe('get_pod_metrics');
      expect(tool.tool.description).toContain('Fetch CPU and memory metrics for pods');
    });

    it('should have correct input schema', () => {
      const schema = tool.tool.inputSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('namespace');
      expect(schema.properties).toHaveProperty('podName');
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

      const result = await tool.execute({ namespace: 'default', podName: 'test-pod' }, mockClient);

      expect(mockMetricOperations.getPodMetricsByName).toHaveBeenCalledWith('test-pod', 'default');
      expect(result.pod).toBeDefined();
      expect(result.pod.name).toBe('test-pod');
      expect(result.pod.namespace).toBe('default');
      expect(result.pod.containers).toHaveLength(2);
    });

    it('should throw error when podName is provided without namespace', async () => {
      await expect(tool.execute({ podName: 'test-pod' }, mockClient)).rejects.toThrow(
        'Namespace is required when fetching metrics for a specific pod',
      );
    });

    it('should return null pod when specific pod metrics not found', async () => {
      mockMetricOperations.getPodMetricsByName.mockResolvedValue(null);

      const result = await tool.execute({ namespace: 'default', podName: 'test-pod' }, mockClient);

      expect(result.pod).toBeNull();
      expect(result.message).toContain('No metrics found for pod');
    });

    it('should fetch metrics for all pods when no podName is provided', async () => {
      const mockPodMetricsList: PodMetricsList = {
        kind: 'PodMetricsList',
        apiVersion: 'metrics.k8s.io/v1beta1',
        metadata: {},
        items: [
          {
            kind: 'PodMetrics',
            apiVersion: 'metrics.k8s.io/v1beta1',
            metadata: { name: 'pod1', namespace: 'default' },
            timestamp: '2024-01-01T00:00:00Z',
            window: '30s',
            containers: [{ name: 'container1', usage: { cpu: '100m', memory: '128Mi' } }],
          },
          {
            kind: 'PodMetrics',
            apiVersion: 'metrics.k8s.io/v1beta1',
            metadata: { name: 'pod2', namespace: 'default' },
            timestamp: '2024-01-01T00:00:00Z',
            window: '30s',
            containers: [{ name: 'container1', usage: { cpu: '200m', memory: '256Mi' } }],
          },
        ],
      };

      mockMetricOperations.getPodMetrics.mockResolvedValue(mockPodMetricsList);

      const result = await tool.execute({ namespace: 'default' }, mockClient);

      expect(mockMetricOperations.getPodMetrics).toHaveBeenCalledWith('default');
      expect(result.total).toBe(2);
      expect(result.pods).toHaveLength(2);
      expect(result.pods[0].name).toBe('pod1');
      expect(result.pods[1].name).toBe('pod2');
    });

    it('should return empty result when no pod metrics found', async () => {
      mockMetricOperations.getPodMetrics.mockResolvedValue(null);

      const result = await tool.execute({ namespace: 'default' }, mockClient);

      expect(result.total).toBe(0);
      expect(result.pods).toEqual([]);
      expect(result.message).toBe('No pod metrics found');
    });

    it('should calculate total pod usage correctly using MetricOperations parsing methods', async () => {
      const mockPodMetricsList: PodMetricsList = {
        kind: 'PodMetricsList',
        apiVersion: 'metrics.k8s.io/v1beta1',
        metadata: {},
        items: [
          {
            kind: 'PodMetrics',
            apiVersion: 'metrics.k8s.io/v1beta1',
            metadata: { name: 'pod1', namespace: 'default' },
            timestamp: '2024-01-01T00:00:00Z',
            window: '30s',
            containers: [
              { name: 'container1', usage: { cpu: '100m', memory: '128Mi' } },
              { name: 'container2', usage: { cpu: '50m', memory: '64Mi' } },
            ],
          },
        ],
      };

      mockMetricOperations.getPodMetrics.mockResolvedValue(mockPodMetricsList);

      const result = await tool.execute({}, mockClient);

      expect(result.pods[0].totalUsage).toBeDefined();
      expect(mockMetricOperations.parseCpuValueToNanocores).toHaveBeenCalledWith('100m');
      expect(mockMetricOperations.parseCpuValueToNanocores).toHaveBeenCalledWith('50m');
      expect(mockMetricOperations.parseMemoryValueToBytes).toHaveBeenCalledWith('128Mi');
      expect(mockMetricOperations.parseMemoryValueToBytes).toHaveBeenCalledWith('64Mi');
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('API error');
      mockMetricOperations.getPodMetrics.mockRejectedValue(error);

      await expect(tool.execute({}, mockClient)).rejects.toThrow(
        'Failed to get pod metrics: API error',
      );
    });
  });
});

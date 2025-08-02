import { MetricOperations } from '../../src/kubernetes/resources/MetricOperations.js';
import { KubernetesClient } from '../../src/kubernetes/KubernetesClient.js';

jest.mock('../../src/kubernetes/KubernetesClient.js');

describe('MetricOperations - Parsing Methods', () => {
  let metricOperations: MetricOperations;
  let mockClient: jest.Mocked<KubernetesClient>;

  beforeEach(() => {
    mockClient = new KubernetesClient() as jest.Mocked<KubernetesClient>;
    metricOperations = new MetricOperations(mockClient);
  });

  describe('parseCpuValueToNanocores', () => {
    it('should parse CPU values correctly', () => {
      expect(metricOperations.parseCpuValueToNanocores('100m')).toBe(100000000); // 100 millicores
      expect(metricOperations.parseCpuValueToNanocores('1')).toBe(1000000000); // 1 core
      expect(metricOperations.parseCpuValueToNanocores('500n')).toBe(500); // 500 nanocores
      expect(metricOperations.parseCpuValueToNanocores('250u')).toBe(250000); // 250 microcores
      expect(metricOperations.parseCpuValueToNanocores('')).toBe(0);
      expect(metricOperations.parseCpuValueToNanocores('0.5')).toBe(500000000); // 0.5 cores
    });

    it('should handle edge cases', () => {
      expect(metricOperations.parseCpuValueToNanocores('0')).toBe(0);
      expect(metricOperations.parseCpuValueToNanocores('0m')).toBe(0);
      expect(metricOperations.parseCpuValueToNanocores('0n')).toBe(0);
      expect(metricOperations.parseCpuValueToNanocores('0u')).toBe(0);
    });
  });

  describe('parseMemoryValueToBytes', () => {
    it('should parse memory values correctly', () => {
      expect(metricOperations.parseMemoryValueToBytes('128Mi')).toBe(134217728); // 128 * 1024 * 1024
      expect(metricOperations.parseMemoryValueToBytes('1Gi')).toBe(1073741824); // 1 * 1024^3
      expect(metricOperations.parseMemoryValueToBytes('512Ki')).toBe(524288); // 512 * 1024
      expect(metricOperations.parseMemoryValueToBytes('1Ti')).toBe(1099511627776); // 1 * 1024^4
      expect(metricOperations.parseMemoryValueToBytes('1000')).toBe(1000); // 1000 bytes
      expect(metricOperations.parseMemoryValueToBytes('')).toBe(0);
    });

    it('should handle edge cases', () => {
      expect(metricOperations.parseMemoryValueToBytes('0')).toBe(0);
      expect(metricOperations.parseMemoryValueToBytes('0Ki')).toBe(0);
      expect(metricOperations.parseMemoryValueToBytes('0Mi')).toBe(0);
      expect(metricOperations.parseMemoryValueToBytes('0Gi')).toBe(0);
    });

    it('should handle complex memory strings', () => {
      // Test strings with numbers embedded in them
      expect(metricOperations.parseMemoryValueToBytes('64Mi')).toBe(67108864); // 64 * 1024 * 1024
      expect(metricOperations.parseMemoryValueToBytes('256Ki')).toBe(262144); // 256 * 1024
    });
  });
});

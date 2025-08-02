import { ConfigMapOperations } from '../../src/kubernetes/resources/ConfigMapOperations';
import { KubernetesClient } from '../../src/kubernetes/KubernetesClient';
import * as k8s from '@kubernetes/client-node';
import { WatchEventType } from '../../src/kubernetes/BaseResourceOperations';

// Mock KubernetesClient and Watch
jest.mock('../../src/kubernetes/KubernetesClient');
jest.mock('@kubernetes/client-node', () => ({
  ...jest.requireActual('@kubernetes/client-node'),
  Watch: jest.fn(),
}));

describe('ConfigMapOperations', () => {
  let mockClient: jest.Mocked<KubernetesClient>;
  let configMapOperations: ConfigMapOperations;
  let mockCoreV1Api: jest.Mocked<k8s.CoreV1Api>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock CoreV1Api
    mockCoreV1Api = {
      readNamespacedConfigMap: jest.fn(),
      listNamespacedConfigMap: jest.fn(),
      listConfigMapForAllNamespaces: jest.fn(),
    } as any;

    // Setup mock Watch
    (k8s.Watch as unknown as jest.Mock).mockImplementation(() => ({
      watch: jest.fn(),
    }));

    // Setup mock client
    mockClient = {
      core: mockCoreV1Api,
      kubeConfig: {
        makeApiClient: jest.fn(),
      },
      logger: {
        error: jest.fn(),
      },
      config: {
        logger: {
          error: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          debug: jest.fn(),
        },
      },
    } as any;

    // Create ConfigMapOperations instance
    configMapOperations = new ConfigMapOperations(mockClient);
  });

  describe('Read-only Operations', () => {
    describe('get', () => {
      it('should get a configmap by name', async () => {
        const mockConfigMap = { metadata: { name: 'test-configmap' }, data: { key: 'value' } };
        mockCoreV1Api.readNamespacedConfigMap.mockResolvedValue(mockConfigMap);

        const result = await configMapOperations.get('test-configmap', { namespace: 'default' });

        expect(result).toStrictEqual(mockConfigMap);
        expect(mockCoreV1Api.readNamespacedConfigMap).toHaveBeenCalledWith({
          name: 'test-configmap',
          namespace: 'default',
        });
      });

      it('should handle errors when getting a configmap', async () => {
        const error = new Error('Not found');
        mockCoreV1Api.readNamespacedConfigMap.mockRejectedValue(error);

        await expect(configMapOperations.get('test-configmap')).rejects.toThrow();
      });
    });

    describe('list', () => {
      it('should list configmaps in a namespace', async () => {
        const mockConfigMapList = { items: [{ metadata: { name: 'test-configmap' } }] };
        mockCoreV1Api.listNamespacedConfigMap.mockResolvedValue(mockConfigMapList);

        const result = await configMapOperations.list({ namespace: 'default' });

        expect(result).toStrictEqual(mockConfigMapList);
        expect(mockCoreV1Api.listNamespacedConfigMap).toHaveBeenCalledWith(
          expect.objectContaining({
            namespace: 'default',
          }),
        );
      });

      it('should list configmaps across all namespaces', async () => {
        const mockConfigMapList = { items: [{ metadata: { name: 'test-configmap' } }] };
        mockCoreV1Api.listConfigMapForAllNamespaces.mockResolvedValue(mockConfigMapList);

        const result = await configMapOperations.list();

        expect(result).toStrictEqual(mockConfigMapList);
        expect(mockCoreV1Api.listConfigMapForAllNamespaces).toHaveBeenCalled();
      });

      it('should handle errors when listing configmaps', async () => {
        const error = new Error('List failed');
        mockCoreV1Api.listNamespacedConfigMap.mockRejectedValue(error);

        await expect(configMapOperations.list({ namespace: 'default' })).rejects.toThrow();
      });
    });

    describe('watch', () => {
      it('should watch configmaps for changes', async () => {
        const mockCallback = jest.fn();
        const abortFn = jest.fn();
        const mockWatchInstance = {
          watch: jest.fn().mockImplementation((_path, _opts, onData, _onError) => {
            onData('ADDED', { metadata: { name: 'test-configmap' } });
            return { abort: abortFn };
          }),
        };
        (k8s.Watch as unknown as jest.Mock).mockReturnValue(mockWatchInstance);

        const cleanup = configMapOperations.watch(mockCallback, { namespace: 'default' });
        // Wait for async startWatch to complete
        await new Promise((r) => setImmediate(r));
        cleanup();
        expect(abortFn).toHaveBeenCalled();
      });

      it('should handle watch errors', () => {
        const mockCallback = jest.fn();
        const error = new Error('Watch error');
        const mockWatchInstance = {
          watch: jest.fn().mockImplementation((_path, _opts, _onData, onError) => {
            onError(error);
            return { abort: jest.fn() };
          }),
        };
        (k8s.Watch as unknown as jest.Mock).mockReturnValue(mockWatchInstance);

        configMapOperations.watch(mockCallback, { namespace: 'default' });

        expect(mockCallback).toHaveBeenCalledWith({
          type: WatchEventType.ERROR,
          object: {
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: { name: 'watch-error' },
            data: { error: 'Error: Watch error' },
          },
        });
      });
    });

    describe('getValue', () => {
      it('should get a value from configmap by key', async () => {
        const mockConfigMap = {
          metadata: { name: 'test-configmap' },
          data: { testKey: 'testValue' },
        };
        mockCoreV1Api.readNamespacedConfigMap.mockResolvedValue(mockConfigMap);

        const result = await configMapOperations.getValue('test-configmap', 'testKey', {
          namespace: 'default',
        });

        expect(result).toBe('testValue');
        expect(mockCoreV1Api.readNamespacedConfigMap).toHaveBeenCalledWith({
          name: 'test-configmap',
          namespace: 'default',
        });
      });

      it('should return undefined for non-existent key', async () => {
        const mockConfigMap = {
          metadata: { name: 'test-configmap' },
          data: { testKey: 'testValue' },
        };
        mockCoreV1Api.readNamespacedConfigMap.mockResolvedValue(mockConfigMap);

        const result = await configMapOperations.getValue('test-configmap', 'nonExistentKey');

        expect(result).toBeUndefined();
      });

      it('should handle errors when getting value', async () => {
        const error = new Error('ConfigMap not found');
        mockCoreV1Api.readNamespacedConfigMap.mockRejectedValue(error);

        await expect(configMapOperations.getValue('test-configmap', 'testKey')).rejects.toThrow();
      });

      it('should return original value when sanitize option is false', async () => {
        const mockConfigMap = {
          metadata: { name: 'test-configmap' },
          data: { 'secret-key': 'password=mysecretpassword' },
        };
        mockCoreV1Api.readNamespacedConfigMap.mockResolvedValue(mockConfigMap);

        const result = await configMapOperations.getValue('test-configmap', 'secret-key', {
          namespace: 'default',
          skipSanitize: true,
        });

        expect(result).toBe('password=mysecretpassword');
      });
    });
  });

  describe('Data Sanitization', () => {
    describe('sanitizeConfigMapData', () => {
      it('should sanitize private keys', () => {
        const configMap = {
          metadata: { name: 'test-config' },
          data: {
            'private-key': `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...
-----END PRIVATE KEY-----`,
            'rsa-key': `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAuGbXWiK3dQTyCbX5xdE4yCuYp0yyTH...
-----END RSA PRIVATE KEY-----`,
          },
        };

        const sanitized = configMapOperations.sanitizeConfigMapData(configMap);

        expect(sanitized.data!['private-key']).toBe('*** FILTERED ***');
        expect(sanitized.data!['rsa-key']).toBe('*** FILTERED ***');
      });

      it('should sanitize JWT tokens', () => {
        const configMap = {
          metadata: { name: 'test-config' },
          data: {
            'jwt-token':
              'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
          },
        };

        const sanitized = configMapOperations.sanitizeConfigMapData(configMap);

        expect(sanitized.data!['jwt-token']).toBe('*** FILTERED ***');
      });

      it('should sanitize API keys and tokens', () => {
        const configMap = {
          metadata: { name: 'test-config' },
          data: {
            config: `
api_key=sk-1234567890abcdef1234567890abcdef
token: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
secret=mysecretkey123456789
auth_key: Bearer abc123def456ghi789
            `,
          },
        };

        const sanitized = configMapOperations.sanitizeConfigMapData(configMap);
        const sanitizedConfig = sanitized.data!.config;

        expect(sanitizedConfig).toContain('*** FILTERED ***');
        expect(sanitizedConfig).not.toContain('sk-1234567890abcdef1234567890abcdef');
        expect(sanitizedConfig).not.toContain('ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
        expect(sanitizedConfig).not.toContain('mysecretkey123456789');
      });

      it('should sanitize passwords', () => {
        const configMap = {
          metadata: { name: 'test-config' },
          data: {
            config: `
password=mypassword123
pwd: secretpassword
PASSWORD="AnotherSecret!"
            `,
          },
        };

        const sanitized = configMapOperations.sanitizeConfigMapData(configMap);
        const sanitizedConfig = sanitized.data!.config;

        expect(sanitizedConfig).toContain('*** FILTERED ***');
        expect(sanitizedConfig).not.toContain('mypassword123');
        expect(sanitizedConfig).not.toContain('secretpassword');
        expect(sanitizedConfig).not.toContain('AnotherSecret!');
      });

      it('should sanitize database connection strings', () => {
        const configMap = {
          metadata: { name: 'test-config' },
          data: {
            'db-connection': 'postgresql://user:password@localhost:5432/mydb',
            'mongo-uri': 'mongodb://admin:secret123@mongo.example.com:27017/myapp',
          },
        };

        const sanitized = configMapOperations.sanitizeConfigMapData(configMap);

        expect(sanitized.data!['db-connection']).toBe('*** FILTERED ***');
        expect(sanitized.data!['mongo-uri']).toBe('*** FILTERED ***');
      });

      it('should sanitize AWS keys', () => {
        const configMap = {
          metadata: { name: 'test-config' },
          data: {
            'aws-config': `
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
            `,
          },
        };

        const sanitized = configMapOperations.sanitizeConfigMapData(configMap);
        const sanitizedConfig = sanitized.data!['aws-config'];

        expect(sanitizedConfig).toContain('*** FILTERED ***');
        expect(sanitizedConfig).not.toContain('AKIAIOSFODNN7EXAMPLE');
        expect(sanitizedConfig).not.toContain('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
      });

      it('should sanitize SSH keys', () => {
        const configMap = {
          metadata: { name: 'test-config' },
          data: {
            'ssh-key':
              'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7vPKpOcWzVQrxfDWf4eR3MbGklM... user@example.com',
          },
        };

        const sanitized = configMapOperations.sanitizeConfigMapData(configMap);

        expect(sanitized.data!['ssh-key']).toBe('*** FILTERED ***');
      });

      it('should sanitize certificate blocks', () => {
        const configMap = {
          metadata: { name: 'test-config' },
          data: {
            certificate: `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAKoK/OvD/sDNMA0GCSqGSIb3DQEBCwUA...
-----END CERTIFICATE-----`,
          },
        };

        const sanitized = configMapOperations.sanitizeConfigMapData(configMap);

        expect(sanitized.data!.certificate).toBe('*** FILTERED ***');
      });

      it('should sanitize binaryData', () => {
        const sensitiveData = 'password=secret123';
        const configMap = {
          metadata: { name: 'test-config' },
          data: { normalData: 'safe-value' },
          binaryData: {
            'config.properties': Buffer.from(sensitiveData).toString('base64'),
          },
        };

        const sanitized = configMapOperations.sanitizeConfigMapData(configMap);

        expect(sanitized.data!.normalData).toBe('safe-value');
        expect(sanitized.binaryData!['config.properties']).toBe(
          Buffer.from('*** FILTERED ***').toString('base64'),
        );
      });

      it('should handle invalid base64 in binaryData', () => {
        const configMap = {
          metadata: { name: 'test-config' },
          data: {},
          binaryData: {
            'invalid-binary': 'not-valid-base64!@#$',
          },
        };

        const sanitized = configMapOperations.sanitizeConfigMapData(configMap);

        expect(sanitized.binaryData!['invalid-binary']).toBe(
          Buffer.from('*** FILTERED ***').toString('base64'),
        );
      });

      it('should preserve safe data', () => {
        const configMap = {
          metadata: { name: 'test-config' },
          data: {
            'app-name': 'my-application',
            'log-level': 'info',
            timeout: '30s',
            'config.yaml': `
app:
  name: my-app
  port: 8080
  environment: production
            `,
          },
        };

        const sanitized = configMapOperations.sanitizeConfigMapData(configMap);

        expect(sanitized.data!['app-name']).toBe('my-application');
        expect(sanitized.data!['log-level']).toBe('info');
        expect(sanitized.data!['timeout']).toBe('30s');
        expect(sanitized.data!['config.yaml']).toContain('my-app');
        expect(sanitized.data!['config.yaml']).toContain('port: 8080');
      });

      it('should handle ConfigMap without data', () => {
        const configMap = {
          metadata: { name: 'test-config' },
        };

        const sanitized = configMapOperations.sanitizeConfigMapData(configMap);

        expect(sanitized).toEqual(configMap);
      });

      it('should create a deep copy and not modify original', () => {
        const originalConfigMap = {
          metadata: { name: 'test-config' },
          data: {
            secret: 'password=secret123',
            safe: 'safe-value',
          },
        };

        const sanitized = configMapOperations.sanitizeConfigMapData(originalConfigMap);

        expect(originalConfigMap.data.secret).toBe('password=secret123');
        expect(sanitized.data!.secret).toBe('*** FILTERED ***');
        expect(sanitized).not.toBe(originalConfigMap);
      });
    });

    describe('get with sanitization', () => {
      it('should return sanitized data when sanitize option is true', async () => {
        const mockConfigMap = {
          metadata: { name: 'test-configmap' },
          data: {
            'api-key': 'secret-key-12345678901234567890',
            'safe-config': 'app-name=my-app',
          },
        };
        mockCoreV1Api.readNamespacedConfigMap.mockResolvedValue(mockConfigMap);

        const result = await configMapOperations.get('test-configmap', {
          namespace: 'default',
        });

        expect(result.data!['api-key']).toBe('*** FILTERED ***');
        expect(result.data!['safe-config']).toBe('app-name=my-app');
      });

      it('should return original data when sanitize option is false', async () => {
        const mockConfigMap = {
          metadata: { name: 'test-configmap' },
          data: { 'api-key': 'secret-key-12345678901234567890' },
        };
        mockCoreV1Api.readNamespacedConfigMap.mockResolvedValue(mockConfigMap);

        const result = await configMapOperations.get('test-configmap', {
          namespace: 'default',
          skipSanitize: true,
        });

        expect(result.data!['api-key']).toBe('secret-key-12345678901234567890');
      });
    });

    describe('list with sanitization', () => {
      it('should sanitize data when sanitize option is true', async () => {
        const mockConfigMapList = {
          items: [
            {
              metadata: { name: 'config1', namespace: 'default' },
              data: { 'api-key': 'secret123456789012345678' },
            },
            {
              metadata: { name: 'config2', namespace: 'default' },
              data: { 'safe-data': 'app-config' },
            },
          ],
        } as k8s.V1ConfigMapList;
        mockCoreV1Api.listNamespacedConfigMap.mockResolvedValue(mockConfigMapList);

        const result = await configMapOperations.list({
          namespace: 'default',
        });

        expect(result.items[0].data!['api-key']).toBe('*** FILTERED ***');
        expect(result.items[1].data!['safe-data']).toBe('app-config');
      });

      it('should remove data when listing all namespaces without sanitize', async () => {
        const mockConfigMapList = {
          items: [
            {
              metadata: { name: 'config1', namespace: 'default' },
              data: { 'api-key': 'secret123456789012345678' },
            },
          ],
        } as k8s.V1ConfigMapList;
        mockCoreV1Api.listConfigMapForAllNamespaces.mockResolvedValue(mockConfigMapList);

        const result = await configMapOperations.list({ skipSanitize: true });

        expect(result.items[0].data).toBeUndefined();
        expect(result.items[0].binaryData).toBeUndefined();
      });
    });

    describe('getValue with sanitization', () => {
      it('should return sanitized value when sanitize option is true', async () => {
        const mockConfigMap = {
          metadata: { name: 'test-configmap' },
          data: { 'secret-key': 'password=mysecretpassword' },
        };
        mockCoreV1Api.readNamespacedConfigMap.mockResolvedValue(mockConfigMap);

        const result = await configMapOperations.getValue('test-configmap', 'secret-key', {
          namespace: 'default',
        });

        expect(result).toBe('*** FILTERED ***');
      });

      it('should return original value when sanitize option is false', async () => {
        const mockConfigMap = {
          metadata: { name: 'test-configmap' },
          data: { 'secret-key': 'password=mysecretpassword' },
        };
        mockCoreV1Api.readNamespacedConfigMap.mockResolvedValue(mockConfigMap);

        const result = await configMapOperations.getValue('test-configmap', 'secret-key', {
          namespace: 'default',
          skipSanitize: true,
        });

        expect(result).toBe('password=mysecretpassword');
      });
    });
  });

  describe('Unsupported Operations', () => {
    it('should throw error for create operation', async () => {
      await expect(configMapOperations.create({} as k8s.V1ConfigMap)).rejects.toThrow(
        'Create operation is not supported in read-only mode',
      );
    });

    it('should throw error for update operation', async () => {
      await expect(configMapOperations.update({} as k8s.V1ConfigMap)).rejects.toThrow(
        'Update operation is not supported in read-only mode',
      );
    });

    it('should throw error for patch operation', async () => {
      await expect(configMapOperations.patch('test-configmap', {})).rejects.toThrow(
        'Patch operation is not supported in read-only mode',
      );
    });

    it('should throw error for delete operation', async () => {
      await expect(configMapOperations.delete('test-configmap')).rejects.toThrow(
        'Delete operation is not supported in read-only mode',
      );
    });
  });
});

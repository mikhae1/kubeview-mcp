import * as k8s from '@kubernetes/client-node';
import {
  BaseResourceOperations,
  ResourceOperationOptions,
  WatchCallback,
  WatchEventType,
} from '../BaseResourceOperations.js';
import { KubernetesClient } from '../KubernetesClient.js';
import { isSensitiveMaskEnabled } from '../../utils/SensitiveData.js';

/**
 * ConfigMap operations implementation - Read-only operations
 */
export class ConfigMapOperations extends BaseResourceOperations<k8s.V1ConfigMap> {
  /**
   * Regular expressions for detecting sensitive data patterns in keys
   */
  private readonly sensitiveKeyPatterns: RegExp[] = [
    // Generic credentials
    /(?:password|passwd|pwd)/gi,
    /(?:secret|token)/gi,
    /(?:api[_-]?(?:key|token|secret|password))/gi,
    /(?:auth[_-]?(?:token|secret))/gi,
    /(?:access(?:[_-]?key)?|access[_-]?token)/gi,
    /(?:refresh[_-]?token)/gi,
    /(?:client[_-]?(?:id|secret))/gi,
    /(?:credential(?:s)?)/gi,

    // Certificates & keys - improved patterns
    /(?:private[_-]?(?:key|rsa|dsa|ecdsa|pem|pfx|pkcs12|p12))/gi,
    /(?:rsa[_-]?key)/gi,
    /(?:dsa[_-]?key)/gi,
    /(?:ecdsa[_-]?key)/gi,
    /(?:ssh[_-]?key)/gi,
    /(?:tls|ssl|x509)[_-]?(?:cert|certificate|key)/gi,
    /(?:cert(?:ificate)?|certfile)/gi,
    /(?:jwt.*)/gi,
    /(?:bearer.*)/gi,
    /(?:ca\.crt|ca\.key|ca\.pem|ca\.pfx|ca\.pkcs12|ca\.p12)/gi,

    // Session & cookie data
    /(?:session[_-]?id)/gi,
    /cookie/gi,

    // Database & connection strings
    /(?:db|database)[_-]?password/gi,
    /(?:connection[_-]?string|dsn)/gi,
  ];

  private readonly sensitiveValuePatterns: RegExp[] = [
    // JWT tokens (header.payload.signature)
    /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,

    // SSH keys (complete line including user@host)
    /ssh-(?:rsa|dss|ed25519|ecdsa)\s+[A-Za-z0-9+/=]+[^\r\n]*/gi,

    // API keys and tokens (common patterns) - improved to catch more variations
    /\b(?:api[_-]?key|token|secret|auth[_-]?key|access[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9+/=_-]{16,}['"]?/gi,

    // Secret-like strings with common prefixes (for test cases like "secret-key-...")
    /(?:secret|key|token|api)[_-][A-Za-z0-9_-]{15,}/gi,

    // Long alphanumeric strings that look like secrets (20+ chars)
    /(?<!\w)[A-Za-z0-9]{20,}(?!\w)/g,

    // AWS Secret Access Key pattern (40 chars base64-like)
    /[A-Za-z0-9+/]{40}/g,

    // Password patterns (more specific to avoid false positives)
    /\b(?:password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{6,}['"]?/gi,
    /(?:password|passwd|pwd)>.*<?/gi,

    // Database connection strings with credentials
    /(?:postgresql|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^\s]+/gi,
    /\b(?:host|server)\s*[:=]\s*[^;]+;\s*(?:user|uid)\s*[:=]\s*[^;]+;\s*(?:password|pwd)\s*[:=]\s*[^;]+/gi,

    // Cloud provider keys
    /\bAKIA[0-9A-Z]{16}\b/g, // AWS Access Key ID
    /\bgcp[_-]?[A-Za-z0-9+/=_-]{32,}/gi, // GCP keys
    /\bazure[_-]?[A-Za-z0-9+/=_-]{32,}/gi, // Azure keys

    // Credit card numbers (basic pattern)
    /\b(?:\d{4}[- ]?){3}\d{4}\b/g,
  ];

  constructor(client: KubernetesClient) {
    super(client, 'ConfigMap');
  }

  /**
   * Sanitize sensitive data in a ConfigMap
   * @param configMap The ConfigMap to sanitize
   * @returns A new ConfigMap with sensitive data replaced by "*** FILTERED ***"
   */
  sanitizeConfigMapData(configMap: k8s.V1ConfigMap): k8s.V1ConfigMap {
    if (!configMap.data) {
      return configMap;
    }

    // Create a deep copy to avoid modifying the original
    const sanitized: k8s.V1ConfigMap = JSON.parse(JSON.stringify(configMap));

    // Sanitize each data value
    for (const [key, value] of Object.entries(sanitized.data!)) {
      if (typeof value === 'string') {
        sanitized.data![key] = this.sanitizeKeyValue(key, value);
      }
    }

    // Also sanitize binaryData if present
    if (sanitized.binaryData) {
      for (const [key, value] of Object.entries(sanitized.binaryData)) {
        if (typeof value === 'string') {
          // Check if it's valid base64 (only contains base64 characters and proper padding)
          const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
          if (base64Regex.test(value)) {
            try {
              // Decode base64, sanitize, and re-encode
              const decoded = Buffer.from(value, 'base64').toString('utf-8');
              const sanitizedDecoded = this.sanitizeKeyValue(key, decoded);
              sanitized.binaryData[key] = Buffer.from(sanitizedDecoded).toString('base64');
            } catch {
              // If decoding fails, treat as potentially sensitive binary data
              sanitized.binaryData[key] = Buffer.from('*** FILTERED ***').toString('base64');
            }
          } else {
            // Not valid base64, treat as potentially sensitive binary data
            sanitized.binaryData[key] = Buffer.from('*** FILTERED ***').toString('base64');
          }
        }
      }
    }

    return sanitized;
  }

  /**
   * Sanitize a key-value pair, checking both key patterns and value patterns
   * @param key The key name to check against sensitive patterns
   * @param value The string value to sanitize
   * @returns The sanitized string with sensitive data replaced
   */
  private sanitizeKeyValue(key: string, value: string): string {
    // First check if the key itself indicates sensitive data
    for (const pattern of this.sensitiveKeyPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(key)) {
        return '*** FILTERED ***';
      }
    }

    // If key doesn't match sensitive patterns, check value content
    let sanitized = value;
    for (const pattern of this.sensitiveValuePatterns) {
      // Reset regex lastIndex to ensure consistent behavior
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, '*** FILTERED ***');
    }

    return sanitized;
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async create(
    _configMap: k8s.V1ConfigMap,
    _options?: ResourceOperationOptions,
  ): Promise<k8s.V1ConfigMap> {
    throw new Error('Create operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async update(
    _configMap: k8s.V1ConfigMap,
    _options?: ResourceOperationOptions,
  ): Promise<k8s.V1ConfigMap> {
    throw new Error('Update operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async patch(
    _name: string,
    _patch: unknown,
    _options?: ResourceOperationOptions,
  ): Promise<k8s.V1ConfigMap> {
    throw new Error('Patch operation is not supported in read-only mode');
  }

  /**
   * @throws {Error} This operation is not supported in read-only mode
   */
  async delete(_name: string, _options?: ResourceOperationOptions): Promise<void> {
    throw new Error('Delete operation is not supported in read-only mode');
  }

  /**
   * Get a ConfigMap by name
   */
  async get(name: string, options?: ResourceOperationOptions): Promise<k8s.V1ConfigMap> {
    try {
      const namespace = options?.namespace || 'default';
      let response = await this.client.core.readNamespacedConfigMap({
        name,
        namespace,
      });

      // Apply sanitization if requested or globally enforced
      if (!options?.skipSanitize || isSensitiveMaskEnabled()) {
        response = this.sanitizeConfigMapData(response);
      }

      return response;
    } catch (error) {
      this.handleApiError(error, 'Get', name);
    }
  }

  /**
   * List ConfigMaps with optional data sanitization
   */
  async list(options?: ResourceOperationOptions): Promise<k8s.V1ConfigMapList> {
    try {
      const namespace = options?.namespace;
      const listOptions = this.buildListOptions(options);

      let response;
      if (namespace) {
        response = await this.client.core.listNamespacedConfigMap({
          namespace,
          pretty: listOptions.pretty,
          allowWatchBookmarks: listOptions.allowWatchBookmarks,
          _continue: listOptions.continue,
          fieldSelector: listOptions.fieldSelector,
          labelSelector: listOptions.labelSelector,
          limit: listOptions.limit,
          resourceVersion: listOptions.resourceVersion,
          resourceVersionMatch: listOptions.resourceVersionMatch,
          sendInitialEvents: listOptions.sendInitialEvents,
          timeoutSeconds: listOptions.timeoutSeconds,
          watch: listOptions.watch,
        });
      } else {
        response = await this.client.core.listConfigMapForAllNamespaces({
          allowWatchBookmarks: listOptions.allowWatchBookmarks,
          _continue: listOptions.continue,
          fieldSelector: listOptions.fieldSelector,
          labelSelector: listOptions.labelSelector,
          limit: listOptions.limit,
          pretty: listOptions.pretty,
          resourceVersion: listOptions.resourceVersion,
          resourceVersionMatch: listOptions.resourceVersionMatch,
          sendInitialEvents: listOptions.sendInitialEvents,
          timeoutSeconds: listOptions.timeoutSeconds,
          watch: listOptions.watch,
        });
      }

      // Sanitize sensitive data if requested or globally enforced
      if (!options?.skipSanitize || isSensitiveMaskEnabled()) {
        response.items = response.items.map((item) => this.sanitizeConfigMapData(item));
      }

      response.items = response.items.map((item) => ({
        ...item,
        name: item.metadata?.name,
        namespace: item.metadata?.namespace,
        metadata: {
          labels: item.metadata?.labels,
          annotations: item.metadata?.annotations,
          creationTimestamp: item.metadata?.creationTimestamp,
        },
      }));

      // Remove data from response if namespace is not provided
      if (!namespace) {
        response.items = response.items.map((item) => ({
          ...item,
          creationTimestamp: item.metadata?.creationTimestamp,
          data: undefined,
          binaryData: undefined,
          metadata: undefined,
        }));
      }

      return response;
    } catch (error) {
      this.handleApiError(error, 'List');
    }
  }

  /**
   * Watch ConfigMaps for changes
   */
  watch(callback: WatchCallback<k8s.V1ConfigMap>, options?: ResourceOperationOptions): () => void {
    let stopWatching = false;
    let request: unknown = null;

    const startWatch = async (): Promise<void> => {
      try {
        const namespace = options?.namespace;
        const listOptions = this.buildListOptions(options);

        const watch = new k8s.Watch(this.client.kubeConfig);
        request = await watch.watch(
          `/api/v1/${namespace ? `namespaces/${namespace}/` : ''}configmaps`,
          listOptions,
          (type: string, obj: k8s.V1ConfigMap) => {
            if (!stopWatching) {
              callback({
                type: type as WatchEventType,
                object: obj,
              });
            }
          },
          (err: unknown) => {
            if (!stopWatching) {
              this.logger?.error(`Watch error for ConfigMaps: ${err}`);
              // For error events, we need to create a valid V1ConfigMap-like object
              // or handle the error differently since the callback expects V1ConfigMap
              const errorObj = {
                apiVersion: 'v1',
                kind: 'ConfigMap',
                metadata: { name: 'watch-error' },
                data: { error: String(err) },
              } as k8s.V1ConfigMap;

              callback({
                type: WatchEventType.ERROR,
                object: errorObj,
              });
            }
          },
        );
      } catch (error) {
        this.logger?.error(`Failed to start watch for ConfigMaps: ${error}`);
        throw error;
      }
    };

    startWatch().catch((error) => {
      this.logger?.error(`Failed to start ConfigMap watch: ${error}`);
    });

    return () => {
      stopWatching = true;
      if (request && typeof request === 'object' && request !== null && 'abort' in request) {
        (request as { abort: () => void }).abort();
      }
    };
  }

  /**
   * Get a value from a ConfigMap by key
   */
  async getValue(
    name: string,
    key: string,
    options?: ResourceOperationOptions,
  ): Promise<string | undefined> {
    const configMap = await this.get(name, options);
    return configMap.data?.[key];
  }
}

import * as k8s from '@kubernetes/client-node';
import { Logger } from 'winston';
import { KubernetesClient } from './KubernetesClient.js';
import { RetryableOperationFactory, RetryableOperation } from './RetryableOperation.js';
import { ErrorMonitor, KubernetesError, convertApiError } from './ErrorHandling.js';

/**
 * Common options for resource operations
 */
export interface ResourceOperationOptions {
  /**
   * Namespace for the operation (required for namespaced resources)
   */
  namespace?: string;

  /**
   * Label selector for filtering resources
   */
  labelSelector?: string;

  /**
   * Field selector for filtering resources
   */
  fieldSelector?: string;

  /**
   * Maximum number of results to return
   */
  limit?: number;

  /**
   * Continue token for pagination
   */
  continueToken?: string;

  /**
   * Resource version for optimistic concurrency control
   */
  resourceVersion?: string;

  /**
   * Timeout in seconds for the operation
   */
  timeoutSeconds?: number;

  /**
   * Whether to propagate deletion to dependents
   */
  propagationPolicy?: 'Foreground' | 'Background' | 'Orphan';

  /**
   * Grace period seconds for deletion
   */
  gracePeriodSeconds?: number;

  /**
   * Whether to sanitize sensitive data in ConfigMaps and Secrets
   */
  skipSanitize?: boolean;
}

/**
 * Watch event types
 */
export enum WatchEventType {
  ADDED = 'ADDED',
  MODIFIED = 'MODIFIED',
  DELETED = 'DELETED',
  ERROR = 'ERROR',
}

/**
 * Watch event interface
 */
export interface WatchEvent<T> {
  type: WatchEventType;
  object: T;
}

/**
 * Watch callback function
 */
export type WatchCallback<T> = (event: WatchEvent<T>) => void;

/**
 * Generic interface for resource operations
 */
export interface IResourceOperations<T extends k8s.KubernetesObject> {
  /**
   * Create a new resource
   */
  create(resource: T, options?: ResourceOperationOptions): Promise<T>;

  /**
   * Get a resource by name
   */
  get(name: string, options?: ResourceOperationOptions): Promise<T>;

  /**
   * Update an existing resource
   */
  update(resource: T, options?: ResourceOperationOptions): Promise<T>;

  /**
   * Patch a resource
   */
  patch(name: string, patch: any, options?: ResourceOperationOptions): Promise<T>;

  /**
   * Delete a resource
   */
  delete(name: string, options?: ResourceOperationOptions): Promise<void>;

  /**
   * List resources
   */
  list(options?: ResourceOperationOptions): Promise<k8s.KubernetesListObject<T>>;

  /**
   * Watch resources for changes
   */
  watch(callback: WatchCallback<T>, options?: ResourceOperationOptions): () => void;
}

/**
 * Error class for Kubernetes operations
 */
export class KubernetesOperationError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly resource?: string,
    public readonly operation?: string,
  ) {
    super(message);
    this.name = 'KubernetesOperationError';
  }
}

/**
 * Base class for resource operations with integrated retry and error handling
 */
export abstract class BaseResourceOperations<T extends k8s.KubernetesObject>
  implements IResourceOperations<T>
{
  protected logger?: Logger;
  protected retryFactory: RetryableOperationFactory;
  protected errorMonitor: ErrorMonitor;

  constructor(
    protected client: KubernetesClient,
    protected resourceType: string,
  ) {
    this.logger = client['config'].logger;
    this.errorMonitor = new ErrorMonitor(this.logger);

    // Initialize retry factory with default configuration
    this.retryFactory = new RetryableOperationFactory(
      {
        retry: {
          maxAttempts: 3,
          initialDelayMs: 100,
          maxDelayMs: 5000,
          backoffMultiplier: 2,
          jitterFactor: 0.1,
        },
        circuitBreaker: {
          failureThreshold: 5,
          successThreshold: 2,
          resetTimeout: 30000,
          failureCountWindow: 10000,
        },
        errorMonitor: this.errorMonitor,
        logger: this.logger,
      },
      this.logger,
    );
  }

  /**
   * Get or create a retryable operation for a specific action
   */
  protected getRetryableOperation<R>(operationName: string): RetryableOperation<R> {
    return this.retryFactory.create<R>(`${this.resourceType}.${operationName}`);
  }

  /**
   * Handle API errors and convert to KubernetesOperationError
   */
  protected handleApiError(error: any, operation: string, resourceName?: string): never {
    // Convert to typed error
    let typedError = error instanceof KubernetesError ? error : convertApiError(error);

    // Add resource context by creating a new error with additional details
    if (resourceName && typedError instanceof KubernetesError) {
      const newError = new KubernetesError(
        typedError.message,
        typedError.code,
        typedError.statusCode,
        typedError.retryable,
        {
          ...typedError.details,
          resource: this.resourceType,
          resourceName,
          operation,
        },
      );
      typedError = newError;
    }

    throw typedError;
  }

  /**
   * Build list options from ResourceOperationOptions
   */
  protected buildListOptions(options?: ResourceOperationOptions): any {
    const listOptions: any = {};

    if (options?.labelSelector) {
      listOptions.labelSelector = options.labelSelector;
    }

    if (options?.fieldSelector) {
      listOptions.fieldSelector = options.fieldSelector;
    }

    if (options?.limit) {
      listOptions.limit = options.limit;
    }

    if (options?.continueToken) {
      listOptions.continue = options.continueToken;
    }

    if (options?.resourceVersion) {
      listOptions.resourceVersion = options.resourceVersion;
    }

    if (options?.timeoutSeconds) {
      listOptions.timeoutSeconds = options.timeoutSeconds;
    }

    return listOptions;
  }

  /**
   * Build delete options from ResourceOperationOptions
   */
  protected buildDeleteOptions(options?: ResourceOperationOptions): k8s.V1DeleteOptions {
    const deleteOptions: k8s.V1DeleteOptions = {};

    if (options?.propagationPolicy) {
      deleteOptions.propagationPolicy = options.propagationPolicy;
    }

    if (options?.gracePeriodSeconds !== undefined) {
      deleteOptions.gracePeriodSeconds = options.gracePeriodSeconds;
    }

    return deleteOptions;
  }

  /**
   * Get error statistics for this resource type
   */
  public getErrorStats() {
    return this.errorMonitor.getStats();
  }

  /**
   * Reset circuit breakers for all operations
   */
  public resetCircuits() {
    this.retryFactory.resetAllCircuits();
  }

  // Abstract methods to be implemented by resource-specific classes
  abstract create(resource: T, options?: ResourceOperationOptions): Promise<T>;
  abstract get(name: string, options?: ResourceOperationOptions): Promise<T>;
  abstract update(resource: T, options?: ResourceOperationOptions): Promise<T>;
  abstract patch(name: string, patch: any, options?: ResourceOperationOptions): Promise<T>;
  abstract delete(name: string, options?: ResourceOperationOptions): Promise<void>;
  abstract list(options?: ResourceOperationOptions): Promise<k8s.KubernetesListObject<T>>;
  abstract watch(callback: WatchCallback<T>, options?: ResourceOperationOptions): () => void;
}

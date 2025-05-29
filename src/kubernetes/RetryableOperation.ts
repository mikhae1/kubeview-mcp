/**
 * Retryable Operation Module
 *
 * Combines retry logic and circuit breaker pattern into a single
 * reusable component for Kubernetes operations.
 */

import { Logger } from 'winston';
import { RetryStrategy, RetryConfig, RETRY_PRESETS } from './RetryStrategy';
import { CircuitBreaker, CircuitBreakerConfig } from './CircuitBreaker';
import { ErrorMonitor, KubernetesError, ErrorContext } from './ErrorHandling';

/**
 * Configuration for retryable operations
 */
export interface RetryableOperationConfig {
  /** Retry configuration */
  retry?: Partial<RetryConfig>;
  /** Circuit breaker configuration */
  circuitBreaker?: Partial<Omit<CircuitBreakerConfig, 'name'>>;
  /** Error monitor instance */
  errorMonitor?: ErrorMonitor;
  /** Logger instance */
  logger?: Logger;
}

/**
 * Result of a retryable operation
 */
export interface OperationResult<T> {
  success: boolean;
  value?: T;
  error?: any;
  attempts: number;
  totalTimeMs: number;
  circuitState?: string;
}

/**
 * Retryable operation that combines retry and circuit breaker
 */
export class RetryableOperation<T> {
  private readonly retryStrategy: RetryStrategy;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly errorMonitor?: ErrorMonitor;
  private readonly logger?: Logger;

  constructor(
    private readonly operationName: string,
    config: RetryableOperationConfig = {},
  ) {
    this.logger = config.logger;
    this.errorMonitor = config.errorMonitor;

    // Initialize retry strategy
    this.retryStrategy = new RetryStrategy(config.retry || RETRY_PRESETS.STANDARD, this.logger);

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker(
      {
        name: operationName,
        failureThreshold: 5,
        successThreshold: 2,
        failureCountWindow: 60000,
        resetTimeout: 30000,
        ...config.circuitBreaker,
      },
      this.logger,
    );

    // Set up circuit breaker event listeners
    this.setupCircuitBreakerEvents();
  }

  /**
   * Execute an operation with retry and circuit breaker protection
   */
  async execute<R = T>(
    operation: () => Promise<R>,
    context?: ErrorContext,
  ): Promise<OperationResult<R>> {
    const startTime = Date.now();

    try {
      // Execute through circuit breaker
      const result = await this.circuitBreaker.execute(async () => {
        // Execute with retry logic
        const retryResult = await this.retryStrategy.execute(operation, this.operationName);

        if (!retryResult.success) {
          throw retryResult.error;
        }

        return retryResult;
      });

      return {
        success: true,
        value: result.value as R,
        attempts: result.attempts,
        totalTimeMs: Date.now() - startTime,
        circuitState: this.circuitBreaker.getState(),
      };
    } catch (error) {
      // Record error in monitor if available
      if (this.errorMonitor && error instanceof KubernetesError) {
        this.errorMonitor.recordError(error, this.operationName);
      }

      // Log error with context
      this.logger?.error(`Operation '${this.operationName}' failed`, {
        error: error instanceof Error ? error.message : String(error),
        context,
        circuitState: this.circuitBreaker.getState(),
        stats: this.circuitBreaker.getStats(),
      });

      return {
        success: false,
        error,
        attempts: 1, // Default if retry info not available
        totalTimeMs: Date.now() - startTime,
        circuitState: this.circuitBreaker.getState(),
      };
    }
  }

  /**
   * Execute operation and throw on failure
   */
  async executeOrThrow<R = T>(operation: () => Promise<R>, context?: ErrorContext): Promise<R> {
    const result = await this.execute(operation, context);

    if (!result.success) {
      throw result.error;
    }

    return result.value!;
  }

  /**
   * Get circuit breaker state
   */
  getCircuitState(): string {
    return this.circuitBreaker.getState();
  }

  /**
   * Get circuit breaker statistics
   */
  getCircuitStats() {
    return this.circuitBreaker.getStats();
  }

  /**
   * Manually reset the circuit breaker
   */
  resetCircuit(): void {
    this.circuitBreaker.reset();
  }

  /**
   * Force open the circuit breaker
   */
  openCircuit(): void {
    this.circuitBreaker.open();
  }

  /**
   * Set up circuit breaker event listeners
   */
  private setupCircuitBreakerEvents(): void {
    this.circuitBreaker.on('state-change', (oldState, newState) => {
      this.logger?.info(
        `Circuit breaker state changed for '${this.operationName}': ${oldState} -> ${newState}`,
      );
    });

    this.circuitBreaker.on('circuit-open', (stats) => {
      this.logger?.warn(`Circuit breaker opened for '${this.operationName}'`, { stats });
    });

    this.circuitBreaker.on('circuit-close', (stats) => {
      this.logger?.info(`Circuit breaker closed for '${this.operationName}'`, { stats });
    });
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.circuitBreaker.dispose();
  }
}

/**
 * Factory for creating retryable operations
 */
export class RetryableOperationFactory {
  private readonly operations = new Map<string, RetryableOperation<any>>();
  private readonly defaultConfig: RetryableOperationConfig;

  constructor(defaultConfig: RetryableOperationConfig = {}, logger?: Logger) {
    this.defaultConfig = {
      ...defaultConfig,
      logger: logger || defaultConfig.logger,
    };
  }

  /**
   * Create or get a retryable operation
   */
  create<T>(operationName: string, config?: RetryableOperationConfig): RetryableOperation<T> {
    const existingOperation = this.operations.get(operationName);

    if (existingOperation) {
      return existingOperation;
    }

    const operation = new RetryableOperation<T>(operationName, {
      ...this.defaultConfig,
      ...config,
    });

    this.operations.set(operationName, operation);
    return operation;
  }

  /**
   * Get an existing operation
   */
  get<T>(operationName: string): RetryableOperation<T> | undefined {
    return this.operations.get(operationName);
  }

  /**
   * Remove an operation
   */
  remove(operationName: string): boolean {
    const operation = this.operations.get(operationName);

    if (operation) {
      operation.dispose();
      return this.operations.delete(operationName);
    }

    return false;
  }

  /**
   * Get all operation names
   */
  getOperationNames(): string[] {
    return Array.from(this.operations.keys());
  }

  /**
   * Get statistics for all operations
   */
  getAllStats(): Record<string, any> {
    const stats: Record<string, any> = {};

    for (const [name, operation] of this.operations) {
      stats[name] = {
        circuitState: operation.getCircuitState(),
        circuitStats: operation.getCircuitStats(),
      };
    }

    return stats;
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuits(): void {
    for (const operation of this.operations.values()) {
      operation.resetCircuit();
    }
  }

  /**
   * Dispose all operations
   */
  dispose(): void {
    for (const operation of this.operations.values()) {
      operation.dispose();
    }
    this.operations.clear();
  }
}

/**
 * Decorator for making methods retryable
 */
export function RetryableMethod(operationName?: string, config?: RetryableOperationConfig) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const opName = operationName || `${target.constructor.name}.${propertyKey}`;

    // Create a factory instance for the decorator
    const factory = new RetryableOperationFactory(config);

    descriptor.value = async function (...args: any[]) {
      const operation = factory.create(opName);

      return operation.executeOrThrow(() => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}

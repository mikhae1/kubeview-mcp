/**
 * Error Handler Module
 *
 * Provides interfaces and implementations for custom error handling strategies
 * in Kubernetes operations.
 */

import { Logger } from 'winston';
import { KubernetesError, ErrorContext, createContextualError } from './ErrorHandling';
import { RetryStrategy, RetryConfig, RETRY_PRESETS } from './RetryStrategy';
import { CircuitBreaker, CircuitBreakerConfig, CircuitBreakerFactory } from './CircuitBreaker';

/**
 * Error handler interface
 */
export interface IErrorHandler {
  /**
   * Handle an error
   * @returns true if error was handled, false to propagate
   */
  handle(error: any, context?: ErrorContext): Promise<boolean> | boolean;

  /**
   * Transform an error
   */
  transform?(error: any, context?: ErrorContext): any;

  /**
   * Check if handler can handle this error
   */
  canHandle?(error: any): boolean;
}

/**
 * Error handler chain configuration
 */
export interface ErrorHandlerChainConfig {
  handlers: IErrorHandler[];
  logger?: Logger;
  stopOnFirstHandled?: boolean;
}

/**
 * Composite error handler that chains multiple handlers
 */
export class ErrorHandlerChain implements IErrorHandler {
  private readonly handlers: IErrorHandler[];
  private readonly logger?: Logger;
  private readonly stopOnFirstHandled: boolean;

  constructor(config: ErrorHandlerChainConfig) {
    this.handlers = config.handlers;
    this.logger = config.logger;
    this.stopOnFirstHandled = config.stopOnFirstHandled ?? true;
  }

  async handle(error: any, context?: ErrorContext): Promise<boolean> {
    let handled = false;

    for (const handler of this.handlers) {
      try {
        // Check if handler can handle this error
        if (handler.canHandle && !handler.canHandle(error)) {
          continue;
        }

        // Let handler process the error
        const result = await handler.handle(error, context);

        if (result) {
          handled = true;
          this.logger?.debug(`Error handled by ${handler.constructor.name}`);

          if (this.stopOnFirstHandled) {
            break;
          }
        }
      } catch (handlerError) {
        this.logger?.error(`Error in handler ${handler.constructor.name}:`, handlerError);
      }
    }

    return handled;
  }

  transform(error: any, context?: ErrorContext): any {
    let transformedError = error;

    for (const handler of this.handlers) {
      if (handler.transform) {
        try {
          transformedError = handler.transform(transformedError, context);
        } catch (transformError) {
          this.logger?.error(`Error in transform ${handler.constructor.name}:`, transformError);
        }
      }
    }

    return transformedError;
  }

  canHandle(error: any): boolean {
    return this.handlers.some((h) => !h.canHandle || h.canHandle(error));
  }

  /**
   * Add a handler to the chain
   */
  addHandler(handler: IErrorHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Remove a handler from the chain
   */
  removeHandler(handler: IErrorHandler): void {
    const index = this.handlers.indexOf(handler);
    if (index !== -1) {
      this.handlers.splice(index, 1);
    }
  }
}

/**
 * Logging error handler
 */
export class LoggingErrorHandler implements IErrorHandler {
  constructor(
    private readonly logger: Logger,
    private readonly logLevel: 'error' | 'warn' | 'info' = 'error',
  ) {}

  handle(error: any, context?: ErrorContext): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const details = {
      error: error instanceof Error ? error.stack : error,
      context,
    };

    this.logger[this.logLevel](message, details);
    return false; // Don't stop propagation
  }
}

/**
 * Retry error handler with configurable strategy
 */
export class RetryErrorHandler implements IErrorHandler {
  private readonly retryStrategy: RetryStrategy;

  constructor(retryConfig: Partial<RetryConfig> = RETRY_PRESETS.STANDARD, logger?: Logger) {
    this.retryStrategy = new RetryStrategy(retryConfig, logger);
  }

  canHandle(error: any): boolean {
    if (error instanceof KubernetesError) {
      return error.retryable;
    }
    return true; // Attempt retry for other errors
  }

  async handle(_error: any, _context?: ErrorContext): Promise<boolean> {
    // This handler doesn't directly handle errors but provides retry capability
    // It should be used in conjunction with operation execution
    return false;
  }

  /**
   * Get the retry strategy for use in operations
   */
  getRetryStrategy(): RetryStrategy {
    return this.retryStrategy;
  }
}

/**
 * Circuit breaker error handler
 */
export class CircuitBreakerErrorHandler implements IErrorHandler {
  private readonly circuitBreakerFactory: CircuitBreakerFactory;
  private readonly defaultConfig: Omit<CircuitBreakerConfig, 'name'>;

  constructor(defaultConfig?: Partial<Omit<CircuitBreakerConfig, 'name'>>, logger?: Logger) {
    this.circuitBreakerFactory = new CircuitBreakerFactory(logger);
    this.defaultConfig = {
      failureThreshold: 5,
      successThreshold: 2,
      failureCountWindow: 60000,
      resetTimeout: 30000,
      ...defaultConfig,
    };
  }

  handle(_error: any, context?: ErrorContext): boolean {
    if (context?.operation) {
      // Circuit breaker will track this failure internally
      // when execute() was called
      this.getCircuitBreaker(context.operation);
    }
    return false; // Don't stop propagation
  }

  /**
   * Get or create a circuit breaker for an operation
   */
  getCircuitBreaker(operationName: string): CircuitBreaker {
    return this.circuitBreakerFactory.getOrCreate({
      ...this.defaultConfig,
      name: operationName,
    });
  }

  /**
   * Get circuit breaker factory
   */
  getFactory(): CircuitBreakerFactory {
    return this.circuitBreakerFactory;
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.circuitBreakerFactory.dispose();
  }
}

/**
 * Transformation error handler that enriches errors with context
 */
export class ContextEnrichmentHandler implements IErrorHandler {
  handle(_error: any, _context?: ErrorContext): boolean {
    return false; // Just transform, don't handle
  }

  transform(error: any, context?: ErrorContext): any {
    if (context && error instanceof KubernetesError) {
      return createContextualError(error, context);
    }
    return error;
  }
}

/**
 * Rate limit error handler with backoff
 */
export class RateLimitHandler implements IErrorHandler {
  private readonly rateLimits = new Map<
    string,
    {
      resetTime: number;
      retryAfter: number;
    }
  >();

  constructor(private readonly logger?: Logger) {}

  canHandle(error: any): boolean {
    return error instanceof KubernetesError && error.code === 'RATE_LIMIT_ERROR';
  }

  async handle(error: any, context?: ErrorContext): Promise<boolean> {
    if (error instanceof KubernetesError && error.details?.retryAfter) {
      const key = context?.operation || 'default';
      const retryAfter = error.details.retryAfter * 1000; // Convert to ms

      this.rateLimits.set(key, {
        resetTime: Date.now() + retryAfter,
        retryAfter,
      });

      this.logger?.warn(`Rate limited for operation '${key}'. Retry after ${retryAfter}ms`);

      // Wait for the specified time
      await new Promise((resolve) => setTimeout(resolve, retryAfter));

      return true; // Handled by waiting
    }

    return false;
  }

  /**
   * Check if operation is currently rate limited
   */
  isRateLimited(operation: string): boolean {
    const limit = this.rateLimits.get(operation);
    if (!limit) return false;

    if (Date.now() >= limit.resetTime) {
      this.rateLimits.delete(operation);
      return false;
    }

    return true;
  }

  /**
   * Get remaining wait time for rate limited operation
   */
  getRemainingWaitTime(operation: string): number {
    const limit = this.rateLimits.get(operation);
    if (!limit) return 0;

    const remaining = limit.resetTime - Date.now();
    return Math.max(0, remaining);
  }
}

/**
 * Default error handler factory
 */
export class ErrorHandlerFactory {
  static createDefault(logger?: Logger): ErrorHandlerChain {
    return new ErrorHandlerChain({
      handlers: [
        new LoggingErrorHandler(logger || (console as any)),
        new ContextEnrichmentHandler(),
        new RateLimitHandler(logger),
      ],
      logger,
      stopOnFirstHandled: false,
    });
  }

  static createWithRetry(retryConfig?: Partial<RetryConfig>, logger?: Logger): ErrorHandlerChain {
    const chain = this.createDefault(logger);
    chain.addHandler(new RetryErrorHandler(retryConfig, logger));
    return chain;
  }

  static createWithCircuitBreaker(
    circuitConfig?: Partial<Omit<CircuitBreakerConfig, 'name'>>,
    logger?: Logger,
  ): ErrorHandlerChain {
    const chain = this.createDefault(logger);
    chain.addHandler(new CircuitBreakerErrorHandler(circuitConfig, logger));
    return chain;
  }

  static createComplete(
    retryConfig?: Partial<RetryConfig>,
    circuitConfig?: Partial<Omit<CircuitBreakerConfig, 'name'>>,
    logger?: Logger,
  ): {
    chain: ErrorHandlerChain;
    retryHandler: RetryErrorHandler;
    circuitHandler: CircuitBreakerErrorHandler;
  } {
    const retryHandler = new RetryErrorHandler(retryConfig, logger);
    const circuitHandler = new CircuitBreakerErrorHandler(circuitConfig, logger);

    const chain = new ErrorHandlerChain({
      handlers: [
        new LoggingErrorHandler(logger || (console as any)),
        new ContextEnrichmentHandler(),
        new RateLimitHandler(logger),
        retryHandler,
        circuitHandler,
      ],
      logger,
      stopOnFirstHandled: false,
    });

    return { chain, retryHandler, circuitHandler };
  }
}

/**
 * Error recovery strategies
 */
export interface IErrorRecovery<T> {
  /**
   * Attempt to recover from an error
   * @returns Recovery result or throws if recovery fails
   */
  recover(error: any, context?: ErrorContext): Promise<T> | T;
}

/**
 * Fallback recovery strategy
 */
export class FallbackRecovery<T> implements IErrorRecovery<T> {
  constructor(
    private readonly fallbackValue: T | (() => T | Promise<T>),
    private readonly condition?: (error: any) => boolean,
  ) {}

  async recover(error: any, _context?: ErrorContext): Promise<T> {
    if (this.condition && !this.condition(error)) {
      throw error;
    }

    if (typeof this.fallbackValue === 'function') {
      return (this.fallbackValue as () => T | Promise<T>)();
    }

    return this.fallbackValue;
  }
}

/**
 * Cache-based recovery strategy
 */
export class CacheRecovery<T> implements IErrorRecovery<T> {
  private cache = new Map<string, { value: T; timestamp: number }>();

  constructor(
    private readonly cacheKey: (context?: ErrorContext) => string,
    private readonly ttlMs: number = 300000, // 5 minutes default
  ) {}

  async recover(error: any, context?: ErrorContext): Promise<T> {
    const key = this.cacheKey(context);
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      return cached.value;
    }

    throw error; // No valid cache entry
  }

  /**
   * Store value in cache
   */
  store(value: T, context?: ErrorContext): void {
    const key = this.cacheKey(context);
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
  }
}

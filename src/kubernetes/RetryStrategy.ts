/**
 * Retry Strategy Module
 *
 * Implements various retry strategies including exponential backoff with jitter
 * for resilient Kubernetes API operations.
 */

import { Logger } from 'winston';
import { KubernetesError } from './ErrorHandling';

/**
 * Retry configuration options
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Initial delay in milliseconds before first retry */
  initialDelayMs: number;
  /** Maximum delay in milliseconds between retries */
  maxDelayMs: number;
  /** Exponential backoff factor (e.g., 2 for doubling) */
  backoffMultiplier: number;
  /** Jitter factor (0-1) to randomize delays */
  jitterFactor: number;
  /** Timeout for entire retry operation in milliseconds */
  timeoutMs?: number;
  /** Custom function to determine if error is retryable */
  isRetryable?: (error: any) => boolean;
  /** Callback for retry events */
  onRetry?: (attempt: number, error: any, nextDelayMs: number) => void;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
  timeoutMs: 60000,
};

/**
 * Preset configurations for common scenarios
 */
export const RETRY_PRESETS = {
  /** Fast retries for transient network issues */
  FAST: {
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 1000,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
    timeoutMs: 5000,
  },
  /** Standard retries for most operations */
  STANDARD: DEFAULT_RETRY_CONFIG,
  /** Aggressive retries for critical operations */
  AGGRESSIVE: {
    maxAttempts: 5,
    initialDelayMs: 500,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    jitterFactor: 0.2,
    timeoutMs: 300000,
  },
  /** No retries */
  NONE: {
    maxAttempts: 1,
    initialDelayMs: 0,
    maxDelayMs: 0,
    backoffMultiplier: 1,
    jitterFactor: 0,
  },
} as const;

/**
 * Retry context for tracking state
 */
export interface RetryContext {
  attempt: number;
  totalDelay: number;
  startTime: number;
  errors: any[];
}

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
  success: boolean;
  value?: T;
  error?: any;
  attempts: number;
  totalDelayMs: number;
  totalTimeMs: number;
}

/**
 * Retry strategy implementation
 */
export class RetryStrategy {
  private readonly config: RetryConfig;
  private readonly logger?: Logger;

  constructor(config: Partial<RetryConfig> = {}, logger?: Logger) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
    this.logger = logger;
  }

  /**
   * Execute an operation with retry logic
   */
  async execute<T>(operation: () => Promise<T>, operationName?: string): Promise<RetryResult<T>> {
    const context: RetryContext = {
      attempt: 0,
      totalDelay: 0,
      startTime: Date.now(),
      errors: [],
    };

    const timeoutPromise = this.config.timeoutMs
      ? this.createTimeoutPromise(this.config.timeoutMs)
      : null;

    while (context.attempt < this.config.maxAttempts) {
      context.attempt++;

      try {
        // Execute with timeout if configured
        const result = timeoutPromise
          ? await Promise.race([operation(), timeoutPromise])
          : await operation();

        return {
          success: true,
          value: result as T,
          attempts: context.attempt,
          totalDelayMs: context.totalDelay,
          totalTimeMs: Date.now() - context.startTime,
        };
      } catch (error) {
        context.errors.push(error);

        // Check if we should retry
        if (!this.shouldRetry(error, context)) {
          return {
            success: false,
            error,
            attempts: context.attempt,
            totalDelayMs: context.totalDelay,
            totalTimeMs: Date.now() - context.startTime,
          };
        }

        // Calculate delay for next attempt
        const delayMs = this.calculateDelay(context.attempt);
        context.totalDelay += delayMs;

        // Log retry attempt
        this.logger?.warn(
          `Retry attempt ${context.attempt}/${this.config.maxAttempts} for ${operationName || 'operation'}`,
          {
            error: error instanceof Error ? error.message : String(error),
            nextDelayMs: delayMs,
            totalDelayMs: context.totalDelay,
          },
        );

        // Call retry callback if provided
        this.config.onRetry?.(context.attempt, error, delayMs);

        // Wait before next attempt
        await this.delay(delayMs);
      }
    }

    // All attempts exhausted
    const lastError = context.errors[context.errors.length - 1];
    return {
      success: false,
      error: lastError,
      attempts: context.attempt,
      totalDelayMs: context.totalDelay,
      totalTimeMs: Date.now() - context.startTime,
    };
  }

  /**
   * Wrap a function with retry logic
   */
  wrap<T extends (...args: any[]) => Promise<any>>(fn: T, operationName?: string): T {
    return (async (...args: Parameters<T>) => {
      const result = await this.execute(() => fn(...args), operationName);
      if (!result.success) {
        throw result.error;
      }
      return result.value;
    }) as T;
  }

  /**
   * Determine if an error is retryable
   */
  private shouldRetry(error: any, context: RetryContext): boolean {
    // Check if we have attempts remaining
    if (context.attempt >= this.config.maxAttempts) {
      return false;
    }

    // Check timeout
    if (this.config.timeoutMs) {
      const elapsed = Date.now() - context.startTime;
      if (elapsed + this.calculateDelay(context.attempt) > this.config.timeoutMs) {
        return false;
      }
    }

    // Use custom retry logic if provided
    if (this.config.isRetryable) {
      return this.config.isRetryable(error);
    }

    // Default retry logic for Kubernetes errors
    if (error instanceof KubernetesError) {
      return error.retryable;
    }

    // Retry on specific error conditions
    const errorMessage = error?.message?.toLowerCase() || '';
    const retryableConditions = [
      'econnrefused',
      'enotfound',
      'etimedout',
      'econnreset',
      'epipe',
      'network',
      'timeout',
      'socket hang up',
      'service unavailable',
      'bad gateway',
      'gateway timeout',
    ];

    return retryableConditions.some((condition) => errorMessage.includes(condition));
  }

  /**
   * Calculate delay for next retry attempt with exponential backoff and jitter
   */
  private calculateDelay(attempt: number): number {
    // Calculate base delay with exponential backoff
    const baseDelay = Math.min(
      this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, attempt - 1),
      this.config.maxDelayMs,
    );

    // Add jitter to prevent thundering herd
    const jitter = baseDelay * this.config.jitterFactor * (Math.random() * 2 - 1);
    return Math.max(0, Math.floor(baseDelay + jitter));
  }

  /**
   * Delay execution for specified milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a promise that rejects after timeout
   */
  private createTimeoutPromise(timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }
}

/**
 * Retry builder for fluent configuration
 */
export class RetryBuilder {
  private config: Partial<RetryConfig> = {};
  private logger?: Logger;

  withMaxAttempts(attempts: number): this {
    this.config.maxAttempts = attempts;
    return this;
  }

  withInitialDelay(ms: number): this {
    this.config.initialDelayMs = ms;
    return this;
  }

  withMaxDelay(ms: number): this {
    this.config.maxDelayMs = ms;
    return this;
  }

  withBackoffMultiplier(multiplier: number): this {
    this.config.backoffMultiplier = multiplier;
    return this;
  }

  withJitterFactor(factor: number): this {
    this.config.jitterFactor = factor;
    return this;
  }

  withTimeout(ms: number): this {
    this.config.timeoutMs = ms;
    return this;
  }

  withRetryableCheck(fn: (error: any) => boolean): this {
    this.config.isRetryable = fn;
    return this;
  }

  withRetryCallback(fn: (attempt: number, error: any, nextDelayMs: number) => void): this {
    this.config.onRetry = fn;
    return this;
  }

  withLogger(logger: Logger): this {
    this.logger = logger;
    return this;
  }

  withPreset(preset: keyof typeof RETRY_PRESETS): this {
    this.config = { ...RETRY_PRESETS[preset], ...this.config };
    return this;
  }

  build(): RetryStrategy {
    return new RetryStrategy(this.config, this.logger);
  }
}

/**
 * Convenience function to create a retry strategy
 */
export function createRetryStrategy(config?: Partial<RetryConfig>, logger?: Logger): RetryStrategy {
  return new RetryStrategy(config, logger);
}

/**
 * Decorator for adding retry logic to methods
 */
export function Retryable(config: Partial<RetryConfig> = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const strategy = new RetryStrategy(config);

    descriptor.value = async function (...args: any[]) {
      const result = await strategy.execute(
        () => originalMethod.apply(this, args),
        `${target.constructor.name}.${propertyKey}`,
      );

      if (!result.success) {
        throw result.error;
      }

      return result.value;
    };

    return descriptor;
  };
}

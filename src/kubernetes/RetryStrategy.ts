/**
 * Retry strategy for Kubernetes operations
 */

import { Logger } from 'winston';

import { KubernetesError } from './ErrorHandling.js';

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
    // If config is a preset, merge with DEFAULT_RETRY_CONFIG, then user config
    let baseConfig: Partial<RetryConfig> = {};
    if (
      config &&
      (config as any).maxAttempts !== undefined &&
      (config as any).initialDelayMs !== undefined
    ) {
      baseConfig = config;
    }
    // If config is a preset object (from RETRY_PRESETS), merge with default
    this.config = { ...DEFAULT_RETRY_CONFIG, ...baseConfig, ...config };
    this.logger = logger;
  }

  /**
   * Execute an operation with retry logic
   */
  async execute<T>(operation: () => Promise<T>, operationName?: string): Promise<RetryResult<T>> {
    let timeoutId: NodeJS.Timeout | null = null;
    let timeoutPromise: Promise<never> | null = null;
    if (this.config.timeoutMs) {
      timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Operation timed out after ${this.config.timeoutMs}ms`));
        }, this.config.timeoutMs);
      });
    }

    let lastError: any = undefined;
    let totalDelay = 0;
    const startTime = Date.now();
    for (let i = 0; i < this.config.maxAttempts; i++) {
      try {
        const race = timeoutPromise ? Promise.race([operation(), timeoutPromise]) : operation();
        const opResult = await race;
        if (timeoutId) clearTimeout(timeoutId);
        return {
          success: true,
          value: opResult as T,
          attempts: i + 1,
          totalDelayMs: totalDelay,
          totalTimeMs: Date.now() - startTime,
        };
      } catch (error) {
        lastError = error;
        if (
          i < this.config.maxAttempts - 1 &&
          this.shouldRetry(error, { attempt: i, totalDelay, startTime, errors: [] })
        ) {
          const delayMs = this.calculateDelay(i + 1);
          totalDelay += delayMs;
          this.logger?.warn(
            `Retry attempt ${i + 2}/${this.config.maxAttempts} for ${operationName || 'operation'}`,
            {
              error: error instanceof Error ? error.message : String(error),
              nextDelayMs: delayMs,
              totalDelayMs: totalDelay,
            },
          );
          this.config.onRetry?.(i + 1, error, delayMs);
          await this.delay(delayMs);
        } else {
          if (timeoutId) clearTimeout(timeoutId);
          return {
            success: false,
            error,
            attempts: i + 1,
            totalDelayMs: totalDelay,
            totalTimeMs: Date.now() - startTime,
          };
        }
      }
    }
    if (timeoutId) clearTimeout(timeoutId);
    return {
      success: false,
      error: lastError,
      attempts: this.config.maxAttempts,
      totalDelayMs: totalDelay,
      totalTimeMs: Date.now() - startTime,
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
    // In test environments, skip real delays to keep tests fast
    if (
      typeof process !== 'undefined' &&
      (process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test')
    ) {
      return Promise.resolve();
    }
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    // User overrides should take precedence
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

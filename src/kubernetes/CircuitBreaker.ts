/**
 * Circuit Breaker Module
 *
 * Implements the circuit breaker pattern for fault tolerance in distributed systems.
 * Prevents cascading failures by temporarily blocking requests to failing services.
 */

import { Logger } from 'winston';
import { EventEmitter } from 'events';

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation, requests pass through
  OPEN = 'OPEN', // Circuit broken, requests blocked
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Name of the circuit for identification */
  name: string;
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Success threshold to close circuit from half-open */
  successThreshold: number;
  /** Time window for counting failures (ms) */
  failureCountWindow: number;
  /** Time to wait before attempting recovery (ms) */
  resetTimeout: number;
  /** Percentage of requests to fail before opening (0-100) */
  failureRateThreshold?: number;
  /** Minimum number of requests before applying rate threshold */
  volumeThreshold?: number;
  /** Optional timeout for operations (ms) */
  operationTimeout?: number;
  /** Function to determine if an error counts as failure */
  isFailure?: (error: any) => boolean;
  /** Fallback function when circuit is open */
  fallback?: <T>() => T | Promise<T>;
}

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_CONFIG: Omit<CircuitBreakerConfig, 'name'> = {
  failureThreshold: 5,
  successThreshold: 2,
  failureCountWindow: 60000, // 1 minute
  resetTimeout: 30000, // 30 seconds
  failureRateThreshold: 50, // 50%
  volumeThreshold: 10,
  operationTimeout: 10000, // 10 seconds
};

/**
 * Circuit breaker statistics
 */
export interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  totalCalls: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  lastStateChange: Date;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  failureRate: number;
}

/**
 * Request tracking for sliding window
 */
interface RequestRecord {
  timestamp: number;
  success: boolean;
}

/**
 * Circuit breaker implementation
 */
export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.CLOSED;
  private readonly config: CircuitBreakerConfig;
  private readonly logger?: Logger;

  private stats: CircuitStats;
  private resetTimer?: NodeJS.Timeout;
  private readonly requestHistory: RequestRecord[] = [];
  private lastStateChangeTime: Date = new Date();

  constructor(config: CircuitBreakerConfig, logger?: Logger) {
    super();
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
    this.logger = logger;

    this.stats = this.initializeStats();
  }

  /**
   * Execute an operation through the circuit breaker
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      this.logger?.warn(`Circuit breaker '${this.config.name}' is OPEN, rejecting request`);
      this.emit('fallback');

      if (this.config.fallback) {
        return this.config.fallback<T>();
      }

      throw new Error(`Circuit breaker '${this.config.name}' is OPEN`);
    }

    // Record attempt
    this.stats.totalCalls++;

    try {
      // Execute with timeout if configured
      const result = await this.executeWithTimeout(operation);

      // Record success
      this.recordSuccess();
      this.emit('success', result);

      return result;
    } catch (error) {
      // Check if error should be counted as failure
      if (this.shouldCountAsFailure(error)) {
        this.recordFailure();
        this.emit('failure', error);
      }

      throw error;
    }
  }

  /**
   * Get current circuit statistics
   */
  getStats(): CircuitStats {
    return {
      ...this.stats,
      state: this.state,
      failureRate: this.calculateFailureRate(),
    };
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.logger?.info(`Manually resetting circuit breaker '${this.config.name}'`);
    this.transition(CircuitState.CLOSED);
    this.stats = this.initializeStats();
    this.requestHistory.length = 0;
    this.clearResetTimer();
  }

  /**
   * Force open the circuit
   */
  open(): void {
    this.logger?.warn(`Manually opening circuit breaker '${this.config.name}'`);
    this.transition(CircuitState.OPEN);
  }

  /**
   * Initialize statistics
   */
  private initializeStats(): CircuitStats {
    return {
      state: this.state,
      failures: 0,
      successes: 0,
      totalCalls: 0,
      lastStateChange: new Date(),
      consecutiveSuccesses: 0,
      consecutiveFailures: 0,
      failureRate: 0,
    };
  }

  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.config.operationTimeout) {
      return operation();
    }

    return Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          this.emit('timeout');
          reject(new Error(`Operation timed out after ${this.config.operationTimeout}ms`));
        }, this.config.operationTimeout);
      }),
    ]);
  }

  /**
   * Record successful operation
   */
  private recordSuccess(): void {
    this.stats.successes++;
    this.stats.consecutiveSuccesses++;
    this.stats.consecutiveFailures = 0;
    this.stats.lastSuccessTime = new Date();

    // Add to history
    this.addToHistory(true);

    // Handle state transitions
    if (this.state === CircuitState.HALF_OPEN) {
      if (this.stats.consecutiveSuccesses >= this.config.successThreshold) {
        this.logger?.info(
          `Circuit breaker '${this.config.name}' closing after ${this.stats.consecutiveSuccesses} successful attempts`,
        );
        this.transition(CircuitState.CLOSED);
      }
    }
  }

  /**
   * Record failed operation
   */
  private recordFailure(): void {
    this.stats.failures++;
    this.stats.consecutiveFailures++;
    this.stats.consecutiveSuccesses = 0;
    this.stats.lastFailureTime = new Date();

    // Add to history
    this.addToHistory(false);

    // Check if we should open the circuit
    if (this.state === CircuitState.CLOSED || this.state === CircuitState.HALF_OPEN) {
      if (this.shouldOpenCircuit()) {
        this.logger?.warn(
          `Circuit breaker '${this.config.name}' opening after ${this.stats.consecutiveFailures} failures`,
        );
        this.transition(CircuitState.OPEN);
        this.scheduleReset();
      }
    }
  }

  /**
   * Check if circuit should open based on failure conditions
   */
  private shouldOpenCircuit(): boolean {
    // Check consecutive failure threshold
    if (this.stats.consecutiveFailures >= this.config.failureThreshold) {
      return true;
    }

    // Check failure rate if configured
    if (this.config.failureRateThreshold && this.config.volumeThreshold) {
      const recentRequests = this.getRecentRequests();

      if (recentRequests.length >= this.config.volumeThreshold) {
        const failureRate = this.calculateFailureRate();
        if (failureRate >= this.config.failureRateThreshold) {
          this.logger?.warn(
            `Circuit breaker '${this.config.name}' failure rate ${failureRate.toFixed(1)}% exceeds threshold`,
          );
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Add request to history
   */
  private addToHistory(success: boolean): void {
    const now = Date.now();
    this.requestHistory.push({ timestamp: now, success });

    // Clean old entries
    const cutoff = now - this.config.failureCountWindow;
    while (this.requestHistory.length > 0 && this.requestHistory[0].timestamp < cutoff) {
      this.requestHistory.shift();
    }
  }

  /**
   * Get recent requests within the time window
   */
  private getRecentRequests(): RequestRecord[] {
    const cutoff = Date.now() - this.config.failureCountWindow;
    return this.requestHistory.filter((r) => r.timestamp >= cutoff);
  }

  /**
   * Calculate current failure rate
   */
  private calculateFailureRate(): number {
    const recent = this.getRecentRequests();
    if (recent.length === 0) return 0;

    const failures = recent.filter((r) => !r.success).length;
    return (failures / recent.length) * 100;
  }

  /**
   * Determine if error should count as failure
   */
  private shouldCountAsFailure(error: any): boolean {
    if (this.config.isFailure) {
      return this.config.isFailure(error);
    }

    // Default: all errors count as failures
    return true;
  }

  /**
   * Transition to new state
   */
  private transition(newState: CircuitState): void {
    const oldState = this.state;

    if (oldState === newState) return;

    this.state = newState;
    this.lastStateChangeTime = new Date();
    this.stats.lastStateChange = this.lastStateChangeTime;

    // Reset consecutive counters on state change
    if (newState === CircuitState.CLOSED) {
      this.stats.consecutiveFailures = 0;
      this.emit('circuit-close', this.getStats());
    } else if (newState === CircuitState.OPEN) {
      this.stats.consecutiveSuccesses = 0;
      this.emit('circuit-open', this.getStats());
    } else if (newState === CircuitState.HALF_OPEN) {
      this.stats.consecutiveSuccesses = 0;
      this.stats.consecutiveFailures = 0;
      this.emit('circuit-half-open');
    }

    this.emit('state-change', oldState, newState);

    this.logger?.info(
      `Circuit breaker '${this.config.name}' state changed: ${oldState} -> ${newState}`,
    );
  }

  /**
   * Schedule circuit reset attempt
   */
  private scheduleReset(): void {
    this.clearResetTimer();

    this.resetTimer = setTimeout(() => {
      this.logger?.info(`Circuit breaker '${this.config.name}' attempting reset to HALF_OPEN`);
      this.transition(CircuitState.HALF_OPEN);
    }, this.config.resetTimeout);
  }

  /**
   * Clear reset timer
   */
  private clearResetTimer(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.clearResetTimer();
    this.removeAllListeners();
  }
}

/**
 * Circuit breaker factory for managing multiple circuits
 */
export class CircuitBreakerFactory {
  private readonly circuits = new Map<string, CircuitBreaker>();
  private readonly logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  /**
   * Get or create a circuit breaker
   */
  getOrCreate(config: CircuitBreakerConfig): CircuitBreaker {
    let circuit = this.circuits.get(config.name);

    if (!circuit) {
      circuit = new CircuitBreaker(config, this.logger);
      this.circuits.set(config.name, circuit);
      this.logger?.debug(`Created new circuit breaker: ${config.name}`);
    }

    return circuit;
  }

  /**
   * Get existing circuit breaker
   */
  get(name: string): CircuitBreaker | undefined {
    return this.circuits.get(name);
  }

  /**
   * Get all circuit breakers
   */
  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.circuits);
  }

  /**
   * Get statistics for all circuits
   */
  getAllStats(): Record<string, CircuitStats> {
    const stats: Record<string, CircuitStats> = {};

    for (const [name, circuit] of this.circuits) {
      stats[name] = circuit.getStats();
    }

    return stats;
  }

  /**
   * Reset all circuits
   */
  resetAll(): void {
    for (const circuit of this.circuits.values()) {
      circuit.reset();
    }
  }

  /**
   * Dispose all circuits
   */
  dispose(): void {
    for (const circuit of this.circuits.values()) {
      circuit.dispose();
    }
    this.circuits.clear();
  }
}

/**
 * Decorator for adding circuit breaker to methods
 */
export function WithCircuitBreaker(config: Omit<CircuitBreakerConfig, 'name'>) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const circuitName = `${target.constructor.name}.${propertyKey}`;
    const circuit = new CircuitBreaker({ ...config, name: circuitName });

    descriptor.value = async function (...args: any[]) {
      return circuit.execute(() => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}

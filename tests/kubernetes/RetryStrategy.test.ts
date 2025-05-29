import {
  RetryStrategy,
  RetryBuilder,
  RETRY_PRESETS,
  Retryable,
} from '../../src/kubernetes/RetryStrategy';
import { KubernetesError, NetworkError, TimeoutError } from '../../src/kubernetes/ErrorHandling';

describe('RetryStrategy', () => {
  describe('Basic Retry Operations', () => {
    it('should succeed on first attempt', async () => {
      const strategy = new RetryStrategy({ maxAttempts: 3 });
      let attempts = 0;

      const result = await strategy.execute(async () => {
        attempts++;
        return 'success';
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');
      expect(result.attempts).toBe(1);
      expect(attempts).toBe(1);
    });

    it('should retry on failure and succeed', async () => {
      const strategy = new RetryStrategy({
        maxAttempts: 3,
        initialDelayMs: 10,
        jitterFactor: 0,
      });
      let attempts = 0;

      const result = await strategy.execute(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return 'success';
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');
      expect(result.attempts).toBe(3);
      expect(attempts).toBe(3);
    });

    it('should fail after max attempts', async () => {
      const strategy = new RetryStrategy({
        maxAttempts: 3,
        initialDelayMs: 10,
        jitterFactor: 0,
      });
      let attempts = 0;

      const result = await strategy.execute(async () => {
        attempts++;
        throw new Error(`Failure ${attempts}`);
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('Failure 3');
      expect(result.attempts).toBe(3);
      expect(attempts).toBe(3);
    });

    it('should not retry non-retryable errors', async () => {
      const strategy = new RetryStrategy({
        maxAttempts: 3,
        initialDelayMs: 10,
      });
      let attempts = 0;

      const result = await strategy.execute(async () => {
        attempts++;
        throw new KubernetesError('Auth failed', 'AUTH_ERROR', 401, false);
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(attempts).toBe(1);
    });

    it('should retry retryable Kubernetes errors', async () => {
      const strategy = new RetryStrategy({
        maxAttempts: 3,
        initialDelayMs: 10,
        jitterFactor: 0,
      });
      let attempts = 0;

      const result = await strategy.execute(async () => {
        attempts++;
        if (attempts < 2) {
          throw new NetworkError('Network issue');
        }
        return 'recovered';
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe('recovered');
      expect(result.attempts).toBe(2);
    });
  });

  describe('Exponential Backoff', () => {
    it('should apply exponential backoff', async () => {
      const delays: number[] = [];
      const strategy = new RetryStrategy({
        maxAttempts: 4,
        initialDelayMs: 100,
        backoffMultiplier: 2,
        jitterFactor: 0,
        onRetry: (_attempt, _error, nextDelay) => {
          delays.push(nextDelay);
        },
      });

      await strategy.execute(async () => {
        throw new Error('Always fails');
      });

      expect(delays).toHaveLength(3); // 3 retries after initial attempt
      expect(delays[0]).toBe(100); // 100ms
      expect(delays[1]).toBe(200); // 100 * 2
      expect(delays[2]).toBe(400); // 100 * 2^2
    });

    it('should respect maxDelayMs', async () => {
      const delays: number[] = [];
      const strategy = new RetryStrategy({
        maxAttempts: 5,
        initialDelayMs: 100,
        maxDelayMs: 300,
        backoffMultiplier: 2,
        jitterFactor: 0,
        onRetry: (_attempt, _error, nextDelay) => {
          delays.push(nextDelay);
        },
      });

      await strategy.execute(async () => {
        throw new Error('Always fails');
      });

      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(200);
      expect(delays[2]).toBe(300); // Capped at maxDelayMs
      expect(delays[3]).toBe(300); // Still capped
    });

    it('should apply jitter', async () => {
      const delays: number[] = [];
      const strategy = new RetryStrategy({
        maxAttempts: 3,
        initialDelayMs: 1000,
        jitterFactor: 0.5,
        onRetry: (_attempt, _error, nextDelay) => {
          delays.push(nextDelay);
        },
      });

      await strategy.execute(async () => {
        throw new Error('Always fails');
      });

      // With 0.5 jitter factor, delay should be between 500ms and 1500ms
      expect(delays[0]).toBeGreaterThanOrEqual(500);
      expect(delays[0]).toBeLessThanOrEqual(1500);
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout long-running operations', async () => {
      const strategy = new RetryStrategy({
        maxAttempts: 1,
        timeoutMs: 100,
      });

      const result = await strategy.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'should not reach';
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toContain('timeout');
    });

    it('should stop retrying when total timeout exceeded', async () => {
      let attempts = 0;
      const strategy = new RetryStrategy({
        maxAttempts: 10,
        initialDelayMs: 100,
        timeoutMs: 250, // Total timeout
        jitterFactor: 0,
      });

      const result = await strategy.execute(async () => {
        attempts++;
        throw new Error('Retry me');
      });

      expect(result.success).toBe(false);
      expect(attempts).toBeLessThan(10); // Should stop before max attempts
      expect(result.totalTimeMs).toBeLessThanOrEqual(300); // Some buffer for execution
    });
  });

  describe('Custom Retry Logic', () => {
    it('should use custom isRetryable function', async () => {
      let attempts = 0;
      const strategy = new RetryStrategy({
        maxAttempts: 3,
        initialDelayMs: 10,
        isRetryable: (error) => {
          return error.message.includes('retry');
        },
      });

      // Should retry
      const result1 = await strategy.execute(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Please retry this');
        }
        return 'success';
      });

      expect(result1.success).toBe(true);
      expect(attempts).toBe(2);

      // Should not retry
      attempts = 0;
      const result2 = await strategy.execute(async () => {
        attempts++;
        throw new Error('Do not attempt again');
      });

      expect(result2.success).toBe(false);
      expect(attempts).toBe(1);
    });

    it('should call onRetry callback', async () => {
      const retryEvents: Array<{
        attempt: number;
        error: string;
        nextDelay: number;
      }> = [];

      const strategy = new RetryStrategy({
        maxAttempts: 3,
        initialDelayMs: 10,
        jitterFactor: 0,
        onRetry: (_attempt, _error, nextDelay) => {
          retryEvents.push({
            attempt: _attempt,
            error: _error.message,
            nextDelay,
          });
        },
      });

      await strategy.execute(async () => {
        throw new Error('Failure');
      });

      expect(retryEvents).toHaveLength(2); // 2 retries after initial
      expect(retryEvents[0].attempt).toBe(1);
      expect(retryEvents[0].error).toBe('Failure');
      expect(retryEvents[1].attempt).toBe(2);
    });
  });

  describe('Retry Presets', () => {
    it('should use FAST preset', async () => {
      const strategy = new RetryStrategy(RETRY_PRESETS.FAST);
      const start = Date.now();

      await strategy.execute(async () => {
        throw new Error('Fast fail');
      });

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(2000); // Fast preset should complete quickly
    });

    it('should use AGGRESSIVE preset', async () => {
      const strategy = new RetryStrategy(RETRY_PRESETS.AGGRESSIVE);
      let attempts = 0;

      await strategy.execute(async () => {
        attempts++;
        throw new Error('Need many retries');
      });

      expect(attempts).toBe(5); // Aggressive preset has 5 max attempts
    });

    it('should use NONE preset', async () => {
      const strategy = new RetryStrategy(RETRY_PRESETS.NONE);
      let attempts = 0;

      const result = await strategy.execute(async () => {
        attempts++;
        throw new Error('No retry');
      });

      expect(result.success).toBe(false);
      expect(attempts).toBe(1); // No retries
    });
  });

  describe('RetryBuilder', () => {
    it('should build retry strategy with fluent API', async () => {
      const strategy = new RetryBuilder()
        .withMaxAttempts(2)
        .withInitialDelay(50)
        .withMaxDelay(100)
        .withBackoffMultiplier(2)
        .withJitterFactor(0)
        .withTimeout(1000)
        .build();

      let attempts = 0;
      const result = await strategy.execute(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Retry once');
        }
        return 'built';
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe('built');
      expect(attempts).toBe(2);
    });

    it('should build with preset', async () => {
      const strategy = new RetryBuilder()
        .withPreset('FAST')
        .withMaxAttempts(2) // Override preset
        .build();

      let attempts = 0;
      await strategy.execute(async () => {
        attempts++;
        throw new Error('Fail');
      });

      expect(attempts).toBe(2); // Our override
    });
  });

  describe('Wrap Function', () => {
    it('should wrap function with retry logic', async () => {
      const strategy = new RetryStrategy({
        maxAttempts: 3,
        initialDelayMs: 10,
      });

      let attempts = 0;
      const unreliableFunction = async (value: string) => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Temporary issue');
        }
        return `Processed: ${value}`;
      };

      const reliableFunction = strategy.wrap(unreliableFunction);
      const result = await reliableFunction('test');

      expect(result).toBe('Processed: test');
      expect(attempts).toBe(2);
    });

    it('should throw on wrapped function failure', async () => {
      const strategy = new RetryStrategy({
        maxAttempts: 2,
        initialDelayMs: 10,
      });

      const alwaysFails = async () => {
        throw new Error('Permanent failure');
      };

      const wrapped = strategy.wrap(alwaysFails);

      await expect(wrapped()).rejects.toThrow('Permanent failure');
    });
  });

  describe('Retryable Decorator', () => {
    it('should make method retryable', async () => {
      class TestService {
        attempts = 0;

        @Retryable({
          maxAttempts: 3,
          initialDelayMs: 10,
          jitterFactor: 0,
        })
        async unreliableMethod(): Promise<string> {
          this.attempts++;
          if (this.attempts < 2) {
            throw new TimeoutError('Timeout');
          }
          return 'success';
        }

        @Retryable(RETRY_PRESETS.NONE)
        async noRetryMethod(): Promise<string> {
          this.attempts++;
          throw new Error('Should not retry');
        }
      }

      const service = new TestService();

      // Test retryable method
      const result = await service.unreliableMethod();
      expect(result).toBe('success');
      expect(service.attempts).toBe(2);

      // Test no-retry method
      service.attempts = 0;
      await expect(service.noRetryMethod()).rejects.toThrow('Should not retry');
      expect(service.attempts).toBe(1);
    });
  });

  describe('Error Type Detection', () => {
    it('should retry on network-related error messages', async () => {
      const networkErrors = [
        'ECONNREFUSED: Connection refused',
        'ENOTFOUND: DNS lookup failed',
        'ETIMEDOUT: Request timed out',
        'ECONNRESET: Connection reset',
        'EPIPE: Broken pipe',
        'Network error occurred',
        'Request timeout',
        'socket hang up',
        'Service Unavailable',
        'Bad Gateway',
        'Gateway Timeout',
      ];

      for (const errorMessage of networkErrors) {
        const strategy = new RetryStrategy({
          maxAttempts: 2,
          initialDelayMs: 1,
        });

        let attempts = 0;
        const result = await strategy.execute(async () => {
          attempts++;
          if (attempts < 2) {
            throw new Error(errorMessage);
          }
          return 'recovered';
        });

        expect(result.success).toBe(true);
        expect(attempts).toBe(2);
      }
    });
  });
});

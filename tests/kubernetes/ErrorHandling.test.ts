import {
  KubernetesError,
  AuthenticationError,
  AuthorizationError,
  ResourceNotFoundError,
  ResourceConflictError,
  ValidationError,
  ServerUnavailableError,
  TimeoutError,
  RateLimitError,
  NetworkError,
  ErrorMonitor,
  convertApiError,
  createContextualError,
} from '../../src/kubernetes/ErrorHandling';

describe('Error Handling', () => {
  describe('KubernetesError', () => {
    it('should create a base error with all properties', () => {
      const error = new KubernetesError('Test error', 'TEST_ERROR', 500, true, { foo: 'bar' });

      expect(error.message).toBe('Test error');
      expect(error.name).toBe('KubernetesError');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.retryable).toBe(true);
      expect(error.details).toEqual({ foo: 'bar' });
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should be instanceof Error', () => {
      const error = new KubernetesError('Test', 'TEST');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(KubernetesError);
    });
  });

  describe('Error Subtypes', () => {
    it('should create AuthenticationError', () => {
      const error = new AuthenticationError('Unauthorized');
      expect(error).toBeInstanceOf(KubernetesError);
      expect(error.name).toBe('AuthenticationError');
      expect(error.code).toBe('AUTHENTICATION_ERROR');
      expect(error.statusCode).toBe(401);
      expect(error.retryable).toBe(false);
    });

    it('should create AuthorizationError', () => {
      const error = new AuthorizationError('Forbidden');
      expect(error).toBeInstanceOf(KubernetesError);
      expect(error.name).toBe('AuthorizationError');
      expect(error.code).toBe('AUTHORIZATION_ERROR');
      expect(error.statusCode).toBe(403);
      expect(error.retryable).toBe(false);
    });

    it('should create ResourceNotFoundError', () => {
      const error = new ResourceNotFoundError('Not found');
      expect(error).toBeInstanceOf(KubernetesError);
      expect(error.name).toBe('ResourceNotFoundError');
      expect(error.code).toBe('RESOURCE_NOT_FOUND');
      expect(error.statusCode).toBe(404);
      expect(error.retryable).toBe(false);
    });

    it('should create ResourceConflictError', () => {
      const error = new ResourceConflictError('Already exists');
      expect(error).toBeInstanceOf(KubernetesError);
      expect(error.name).toBe('ResourceConflictError');
      expect(error.code).toBe('RESOURCE_CONFLICT');
      expect(error.statusCode).toBe(409);
      expect(error.retryable).toBe(false);
    });

    it('should create ValidationError', () => {
      const error = new ValidationError('Invalid input');
      expect(error).toBeInstanceOf(KubernetesError);
      expect(error.name).toBe('ValidationError');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.retryable).toBe(false);
    });

    it('should create ServerUnavailableError', () => {
      const error = new ServerUnavailableError('Service unavailable');
      expect(error).toBeInstanceOf(KubernetesError);
      expect(error.name).toBe('ServerUnavailableError');
      expect(error.code).toBe('SERVER_UNAVAILABLE');
      expect(error.statusCode).toBe(503);
      expect(error.retryable).toBe(true);
    });

    it('should create TimeoutError', () => {
      const error = new TimeoutError('Request timeout');
      expect(error).toBeInstanceOf(KubernetesError);
      expect(error.name).toBe('TimeoutError');
      expect(error.code).toBe('TIMEOUT_ERROR');
      expect(error.statusCode).toBe(408);
      expect(error.retryable).toBe(true);
    });

    it('should create RateLimitError', () => {
      const error = new RateLimitError('Too many requests', 60);
      expect(error).toBeInstanceOf(KubernetesError);
      expect(error.name).toBe('RateLimitError');
      expect(error.code).toBe('RATE_LIMIT_ERROR');
      expect(error.statusCode).toBe(429);
      expect(error.retryable).toBe(true);
      expect(error.details?.retryAfter).toBe(60);
    });

    it('should create NetworkError', () => {
      const error = new NetworkError('Connection refused');
      expect(error).toBeInstanceOf(KubernetesError);
      expect(error.name).toBe('NetworkError');
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.statusCode).toBeUndefined();
      expect(error.retryable).toBe(true);
    });
  });

  describe('convertApiError', () => {
    it('should convert 401 response to AuthenticationError', () => {
      const apiError = {
        response: {
          statusCode: 401,
          body: {
            message: 'Unauthorized',
            reason: 'Unauthorized',
            code: 401,
          },
        },
      };

      const error = convertApiError(apiError);
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.message).toBe('Unauthorized');
    });

    it('should convert 403 response to AuthorizationError', () => {
      const apiError = {
        response: {
          statusCode: 403,
          body: {
            message: 'Forbidden',
            reason: 'Forbidden',
            code: 403,
          },
        },
      };

      const error = convertApiError(apiError);
      expect(error).toBeInstanceOf(AuthorizationError);
      expect(error.message).toBe('Forbidden');
    });

    it('should convert 404 response to ResourceNotFoundError', () => {
      const apiError = {
        response: {
          statusCode: 404,
          body: {
            message: 'Pod not found',
            kind: 'Status',
            apiVersion: 'v1',
            reason: 'NotFound',
          },
        },
      };

      const error = convertApiError(apiError);
      expect(error).toBeInstanceOf(ResourceNotFoundError);
      expect(error.message).toBe('Pod not found');
      expect(error.details?.kind).toBe('Status');
    });

    it('should convert 409 response to ResourceConflictError', () => {
      const apiError = {
        response: {
          statusCode: 409,
          body: {
            message: 'Resource already exists',
            reason: 'AlreadyExists',
          },
        },
      };

      const error = convertApiError(apiError);
      expect(error).toBeInstanceOf(ResourceConflictError);
    });

    it('should convert 429 response to RateLimitError with retry-after', () => {
      const apiError = {
        response: {
          statusCode: 429,
          body: {
            message: 'Too many requests',
          },
          headers: {
            'retry-after': '120',
          },
        },
      };

      const error = convertApiError(apiError);
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.details?.retryAfter).toBe(120);
    });

    it('should convert 5xx responses to ServerUnavailableError', () => {
      const statuses = [500, 502, 503, 504];

      statuses.forEach((status) => {
        const apiError = {
          response: {
            statusCode: status,
            body: {
              message: 'Server error',
            },
          },
        };

        const error = convertApiError(apiError);
        expect(error).toBeInstanceOf(ServerUnavailableError);
        expect(error.retryable).toBe(true);
      });
    });

    it('should convert network errors to NetworkError', () => {
      const networkErrors = [
        { code: 'ECONNREFUSED', message: 'Connection refused' },
        { code: 'ENOTFOUND', message: 'DNS not found' },
        { code: 'ETIMEDOUT', message: 'Connection timeout' },
      ];

      networkErrors.forEach((netError) => {
        const error = convertApiError(netError);
        expect(error).toBeInstanceOf(NetworkError);
        expect(error.retryable).toBe(true);
        expect(error.details?.code).toBe(netError.code);
      });
    });

    it('should convert timeout messages to TimeoutError', () => {
      const error = convertApiError({ message: 'Operation timeout exceeded' });
      expect(error).toBeInstanceOf(TimeoutError);
    });

    it('should convert unknown errors to base KubernetesError', () => {
      const error = convertApiError({ foo: 'bar' });
      expect(error).toBeInstanceOf(KubernetesError);
      expect(error.code).toBe('UNKNOWN_ERROR');
      expect(error.retryable).toBe(false);
    });
  });

  describe('ErrorMonitor', () => {
    let monitor: ErrorMonitor;

    beforeEach(() => {
      monitor = new ErrorMonitor();
    });

    it('should track error statistics', () => {
      const error1 = new AuthenticationError('Unauthorized');
      const error2 = new ServerUnavailableError('Server down');
      const error3 = new ServerUnavailableError('Server down again');

      monitor.recordError(error1, 'getPod');
      monitor.recordError(error2, 'listPods');
      monitor.recordError(error3, 'createPod');

      const stats = monitor.getStats();
      expect(stats.total).toBe(3);
      expect(stats.byType['AuthenticationError']).toBe(1);
      expect(stats.byType['ServerUnavailableError']).toBe(2);
      expect(stats.byStatusCode[401]).toBe(1);
      expect(stats.byStatusCode[503]).toBe(2);
      expect(stats.retryable).toBe(2);
      expect(stats.nonRetryable).toBe(1);
      expect(stats.lastError).toBeDefined();
      expect(stats.lastError?.message).toBe('Server down again');
    });

    it('should get recent errors', () => {
      const errors = [
        new AuthenticationError('Error 1'),
        new ValidationError('Error 2'),
        new NetworkError('Error 3'),
      ];

      errors.forEach((error, index) => {
        monitor.recordError(error, `operation${index}`);
      });

      const recent = monitor.getRecentErrors(2);
      expect(recent).toHaveLength(2);
      expect(recent[0].error.message).toBe('Error 2');
      expect(recent[1].error.message).toBe('Error 3');
    });

    it('should calculate error rate', async () => {
      // Record some errors
      monitor.recordError(new NetworkError('Error 1'), 'op1');
      monitor.recordError(new NetworkError('Error 2'), 'op2');

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check rate for last 1 second
      const rate = monitor.getErrorRate(1000);
      expect(rate).toBe(2);

      // Check rate for last 50ms (should be 0 after waiting)
      const recentRate = monitor.getErrorRate(50);
      expect(recentRate).toBe(0);
    });

    it('should detect trending errors', () => {
      // Record multiple errors of same type
      for (let i = 0; i < 5; i++) {
        monitor.recordError(new TimeoutError(`Timeout ${i}`), `op${i}`);
      }

      expect(monitor.isErrorTrending('TimeoutError', 5)).toBe(true);
      expect(monitor.isErrorTrending('TimeoutError', 10)).toBe(false);
      expect(monitor.isErrorTrending('NetworkError', 1)).toBe(false);
    });

    it('should clear statistics', () => {
      monitor.recordError(new ValidationError('Test'), 'test');
      monitor.clearStats();

      const stats = monitor.getStats();
      expect(stats.total).toBe(0);
      expect(stats.byType).toEqual({});
      expect(stats.byStatusCode).toEqual({});
      expect(monitor.getRecentErrors()).toHaveLength(0);
    });

    it('should limit error log size', () => {
      // Record more than maxLogSize errors (1000)
      for (let i = 0; i < 1100; i++) {
        monitor.recordError(new NetworkError(`Error ${i}`), `op${i}`);
      }

      // Should only keep last 1000
      const recent = monitor.getRecentErrors(2000);
      expect(recent.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('createContextualError', () => {
    it('should add context to error', () => {
      const baseError = new ValidationError('Invalid resource');
      const context = {
        operation: 'createPod',
        resource: {
          kind: 'Pod',
          name: 'my-pod',
          namespace: 'default',
        },
        cluster: 'production',
        user: 'admin',
      };

      const contextualError = createContextualError(baseError, context);
      expect(contextualError).toBeInstanceOf(ValidationError);
      expect(contextualError.message).toBe('Invalid resource');
      expect(contextualError.details?.context).toEqual(context);
    });

    it('should preserve original error details', () => {
      const baseError = new RateLimitError('Too many requests', 60, {
        originalDetail: 'test',
      });
      const context = {
        operation: 'listPods',
      };

      const contextualError = createContextualError(baseError, context);
      expect(contextualError.details?.retryAfter).toBe(60);
      expect(contextualError.details?.originalDetail).toBe('test');
      expect(contextualError.details?.context).toEqual(context);
    });
  });
});

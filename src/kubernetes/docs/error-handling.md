# Kubernetes Client Error Handling

This document describes the comprehensive error handling system implemented for the Kubernetes client module.

## Overview

The error handling system provides:
- **Typed error hierarchy** for different Kubernetes API errors
- **Retry logic** with exponential backoff and jitter
- **Circuit breaker pattern** for fault tolerance
- **Error monitoring** and statistics tracking
- **Composable error handlers** for custom error handling strategies
- **Recovery mechanisms** for graceful degradation

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Kubernetes Operation                      │
└─────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────┐
│                   RetryableOperation                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  Circuit Breaker                      │   │
│  │  ┌─────────────────────────────────────────────┐    │   │
│  │  │              Retry Strategy                  │    │   │
│  │  │  ┌─────────────────────────────────────┐   │    │   │
│  │  │  │         Actual Operation            │   │    │   │
│  │  │  └─────────────────────────────────────┘   │    │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────┐
│                     Error Handler Chain                      │
│  • Logging Handler                                          │
│  • Context Enrichment Handler                               │
│  • Rate Limit Handler                                       │
│  • Custom Handlers...                                       │
└─────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────┐
│                      Error Monitor                           │
│  • Statistics Tracking                                      │
│  • Error Rate Calculation                                   │
│  • Trend Detection                                          │
└─────────────────────────────────────────────────────────────┘
```

## Error Types

### Base Error Class

```typescript
export class KubernetesError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly details?: Record<string, any>;
  public readonly retryable: boolean;
  public readonly timestamp: Date;
}
```

### Error Hierarchy

| Error Type | Status Code | Retryable | Description |
|------------|-------------|-----------|-------------|
| `AuthenticationError` | 401 | No | Authentication failed |
| `AuthorizationError` | 403 | No | Authorization denied |
| `ResourceNotFoundError` | 404 | No | Resource does not exist |
| `ResourceConflictError` | 409 | No | Resource already exists |
| `ValidationError` | 400/422 | No | Request validation failed |
| `ServerUnavailableError` | 503 | Yes | Server temporarily unavailable |
| `TimeoutError` | 408 | Yes | Request timed out |
| `RateLimitError` | 429 | Yes | Rate limit exceeded |
| `NetworkError` | - | Yes | Network connection issues |

## Retry Strategy

### Configuration

```typescript
interface RetryConfig {
  maxAttempts: number;           // Maximum retry attempts
  initialDelayMs: number;        // Initial delay before first retry
  maxDelayMs: number;            // Maximum delay between retries
  backoffMultiplier: number;     // Exponential backoff factor
  jitterFactor: number;          // Jitter factor (0-1)
  timeoutMs?: number;            // Total operation timeout
  isRetryable?: (error) => boolean;  // Custom retry logic
  onRetry?: (attempt, error, delay) => void;  // Retry callback
}
```

### Presets

- **FAST**: Quick retries for transient issues (100ms initial, max 3 attempts)
- **STANDARD**: Default balanced configuration (1s initial, max 3 attempts)
- **AGGRESSIVE**: Persistent retries for critical operations (500ms initial, max 5 attempts)
- **NONE**: No retries

### Usage Examples

```typescript
// Using presets
const strategy = new RetryStrategy(RETRY_PRESETS.STANDARD);

// Custom configuration
const strategy = new RetryStrategy({
  maxAttempts: 5,
  initialDelayMs: 500,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1
});

// Execute with retry
const result = await strategy.execute(async () => {
  return await k8sApi.getPod('my-pod');
});

// Using decorator
class PodService {
  @Retryable(RETRY_PRESETS.STANDARD)
  async getPod(name: string) {
    return await this.api.getPod(name);
  }
}
```

## Circuit Breaker

### Configuration

```typescript
interface CircuitBreakerConfig {
  name: string;                  // Circuit identifier
  failureThreshold: number;      // Failures before opening
  successThreshold: number;      // Successes to close from half-open
  failureCountWindow: number;    // Time window for counting (ms)
  resetTimeout: number;          // Time before attempting reset (ms)
  failureRateThreshold?: number; // Failure rate threshold (0-100)
  volumeThreshold?: number;      // Minimum requests for rate calculation
  operationTimeout?: number;     // Operation timeout (ms)
}
```

### States

1. **CLOSED**: Normal operation, requests pass through
2. **OPEN**: Circuit broken, requests blocked
3. **HALF_OPEN**: Testing if service recovered

### Usage Examples

```typescript
// Create circuit breaker
const circuit = new CircuitBreaker({
  name: 'pod-operations',
  failureThreshold: 5,
  successThreshold: 2,
  resetTimeout: 30000
});

// Execute through circuit
try {
  const result = await circuit.execute(async () => {
    return await k8sApi.getPod('my-pod');
  });
} catch (error) {
  if (error.message.includes('OPEN')) {
    // Circuit is open, use fallback
    return getCachedPod('my-pod');
  }
  throw error;
}

// Using decorator
class PodService {
  @WithCircuitBreaker({
    failureThreshold: 5,
    resetTimeout: 30000
  })
  async getPod(name: string) {
    return await this.api.getPod(name);
  }
}
```

## Error Monitoring

### Features

- Track error counts by type and status code
- Calculate error rates over time windows
- Detect trending error patterns
- Maintain error history log

### Usage Examples

```typescript
// Create error monitor
const monitor = new ErrorMonitor(logger);

// Record errors
monitor.recordError(error, 'getPod');

// Get statistics
const stats = monitor.getStats();
console.log(`Total errors: ${stats.total}`);
console.log(`Retryable errors: ${stats.retryable}`);
console.log(`Error types: ${JSON.stringify(stats.byType)}`);

// Check error rate
const errorRate = monitor.getErrorRate(60000); // Last minute
if (errorRate > 10) {
  console.warn('High error rate detected');
}

// Check if specific error is trending
if (monitor.isErrorTrending('TimeoutError', 5, 60000)) {
  console.warn('Multiple timeouts detected');
}
```

## Error Handlers

### Built-in Handlers

1. **LoggingErrorHandler**: Logs errors with configurable levels
2. **ContextEnrichmentHandler**: Adds contextual information to errors
3. **RateLimitHandler**: Handles rate limiting with automatic backoff
4. **RetryErrorHandler**: Provides retry capabilities
5. **CircuitBreakerErrorHandler**: Manages circuit breakers

### Creating Custom Handlers

```typescript
class CustomErrorHandler implements IErrorHandler {
  async handle(error: any, context?: ErrorContext): Promise<boolean> {
    if (error instanceof SpecificError) {
      // Handle specific error
      await this.notifyOpsTeam(error);
      return true; // Stop propagation
    }
    return false; // Continue to next handler
  }

  transform(error: any, context?: ErrorContext): any {
    // Transform or enrich error
    return new EnrichedError(error, context);
  }

  canHandle(error: any): boolean {
    return error instanceof SpecificError;
  }
}
```

### Error Handler Chain

```typescript
// Create handler chain
const errorChain = new ErrorHandlerChain({
  handlers: [
    new LoggingErrorHandler(logger),
    new ContextEnrichmentHandler(),
    new RateLimitHandler(logger),
    new CustomErrorHandler()
  ],
  stopOnFirstHandled: false
});

// Handle error
await errorChain.handle(error, {
  operation: 'getPod',
  resource: { kind: 'Pod', name: 'my-pod' }
});
```

## Recovery Strategies

### Fallback Recovery

```typescript
const fallbackRecovery = new FallbackRecovery(
  () => getDefaultPod(), // Fallback function
  (error) => error instanceof ResourceNotFoundError // Condition
);

try {
  pod = await k8sApi.getPod('my-pod');
} catch (error) {
  pod = await fallbackRecovery.recover(error);
}
```

### Cache Recovery

```typescript
const cacheRecovery = new CacheRecovery(
  (context) => `pod:${context.resource.name}`, // Cache key
  300000 // 5 minute TTL
);

// Store in cache on success
const pod = await k8sApi.getPod('my-pod');
cacheRecovery.store(pod, { resource: { name: 'my-pod' } });

// Recover from cache on failure
try {
  pod = await k8sApi.getPod('my-pod');
} catch (error) {
  pod = await cacheRecovery.recover(error, {
    resource: { name: 'my-pod' }
  });
}
```

## Integration with Resource Operations

### RetryableOperation

The `RetryableOperation` class combines retry logic and circuit breaker:

```typescript
// Create retryable operation
const operation = new RetryableOperation('pod.get', {
  retry: RETRY_PRESETS.STANDARD,
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 30000
  },
  errorMonitor: monitor
});

// Execute operation
const result = await operation.execute(async () => {
  return await k8sApi.getPod('my-pod');
});

if (result.success) {
  console.log('Pod retrieved:', result.value);
} else {
  console.error('Failed after', result.attempts, 'attempts');
}
```

### Resource Operations Integration

```typescript
class PodOperations extends BaseResourceOperations<V1Pod> {
  async get(name: string, options?: ResourceOperationOptions): Promise<V1Pod> {
    const operation = this.getRetryableOperation<V1Pod>('get');

    return operation.executeOrThrow(async () => {
      try {
        const response = await this.coreApi.readNamespacedPod(
          name,
          options?.namespace || 'default'
        );
        return response.body;
      } catch (error) {
        this.handleApiError(error, 'get', name);
      }
    });
  }
}
```

## Best Practices

### 1. Error Classification

Always use typed errors for better error handling:

```typescript
try {
  await k8sApi.createPod(pod);
} catch (error) {
  if (error instanceof ResourceConflictError) {
    // Pod already exists, update instead
    await k8sApi.updatePod(pod);
  } else if (error instanceof ValidationError) {
    // Fix validation issues
    logger.error('Invalid pod spec:', error.details);
  } else if (error instanceof KubernetesError && error.retryable) {
    // Retry retryable errors
    throw error;
  }
}
```

### 2. Contextual Error Information

Always provide context when handling errors:

```typescript
const context: ErrorContext = {
  operation: 'createPod',
  resource: {
    kind: 'Pod',
    name: pod.metadata.name,
    namespace: pod.metadata.namespace
  },
  cluster: 'production',
  user: currentUser
};

const contextualError = createContextualError(error, context);
```

### 3. Circuit Breaker Tuning

Tune circuit breaker settings based on your SLAs:

```typescript
// For critical operations
const criticalCircuit = new CircuitBreaker({
  name: 'critical-ops',
  failureThreshold: 10,      // Allow more failures
  resetTimeout: 60000,       // Longer reset time
  failureRateThreshold: 20   // Lower rate threshold
});

// For non-critical operations
const nonCriticalCircuit = new CircuitBreaker({
  name: 'non-critical-ops',
  failureThreshold: 3,       // Fail fast
  resetTimeout: 15000,       // Quick recovery
  failureRateThreshold: 50   // Higher rate tolerance
});
```

### 4. Monitoring and Alerting

Set up monitoring for error patterns:

```typescript
// Monitor error rates
setInterval(() => {
  const errorRate = monitor.getErrorRate(300000); // 5 minutes
  if (errorRate > 50) {
    alerting.send({
      severity: 'high',
      message: `High error rate: ${errorRate} errors/5min`
    });
  }

  // Check for trending errors
  ['TimeoutError', 'NetworkError'].forEach(errorType => {
    if (monitor.isErrorTrending(errorType, 10, 300000)) {
      alerting.send({
        severity: 'medium',
        message: `${errorType} trending: 10+ in 5 minutes`
      });
    }
  });
}, 60000); // Check every minute
```

### 5. Graceful Degradation

Implement fallback mechanisms for critical paths:

```typescript
async function getPodWithFallback(name: string): Promise<V1Pod> {
  try {
    // Try primary method
    return await k8sApi.getPod(name);
  } catch (error) {
    if (error instanceof ServerUnavailableError) {
      // Try secondary cluster
      return await secondaryK8sApi.getPod(name);
    } else if (error instanceof TimeoutError) {
      // Return cached version
      return await cache.getPod(name);
    } else if (error instanceof ResourceNotFoundError) {
      // Return default pod template
      return createDefaultPod(name);
    }
    throw error;
  }
}
```

## Testing

### Unit Testing Error Handling

```typescript
describe('Error Handling', () => {
  it('should retry on transient errors', async () => {
    let attempts = 0;
    const operation = new RetryableOperation('test', {
      retry: { maxAttempts: 3, initialDelayMs: 10 }
    });

    const result = await operation.execute(async () => {
      attempts++;
      if (attempts < 3) {
        throw new NetworkError('Transient error');
      }
      return 'success';
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
  });

  it('should open circuit on repeated failures', async () => {
    const circuit = new CircuitBreaker({
      name: 'test',
      failureThreshold: 2,
      resetTimeout: 1000
    });

    // Fail twice
    for (let i = 0; i < 2; i++) {
      try {
        await circuit.execute(async () => {
          throw new Error('Failure');
        });
      } catch (e) {}
    }

    // Circuit should be open
    expect(circuit.getState()).toBe(CircuitState.OPEN);

    // Next call should fail immediately
    await expect(circuit.execute(async () => 'test'))
      .rejects.toThrow('Circuit breaker \'test\' is OPEN');
  });
});
```

### Integration Testing

```typescript
describe('Kubernetes Operations with Error Handling', () => {
  it('should handle pod creation with retry', async () => {
    // Mock API to fail twice then succeed
    let calls = 0;
    mockApi.createNamespacedPod.mockImplementation(() => {
      calls++;
      if (calls < 3) {
        throw { response: { statusCode: 503 } };
      }
      return { body: mockPod };
    });

    const podOps = new PodOperations(client);
    const pod = await podOps.create(mockPod);

    expect(pod).toEqual(mockPod);
    expect(calls).toBe(3);
  });
});
```

## Troubleshooting

### Common Issues

1. **Circuit Breaker Opens Too Frequently**
   - Increase `failureThreshold`
   - Increase `failureCountWindow`
   - Adjust `failureRateThreshold`

2. **Retries Taking Too Long**
   - Reduce `maxDelayMs`
   - Adjust `backoffMultiplier`
   - Set appropriate `timeoutMs`

3. **High Error Rates**
   - Check error monitor statistics
   - Identify trending error types
   - Review retry and circuit breaker configurations

### Debug Logging

Enable debug logging for detailed error handling information:

```typescript
const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Pass logger to error handling components
const strategy = new RetryStrategy(config, logger);
const circuit = new CircuitBreaker(config, logger);
const monitor = new ErrorMonitor(logger);
```

## Performance Considerations

1. **Circuit Breaker Overhead**: Minimal - O(1) state checks
2. **Retry Delays**: Configurable with exponential backoff
3. **Error Monitoring**: Maintains bounded history (max 1000 entries)
4. **Memory Usage**: Each circuit breaker maintains request history within time window

## Future Enhancements

1. **Adaptive Retry**: Adjust retry parameters based on success rates
2. **Bulkhead Pattern**: Isolate resources to prevent cascade failures
3. **Metrics Export**: Prometheus/OpenTelemetry integration
4. **Distributed Circuit Breaker**: Share state across instances
5. **Smart Fallbacks**: ML-based fallback selection

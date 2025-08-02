export { KubernetesClient, KubernetesClientConfig, AuthMethod } from './KubernetesClient.js';

// Export connection pooling
export {
  ConnectionPool,
  ConnectionPoolConfig,
  ConnectionEntry,
  ConnectionState,
} from './ConnectionPool.js';

export { ConnectionManager, ConnectionManagerConfig, ClusterStats } from './ConnectionManager.js';

// Export resource operations
export { ResourceOperations } from './ResourceOperations.js';

// Export base resource operations classes and interfaces
export {
  ResourceOperationOptions,
  IResourceOperations,
  BaseResourceOperations,
  WatchEvent,
  WatchEventType,
  WatchCallback,
  KubernetesOperationError,
} from './BaseResourceOperations.js';

// Export error handling
export {
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
  ErrorStats,
  ErrorContext,
  convertApiError,
  createContextualError,
} from './ErrorHandling.js';

// Export retry strategy
export {
  RetryStrategy,
  RetryConfig,
  RetryContext,
  RetryResult,
  RetryBuilder,
  RETRY_PRESETS,
  DEFAULT_RETRY_CONFIG,
  createRetryStrategy,
  Retryable,
} from './RetryStrategy.js';

// Export circuit breaker
export {
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitBreakerFactory,
  CircuitState,
  CircuitStats,
  DEFAULT_CIRCUIT_CONFIG,
  WithCircuitBreaker,
} from './CircuitBreaker.js';

// Export error handler
export {
  IErrorHandler,
  ErrorHandlerChain,
  ErrorHandlerChainConfig,
  LoggingErrorHandler,
  RetryErrorHandler,
  CircuitBreakerErrorHandler,
  ContextEnrichmentHandler,
  RateLimitHandler,
  ErrorHandlerFactory,
  IErrorRecovery,
  FallbackRecovery,
  CacheRecovery,
} from './ErrorHandler.js';

// Export retryable operation
export {
  RetryableOperation,
  RetryableOperationConfig,
  RetryableOperationFactory,
  OperationResult,
  RetryableMethod,
} from './RetryableOperation.js';

// Export specific resource operations
export { PodOperations, PodOperationOptions } from './resources/PodOperations.js';
export { ServiceOperations } from './resources/ServiceOperations.js';
export {
  DeploymentOperations,
  DeploymentOperationOptions,
} from './resources/DeploymentOperations.js';
export { ConfigMapOperations } from './resources/ConfigMapOperations.js';
export { SecretOperations, SecretType } from './resources/SecretOperations.js';
export { CustomResourceOperations } from './resources/CustomResourceOperations.js';

// Export utilities
export {
  LabelSelector,
  FieldSelector,
  PatchBuilder,
  MetadataUtils,
  ContainerUtils,
  PodTemplateUtils,
  ServiceUtils,
  DeploymentUtils,
} from './utils/ResourceUtils.js';

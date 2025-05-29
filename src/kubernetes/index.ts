export { KubernetesClient, KubernetesClientConfig, AuthMethod } from './KubernetesClient';

// Export connection pooling
export {
  ConnectionPool,
  ConnectionPoolConfig,
  ConnectionEntry,
  ConnectionState,
} from './ConnectionPool';

export {
  ConnectionManager,
  ConnectionManagerConfig,
  ClusterConfig,
  ClusterStats,
  LoadBalancingStrategy,
} from './ConnectionManager';

// Export resource operations
export {
  ResourceOperations,
  ResourceOperationOptions,
  IResourceOperations,
  BaseResourceOperations,
  WatchEvent,
  WatchEventType,
  WatchCallback,
  KubernetesOperationError,
} from './ResourceOperations';

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
} from './ErrorHandling';

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
} from './RetryStrategy';

// Export circuit breaker
export {
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitBreakerFactory,
  CircuitState,
  CircuitStats,
  DEFAULT_CIRCUIT_CONFIG,
  WithCircuitBreaker,
} from './CircuitBreaker';

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
} from './ErrorHandler';

// Export retryable operation
export {
  RetryableOperation,
  RetryableOperationConfig,
  RetryableOperationFactory,
  OperationResult,
  RetryableMethod,
} from './RetryableOperation';

// Export specific resource operations
export { PodOperations, PodOperationOptions } from './resources/PodOperations';
export { ServiceOperations } from './resources/ServiceOperations';
export { DeploymentOperations, DeploymentOperationOptions } from './resources/DeploymentOperations';
export { ConfigMapOperations } from './resources/ConfigMapOperations';
export { SecretOperations, SecretType } from './resources/SecretOperations';
export { CustomResourceOperations } from './resources/CustomResourceOperations';

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
} from './utils/ResourceUtils';

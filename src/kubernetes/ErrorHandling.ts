/**
 * Kubernetes Client Error Handling Module
 *
 * This module provides a comprehensive error handling system for Kubernetes operations,
 * including typed errors, monitoring, and conversion utilities.
 */

import { Logger } from 'winston';

/**
 * Base error class for all Kubernetes-related errors
 */
export class KubernetesError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly details: Record<string, any>;
  public readonly retryable: boolean;
  public readonly timestamp: Date;

  constructor(
    message: string,
    code: string,
    statusCode?: number,
    retryable: boolean = false,
    details?: Record<string, any>,
  ) {
    super(message);
    this.name = 'KubernetesError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.details = details || {};
    this.timestamp = new Date();

    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, KubernetesError.prototype);
  }
}

/**
 * Error thrown when authentication fails
 */
export class AuthenticationError extends KubernetesError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'AUTHENTICATION_ERROR', 401, false, details || {});
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

/**
 * Error thrown when authorization fails
 */
export class AuthorizationError extends KubernetesError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'AUTHORIZATION_ERROR', 403, false, details || {});
    this.name = 'AuthorizationError';
    Object.setPrototypeOf(this, AuthorizationError.prototype);
  }
}

/**
 * Error thrown when a resource is not found
 */
export class ResourceNotFoundError extends KubernetesError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'RESOURCE_NOT_FOUND', 404, false, details || {});
    this.name = 'ResourceNotFoundError';
    Object.setPrototypeOf(this, ResourceNotFoundError.prototype);
  }
}

/**
 * Error thrown when a resource already exists (conflict)
 */
export class ResourceConflictError extends KubernetesError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'RESOURCE_CONFLICT', 409, false, details || {});
    this.name = 'ResourceConflictError';
    Object.setPrototypeOf(this, ResourceConflictError.prototype);
  }
}

/**
 * Error thrown when request validation fails
 */
export class ValidationError extends KubernetesError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'VALIDATION_ERROR', 400, false, details || {});
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Error thrown when the server is unavailable
 */
export class ServerUnavailableError extends KubernetesError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'SERVER_UNAVAILABLE', 503, true, details || {});
    this.name = 'ServerUnavailableError';
    Object.setPrototypeOf(this, ServerUnavailableError.prototype);
  }
}

/**
 * Error thrown when a timeout occurs
 */
export class TimeoutError extends KubernetesError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'TIMEOUT_ERROR', 408, true, details || {});
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * Error thrown when rate limiting is encountered
 */
export class RateLimitError extends KubernetesError {
  constructor(message: string, retryAfter?: number, details?: Record<string, any>) {
    super(message, 'RATE_LIMIT_ERROR', 429, true, { ...(details || {}), retryAfter });
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

/**
 * Error thrown for network-related issues
 */
export class NetworkError extends KubernetesError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'NETWORK_ERROR', undefined, true, details || {});
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * Convert Kubernetes API errors to typed errors
 */
export function convertApiError(error: any): KubernetesError {
  // Handle Kubernetes API response errors
  if (error.response && error.response.body) {
    const body = error.response.body;
    const statusCode = error.response.statusCode || error.statusCode;
    const message = body.message || body.reason || 'Unknown error';
    const retryAfter = error.response.headers?.['retry-after'];

    const details = {
      kind: body.kind,
      apiVersion: body.apiVersion,
      reason: body.reason,
      details: body.details,
      code: body.code,
    };

    switch (statusCode) {
      case 401:
        return new AuthenticationError(message, details);
      case 403:
        return new AuthorizationError(message, details);
      case 404:
        return new ResourceNotFoundError(message, details);
      case 409:
        return new ResourceConflictError(message, details);
      case 400:
      case 422:
        return new ValidationError(message, details);
      case 429:
        return new RateLimitError(message, retryAfter ? parseInt(retryAfter) : undefined, details);
      case 408:
        return new TimeoutError(message, details);
      case 500:
      case 502:
      case 503:
      case 504:
        return new ServerUnavailableError(message, details);
      default:
        return new KubernetesError(message, 'API_ERROR', statusCode, statusCode >= 500, details);
    }
  }

  // Handle network errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
    return new NetworkError(error.message, { code: error.code });
  }

  // Handle timeout errors
  if (error.message && error.message.toLowerCase().includes('timeout')) {
    return new TimeoutError(error.message);
  }

  // Default error
  return new KubernetesError(error.message || 'Unknown error', 'UNKNOWN_ERROR', undefined, false, {
    originalError: error.toString(),
  });
}

/**
 * Error statistics tracking
 */
export interface ErrorStats {
  total: number;
  byType: Record<string, number>;
  byStatusCode: Record<number, number>;
  retryable: number;
  nonRetryable: number;
  lastError?: {
    message: string;
    code: string;
    timestamp: Date;
  };
}

/**
 * Error monitor for tracking and analyzing errors
 */
export class ErrorMonitor {
  private stats: ErrorStats = {
    total: 0,
    byType: {},
    byStatusCode: {},
    retryable: 0,
    nonRetryable: 0,
  };

  private errorLog: Array<{
    error: KubernetesError;
    operation: string;
    timestamp: Date;
  }> = [];

  private readonly maxLogSize = 1000;

  constructor(private logger?: Logger) {}

  /**
   * Record an error
   */
  recordError(error: KubernetesError, operation: string): void {
    this.stats.total++;

    // Track by error type
    this.stats.byType[error.name] = (this.stats.byType[error.name] || 0) + 1;

    // Track by status code
    if (error.statusCode) {
      this.stats.byStatusCode[error.statusCode] =
        (this.stats.byStatusCode[error.statusCode] || 0) + 1;
    }

    // Track retryable vs non-retryable
    if (error.retryable) {
      this.stats.retryable++;
    } else {
      this.stats.nonRetryable++;
    }

    // Update last error
    this.stats.lastError = {
      message: error.message,
      code: error.code,
      timestamp: error.timestamp,
    };

    // Add to error log
    this.errorLog.push({
      error,
      operation,
      timestamp: new Date(),
    });

    // Trim log if it gets too large
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxLogSize);
    }

    // Log the error
    this.logger?.error(`[${operation}] ${error.name}: ${error.message}`, {
      code: error.code,
      statusCode: error.statusCode,
      retryable: error.retryable,
      details: error.details,
    });
  }

  /**
   * Get error statistics
   */
  getStats(): ErrorStats {
    return { ...this.stats };
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit: number = 10): Array<{
    error: KubernetesError;
    operation: string;
    timestamp: Date;
  }> {
    return this.errorLog.slice(-limit);
  }

  /**
   * Clear statistics
   */
  clearStats(): void {
    this.stats = {
      total: 0,
      byType: {},
      byStatusCode: {},
      retryable: 0,
      nonRetryable: 0,
    };
    this.errorLog = [];
  }

  /**
   * Get error rate for a specific time window
   */
  getErrorRate(windowMs: number = 60000): number {
    const cutoff = new Date(Date.now() - windowMs);
    const recentErrors = this.errorLog.filter((entry) => entry.timestamp > cutoff);
    return recentErrors.length;
  }

  /**
   * Check if a specific error type is trending
   */
  isErrorTrending(errorType: string, threshold: number = 5, windowMs: number = 60000): boolean {
    const cutoff = new Date(Date.now() - windowMs);
    const recentErrors = this.errorLog.filter(
      (entry) => entry.timestamp > cutoff && entry.error.name === errorType,
    );
    return recentErrors.length >= threshold;
  }
}

/**
 * Error context for enhanced error information
 */
export interface ErrorContext {
  operation: string;
  resource?: {
    kind: string;
    name?: string;
    namespace?: string;
  };
  cluster?: string;
  user?: string;
  additionalInfo?: Record<string, any>;
}

/**
 * Enhanced error with context
 */
export function createContextualError(
  baseError: KubernetesError,
  context: ErrorContext,
): KubernetesError {
  const mergedDetails = {
    ...(baseError.details || {}),
    ...context,
  };

  // Special handling for RateLimitError (constructor: message, retryAfter, details)
  if (baseError instanceof RateLimitError) {
    const retryAfter = baseError.details?.retryAfter;
    return new RateLimitError(baseError.message, retryAfter, mergedDetails);
  }

  // For subclasses with (message, details) signature
  if (
    baseError instanceof ValidationError ||
    baseError instanceof AuthenticationError ||
    baseError instanceof AuthorizationError ||
    baseError instanceof ResourceNotFoundError ||
    baseError instanceof ResourceConflictError ||
    baseError instanceof ServerUnavailableError ||
    baseError instanceof TimeoutError ||
    baseError instanceof NetworkError
  ) {
    const ErrorClass = baseError.constructor as new (
      message: string,
      details?: Record<string, any>,
    ) => KubernetesError;
    return new ErrorClass(baseError.message, mergedDetails);
  }

  // For base KubernetesError (message, code, statusCode, retryable, details)
  const ErrorClass = baseError.constructor as typeof KubernetesError;
  return new ErrorClass(
    baseError.message,
    baseError.code,
    baseError.statusCode,
    baseError.retryable,
    mergedDetails,
  );
}

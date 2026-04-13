/**
 * API Retry Utility
 * 
 * Automatically retries failed API calls with exponential backoff
 * Handles:
 * - Network failures
 * - Temporary server errors (5xx)
 * - Rate limiting (429)
 * 
 * Usage:
 *   import { withRetry } from '@/lib/apiRetry';
 *   
 *   const result = await withRetry(() => apiClient.get('/api/v1/cart'));
 */

interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryableStatuses?: number[];
  onRetry?: (error: any, attempt: number, delay: number) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelay: 1000,      // 1 second
  maxDelay: 10000,         // 10 seconds
  backoffMultiplier: 2,    // Exponential: 1s, 2s, 4s, 8s...
  retryableStatuses: [408, 429, 500, 502, 503, 504],  // Timeout, Rate limit, Server errors
  onRetry: () => {}
};

/**
 * Sleep utility
 */
const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Execute function with retry logic
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> => {
  const {
    maxRetries,
    initialDelay,
    maxDelay,
    backoffMultiplier,
    retryableStatuses,
    onRetry
  } = { ...DEFAULT_OPTIONS, ...options };

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Execute the function
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if we should retry
      const shouldRetry = attempt < maxRetries && (
        // Network error (no response)
        !error.status ||
        // Retryable HTTP status
        retryableStatuses.includes(error.status)
      );

      if (!shouldRetry) {
        // Not retryable or max retries reached
        throw error;
      }

      // Calculate delay with exponential backoff + jitter
      const delay = Math.min(
        initialDelay * Math.pow(backoffMultiplier, attempt) + Math.random() * 1000,
        maxDelay
      );

      // Notify retry
      onRetry(error, attempt + 1, delay);

      console.warn(
        `[Retry] Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${Math.round(delay)}ms`,
        error.message || error
      );

      // Wait before retry
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
};

/**
 * Retry specifically for cart operations
 */
export const retryCartOperation = async <T>(
  fn: () => Promise<T>
): Promise<T> => {
  return withRetry(fn, {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 5000,
    onRetry: (error, attempt, delay) => {
      console.warn(`[Cart] Operation failed, retrying (${attempt}/3)...`, error.message);
    }
  });
};

/**
 * Check if error is retryable
 */
export const isRetryableError = (error: any): boolean => {
  return (
    !error.status ||  // Network error
    [408, 429, 500, 502, 503, 504].includes(error.status)
  );
};

/**
 * Check if error is a rate limit (429)
 */
export const isRateLimitError = (error: any): boolean => {
  return error.status === 429;
};

/**
 * Get retry-after header value (if present)
 */
export const getRetryAfter = (error: any): number | null => {
  if (error.headers && error.headers['retry-after']) {
    return parseInt(error.headers['retry-after'], 10) * 1000;
  }
  return null;
};

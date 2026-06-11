import {
  DEFAULT_RETRIES,
  DEFAULT_RETRY_DELAY,
  DEFAULT_TIMEOUT,
  LOCATION_ENDPOINTS,
  LOCATION_RETRIES,
  LOCATION_RETRY_DELAY,
} from './fetchConfig';
import rateLimitLogger from '../rateLimitLogger';

export interface RetryConfig {
  retries: number;
  retryDelay: number;
}

export function getRetryConfig(
  endpoint: string,
  options?: { retries?: number; retryDelay?: number }
): RetryConfig {
  if (LOCATION_ENDPOINTS.some(ep => endpoint.includes(ep))) {
    return { retries: LOCATION_RETRIES, retryDelay: LOCATION_RETRY_DELAY };
  }
  return {
    retries: options?.retries ?? DEFAULT_RETRIES,
    retryDelay: options?.retryDelay ?? DEFAULT_RETRY_DELAY,
  };
}

function calcBackoffDelay(baseDelay: number): number {
  return Math.min(baseDelay + Math.random() * 0.25 * baseDelay, 60_000);
}

export type On401Result<T> =
  | { action: 'retry' }
  | { action: 'skip' }
  | { action: 'return'; value: T };

// Mutating methods must not be retried on 429 — a duplicate POST /orders is worse than a visible error.
const NON_RETRYABLE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface RetryCallbacks<T> {
  attempt: (signal: AbortSignal) => Promise<T>;
  method: string;
  endpoint: string;
  retries: number;
  retryDelay: number;
  timeout: number;
  externalSignal?: AbortSignal;
  onBeforeFetch(): void;
  onAfterFetch(): void;
  on401(error: any): Promise<On401Result<T>>;
}

export async function executeWithRetry<T>(opts: RetryCallbacks<T>): Promise<T> {
  const { attempt, method, endpoint, retries, retryDelay, timeout, externalSignal, onBeforeFetch, onAfterFetch, on401 } = opts;
  let lastError: any;

  for (let i = 0; i <= retries; i++) {
    let controller: AbortController | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      let signal: AbortSignal;
      if (externalSignal) {
        signal = externalSignal;
      } else {
        controller = new AbortController();
        timeoutId = setTimeout(
          () =>
            controller!.abort(
              new DOMException(
                `Request timeout exceeded after ${timeout}ms. The server may be busy or unavailable.`,
                'TimeoutError'
              )
            ),
          timeout
        );
        signal = controller.signal;
      }

      onBeforeFetch();
      const result = await attempt(signal);
      onAfterFetch();
      if (timeoutId) clearTimeout(timeoutId);
      return result;
    } catch (error: any) {
      onAfterFetch();
      if (timeoutId) clearTimeout(timeoutId);

      if (error?.name === 'AbortError') {
        if (error.message && error.message !== 'signal is aborted without reason') {
          console.debug(`Request intentionally aborted: ${error.message}`);
        }
        throw error;
      }

      if (error?.status === 401) {
        const r = await on401(error);
        if (r.action === 'retry') continue;
        if (r.action === 'return') return r.value;
        throw error; // 'skip'
      }

      lastError = error;

      if (error?.status === 429) {
        // Always log 429s regardless of method — checkout and cart 429s must be visible
        rateLimitLogger.logEvent(
          endpoint,
          error.rateLimitInfo?.retryAfter || 0
        );

        if (i < retries && !NON_RETRYABLE_METHODS.has(method.toUpperCase())) {
          const baseDelay = error.rateLimitInfo?.retryAfter
            ? error.rateLimitInfo.retryAfter * 1000
            : retryDelay * Math.pow(2, i);
          const wait = calcBackoffDelay(baseDelay);

          if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
            console.log(`Rate limited. Waiting ${Math.round(wait)}ms before retry ${i + 1}/${retries}`);
          }

          await new Promise<void>(resolve => setTimeout(resolve, wait));
          onBeforeFetch();
          continue;
        }
      }

      throw error;
    }
  }

  throw lastError;
}

'use client';
/**
 * Browser-only API client.
 *
 * The 'use client' directive above ensures Next.js NEVER includes this file
 * in the server bundle, preventing localStorage / document / window access
 * from leaking into RSC/SSR code.
 *
 * All existing `import apiClient from '@/lib/api'` imports continue to
 * work unchanged via the barrel re-export in api.ts.
 */

import { tokenManager } from './http/tokenManager';
import { normaliseResponse } from './http/errorNormaliser';
import { getRetryConfig, executeWithRetry, type On401Result } from './http/retryHandler';
import { API_BASE_URL, DEFAULT_TIMEOUT } from './http/fetchConfig';
import {
  ApiError,
  ErrorCategory,
  type FetchOptions,
  type RateLimitInfo,
  type RequestInterceptor,
  type ResponseInterceptor,
} from './api-types';

// Client-readable "a session existed" hint, written by AuthContext on login
// (localStorage key). Under httpOnly-cookie auth JS cannot read the refresh
// token, so this is the only signal available to decide whether a 401 should
// trigger a silent refresh vs. be treated as a plain guest response.
// Keep in sync with CACHE_KEY in context/AuthContext.tsx.
const AUTH_HINT_KEY = 'auth_check';

/** True when the client believes it has (or had) an authenticated session. SSR-safe. */
function hasSessionHint(): boolean {
  if (tokenManager.refreshToken != null) return true; // legacy bearer flow
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(AUTH_HINT_KEY) != null;
  } catch {
    return false;
  }
}

class APIClient {
  private loadingCount = 0;
  private loadingListeners: Array<(isLoading: boolean, count: number) => void> = [];
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];
  private enableLogging =
    process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

  // Token management — all state lives in tokenManager
  setAuthToken = tokenManager.setAuthToken.bind(tokenManager);
  setRefreshToken = tokenManager.setRefreshToken.bind(tokenManager);
  clearAuthToken = tokenManager.clearAuthToken.bind(tokenManager);
  getAuthToken = tokenManager.getAuthToken.bind(tokenManager);
  getRefreshToken = tokenManager.getRefreshToken.bind(tokenManager);
  refreshSession = tokenManager.refreshSession.bind(tokenManager);

  addLoadingListener(cb: (isLoading: boolean, count: number) => void) {
    this.loadingListeners.push(cb);
  }

  removeLoadingListener(cb: (isLoading: boolean, count: number) => void) {
    const i = this.loadingListeners.indexOf(cb);
    if (i > -1) this.loadingListeners.splice(i, 1);
  }

  addRequestInterceptor(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor);
  }

  addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
  }

  setLogging(enabled: boolean): void {
    this.enableLogging = enabled;
  }

  private notifyLoadingChange() {
    const isLoading = this.loadingCount > 0;
    for (const cb of this.loadingListeners) {
      try { cb(isLoading, this.loadingCount); } catch {}
    }
  }

  private async runRequestInterceptors(
    method: string,
    endpoint: string,
    data: any,
    headers: HeadersInit
  ) {
    let config = { method, endpoint, data, headers };
    for (const interceptor of this.requestInterceptors) {
      if (interceptor.onRequest) {
        try {
          config = await interceptor.onRequest(config);
        } catch (error) {
          if (interceptor.onError) return interceptor.onError(error);
          throw error;
        }
      }
    }
    return config;
  }

  private async runResponseInterceptors(response: any) {
    let result = response;
    for (const interceptor of this.responseInterceptors) {
      if (interceptor.onResponse) {
        try {
          result = await interceptor.onResponse(result);
        } catch (error) {
          if (interceptor.onError) { result = await interceptor.onError(error); } else throw error;
        }
      }
    }
    return result;
  }

  private async executeRequest<T>(
    method: string,
    endpoint: string,
    data: any,
    options?: FetchOptions
  ): Promise<T> {
    const isCompleteUrl = endpoint.startsWith('http://') || endpoint.startsWith('https://');
    let finalUrl = isCompleteUrl ? endpoint : `${API_BASE_URL}${endpoint}`;
    if (options?.params) {
      const qs = new URLSearchParams(options.params);
      finalUrl += `${finalUrl.includes('?') ? '&' : '?'}${qs}`;
    }

    const startTime = performance.now();
    const headers = tokenManager.getHeaders(options?.headers);
    const ic = await this.runRequestInterceptors(method, endpoint, data, headers);
    if (this.enableLogging) console.log(`[API] ${ic.method} ${ic.endpoint}`);

    const { retries, retryDelay } = getRetryConfig(endpoint, options);

    const result = await executeWithRetry<T>({
      attempt: async (signal) => {
        const { params: _p, headers: _h, retries: _r, retryDelay: _d, timeout: _t, signal: _s, ...rest } = options ?? {};
        const response = await fetch(finalUrl, {
          ...rest,
          method: ic.method,
          headers: ic.headers,
          signal,
          credentials: 'include',
          ...(ic.data !== undefined && { body: JSON.stringify(ic.data) }),
        });
        if (this.enableLogging && performance.now() - startTime > 1000) {
          console.warn(
            `[API SLOW] ${ic.method} ${ic.endpoint} took ${(performance.now() - startTime).toFixed(0)}ms`
          );
        }
        return normaliseResponse(response) as Promise<T>;
      },
      method,
      endpoint,
      retries,
      retryDelay,
      timeout: options?.timeout ?? DEFAULT_TIMEOUT,
      externalSignal: options?.signal ?? undefined,
      onBeforeFetch: () => { this.loadingCount++; this.notifyLoadingChange(); },
      onAfterFetch: () => { this.loadingCount = Math.max(0, this.loadingCount - 1); this.notifyLoadingChange(); },
      on401: async (error): Promise<On401Result<T>> => {
        const isAuthEndpoint =
          endpoint.includes('/auth/login') ||
          endpoint.includes('/auth/register') ||
          endpoint.includes('/auth/refresh');
        if (isAuthEndpoint) return { action: 'skip' };

        if (error.rawData?.code === 'context_mismatch' && typeof window !== 'undefined') {
          window.location.href = '/login?reason=context_mismatch';
          return { action: 'skip' };
        }

        // Under httpOnly-cookie auth `tokenManager.refreshToken` is always null
        // (JS can't read the cookie), so we gate the silent refresh on the login
        // hint instead. Genuine guests (no hint) skip refresh so public-page 401s
        // don't bounce them to login; expired sessions refresh via the httpOnly
        // refreshToken cookie the browser sends to /auth/refresh automatically.
        if (!hasSessionHint()) {
          return { action: 'skip' };
        }

        try {
          await tokenManager.refreshSession(); // concurrent 401s coalesce here
          return { action: 'retry' };
        } catch (refreshError) {
          tokenManager.clearAuthToken();
          // Drop the stale login hint so a hard-expired session doesn't loop.
          try {
            if (typeof window !== 'undefined') window.localStorage.removeItem(AUTH_HINT_KEY);
          } catch { /* storage unavailable — non-fatal */ }
          console.error('Token refresh failed:', refreshError);
          if (typeof window !== 'undefined') {
            window.location.href = '/login?reason=refresh_failed';
          }
          throw refreshError;
        }
      },
    });

    return this.runResponseInterceptors(result);
  }

  async get<T>(endpoint: string, options?: FetchOptions): Promise<T> {
    return this.executeRequest<T>('GET', endpoint, undefined, options);
  }

  async post<T>(endpoint: string, data: any, options?: FetchOptions): Promise<T> {
    return this.executeRequest<T>('POST', endpoint, data, options);
  }

  async put<T = any>(endpoint: string, data: any, options?: FetchOptions): Promise<T> {
    return this.executeRequest<T>('PUT', endpoint, data, options);
  }

  async patch<T = any>(endpoint: string, data?: any, options?: FetchOptions): Promise<T> {
    return this.executeRequest<T>('PATCH', endpoint, data, options);
  }

  async delete<T>(endpoint: string, options?: FetchOptions): Promise<T> {
    return this.executeRequest<T>('DELETE', endpoint, undefined, options);
  }
}

// Singleton — one instance shared across the entire browser session
const apiClient = new APIClient();

export default apiClient;
export { ApiError, ErrorCategory };
export type { FetchOptions, RateLimitInfo };

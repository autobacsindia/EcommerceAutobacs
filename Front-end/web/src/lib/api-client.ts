'use client';
/**
 * Browser-only API client.
 *
 * The 'use client' directive above ensures Next.js NEVER includes this file
 * in the server bundle, preventing localStorage / document / window access
 * from leaking into RSC/SSR code.
 *
 * All 20+ existing `import apiClient from '@/lib/api'` imports continue to
 * work unchanged via the barrel re-export in api.ts.
 */

import rateLimitLogger from './rateLimitLogger';
import { ApiError, ErrorCategory, type FetchOptions, type RateLimitInfo, type RequestInterceptor, type ResponseInterceptor } from './api-types';

// Storage key for JWT token
const TOKEN_KEY = 'autobacs_auth_token';
const REFRESH_TOKEN_KEY = 'autobacs_refresh_token';
const SESSION_ID_KEY = 'autobacs_session_id';

// Define location-related endpoints that need special rate limit handling
const locationEndpoints = ['/location/current', '/location/select', '/location/estimate'];

/**
 * API Client class for managing all backend communications.
 * Browser-only: uses localStorage, document.cookie, window.location.
 */
class APIClient {
  private token: string | null = null;
  private refreshToken: string | null = null;
  private isRefreshing = false;
  private refreshSubscribers: ((token: string) => void)[] = [];
  private loadingCount = 0;
  private loadingListeners: Array<(isLoading: boolean, count: number) => void> = [];
  
  // Interceptors
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];
  
  // Request logging
  private enableLogging = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

  constructor() {
    // NOTE: Tokens are now stored in httpOnly cookies set by the backend
    // Browser automatically sends cookies with requests - no manual token management needed
    // This protects against XSS attacks (JavaScript cannot read httpOnly cookies)
    
    if (typeof window !== 'undefined') {
      // Initialize session ID for guest cart support
      this.getSessionId();
    }
  }

  /**
   * Set authentication token
   * DEPRECATED: Tokens are now managed via httpOnly cookies set by backend
   * This method is kept for backward compatibility but does nothing
   */
  setAuthToken(token: string): void {
    // NO-OP: Backend sets access token as httpOnly cookie
    // Frontend should NEVER store tokens in localStorage (XSS vulnerability)
    console.warn('[API Client] setAuthToken() is deprecated - tokens are now managed via httpOnly cookies');
  }

  /**
   * Set refresh token
   * DEPRECATED: Tokens are now managed via httpOnly cookies set by backend
   * This method is kept for backward compatibility but does nothing
   */
  setRefreshToken(token: string): void {
    // NO-OP: Backend sets refresh token as httpOnly cookie
    // Frontend should NEVER store tokens in localStorage (XSS vulnerability)
    console.warn('[API Client] setRefreshToken() is deprecated - tokens are now managed via httpOnly cookies');
  }

  /**
   * Clear authentication token
   * NOTE: Backend clears cookies on logout, this just clears local state
   */
  clearAuthToken(): void {
    this.token = null;
    this.refreshToken = null;
    // NOTE: Backend clears httpOnly cookies on logout endpoint
    // No localStorage to clear (tokens were never stored here)
  }

  /**
   * Get current auth token
   */
  getAuthToken(): string | null {
    return this.token;
  }

  /**
   * Get current refresh token
   */
  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  /**
   * Get or generate session ID for guest cart support
   */
  private getSessionId(): string {
    if (typeof window === 'undefined') {
      return '';
    }
    
    let sessionId = localStorage.getItem(SESSION_ID_KEY);
    if (!sessionId) {
      sessionId = this.generateSessionId();
      localStorage.setItem(SESSION_ID_KEY, sessionId);
    }
    return sessionId;
  }

  /**
   * Generate a cryptographically secure random session ID
   */
  private generateSessionId(): string {
    const randomPart = crypto.getRandomValues(new Uint8Array(16))
      .reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), '');
    const timestamp = Date.now().toString(36);
    return `sess_${randomPart}_${timestamp}`;
  }

  /**
   * Refresh the access token
   */
  public async refreshSession(): Promise<string | null> {
    try {
      // Always use relative path — goes through Next.js rewrite proxy like all other calls
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refreshToken: this.refreshToken })
      });

      const data = await response.json();

      if (response.ok && data.success && data.accessToken) {
        this.setAuthToken(data.accessToken);
        if (data.refreshToken) {
          this.setRefreshToken(data.refreshToken);
        }
        return data.accessToken;
      } else {
        throw new Error('Refresh failed');
      }
    } catch (error) {
      this.clearAuthToken();
      throw error;
    }
  }

  private onRefreshed(token: string) {
    this.refreshSubscribers.forEach(cb => cb(token));
    this.refreshSubscribers = [];
  }

  private addSubscriber(callback: (token: string) => void) {
    this.refreshSubscribers.push(callback);
  }

  addLoadingListener(callback: (isLoading: boolean, count: number) => void) {
    this.loadingListeners.push(callback);
  }

  removeLoadingListener(callback: (isLoading: boolean, count: number) => void) {
    const index = this.loadingListeners.indexOf(callback);
    if (index > -1) {
      this.loadingListeners.splice(index, 1);
    }
  }

  /**
   * Register a request interceptor
   * Interceptors run in order of registration before each request
   */
  addRequestInterceptor(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor);
  }

  /**
   * Register a response interceptor
   * Interceptors run in order of registration after each response
   */
  addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
  }

  /**
   * Enable/disable request logging
   */
  setLogging(enabled: boolean): void {
    this.enableLogging = enabled;
  }

  /**
   * Execute request interceptors
   */
  private async executeRequestInterceptors(
    method: string,
    endpoint: string,
    data: any,
    headers: HeadersInit
  ): Promise<{ method: string; endpoint: string; data: any; headers: HeadersInit }> {
    let config: { method: string; endpoint: string; data: any; headers: HeadersInit } = 
      { method, endpoint, data, headers };
    
    for (const interceptor of this.requestInterceptors) {
      if (interceptor.onRequest) {
        try {
          config = await interceptor.onRequest(config);
        } catch (error) {
          if (interceptor.onError) {
            return await interceptor.onError(error);
          }
          throw error;
        }
      }
    }
    
    return config;
  }

  /**
   * Execute response interceptors
   */
  private async executeResponseInterceptors(response: any): Promise<any> {
    let result = response;
    
    for (const interceptor of this.responseInterceptors) {
      if (interceptor.onResponse) {
        try {
          result = await interceptor.onResponse(result);
        } catch (error) {
          if (interceptor.onError) {
            result = await interceptor.onError(error);
          } else {
            throw error;
          }
        }
      }
    }
    
    return result;
  }

  private notifyLoadingChange() {
    const isLoading = this.loadingCount > 0;
    for (const cb of this.loadingListeners) {
      try {
        cb(isLoading, this.loadingCount);
      } catch {}
    }
  }

  /**
   * Get cookie value by name
   */
  private getCookie(name: string): string | null {
    if (typeof window === 'undefined') return null;
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
    return null;
  }

  /**
   * Build headers for requests
   */
  private getHeaders(customHeaders?: HeadersInit): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...customHeaders
    };

    if (this.token) {
      (headers as any)['Authorization'] = `Bearer ${this.token}`;
    }

    // Add session ID for guest cart support (always include, even for authenticated users)
    const sessionId = this.getSessionId();
    if (sessionId) {
      (headers as any)['x-session-id'] = sessionId;
    }

    // Add CSRF token if available
    const xsrfToken = this.getCookie('XSRF-TOKEN');
    if (xsrfToken) {
      (headers as any)['X-XSRF-TOKEN'] = xsrfToken;
    }

    return headers;
  }

  /**
   * Categorize error based on status code and error type
   */
  private categorizeError(status: number, error: any): ErrorCategory {
    // Network errors (offline, DNS issues, CORS errors)
    if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('Failed to fetch') || error.message.includes('NetworkError'))) {
      return ErrorCategory.NETWORK;
    }
    
    // Authentication errors
    if (status === 401 || status === 403) {
      return ErrorCategory.AUTH;
    }

    // Client errors
    if (status >= 400 && status < 500) {
      return ErrorCategory.CLIENT;
    }

    // Server errors
    if (status >= 500 && status < 600) {
      return ErrorCategory.SERVER;
    }

    // Timeout errors
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return ErrorCategory.TIMEOUT;
    }

    // Parsing errors
    if (error instanceof SyntaxError) {
      return ErrorCategory.PARSING;
    }

    return ErrorCategory.NETWORK;
  }

  /**
   * Handle API responses
   */
  private async handleResponse(response: Response): Promise<any> {
    // Clone response to allow multiple reads if needed
    const responseClone = response.clone();
    
    let data;
    const contentType = response.headers.get('content-type');
    
    try {
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
        try {
          // Try to parse text as JSON just in case
          data = JSON.parse(data);
        } catch (e) {
          // Keep as text if not valid JSON
        }
      }
    } catch (error) {
      // If parsing fails, use status text or empty object
      data = { message: response.statusText || 'Unknown error occurred' };
    }

    try {
      if (!response.ok) {
        // Handle rate limiting (429)
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after');
          const resetTime = retryAfter ? Date.now() + (parseInt(retryAfter) * 1000) : Date.now() + 900000; // Default to 15 minutes
        
          // Don't retry rate limit errors immediately
          const errorMessage = typeof data === 'object' && data.message ? data.message : 'Too many requests, please try again later';
        
          // Include rate limit information in error
          const rateLimitInfo = {
            retryAfter: retryAfter ? parseInt(retryAfter) : 900,
            resetTime
          };
        
          throw new ApiError(response.status, errorMessage, response.url, ErrorCategory.CLIENT, rateLimitInfo);
        }
    
        // Handle authentication errors - Removed automatic redirect to allow refresh logic
        if (response.status === 401) {
          // Just throw error, let the caller handle refresh/redirect
        }
    
        // Extract error message
        let errorMessage = typeof data === 'object' && data.message ? data.message : 
                           typeof data === 'string' ? data : 
                           response.statusText || 'An error occurred';
    
        // Categorize reverse geocode errors specifically
        let category: ErrorCategory;
        if (response.url && response.url.includes('/location/select') && 
            errorMessage && errorMessage.toLowerCase().includes('reverse geocode')) {
          errorMessage = 'Failed to reverse geocode coordinates';
              
          if (errorMessage.toLowerCase().includes('zero results')) {
            category = ErrorCategory.CLIENT; // Invalid coordinates with no address match
          } else if (errorMessage.toLowerCase().includes('timeout') || response.status === 408) {
            category = ErrorCategory.TIMEOUT; // Service timeout
          } else if (response.status >= 500) {
            category = ErrorCategory.SERVER; // Service unavailable
          } else {
            category = ErrorCategory.CLIENT; // General geocoding failure
          }
        } else {
          // For non-reverse geocode errors, use default categorization
          category = this.categorizeError(response.status, new Error(errorMessage));
        }
            
        // Include validation errors in the message if they exist
        if (typeof data === 'object' && data.errors && Array.isArray(data.errors)) {
          const validationErrors = data.errors.map((err: any) => {
            if (typeof err === 'string') return err;
            if (err.msg) return err.msg;
            if (err.message) return err.message;
            if (err.param && err.msg) return `${err.param}: ${err.msg}`;
            return 'Validation error';
          }).join(', ');

          if (validationErrors) {
            const allGenericValidationErrors = (validationErrors as string)
              .split(',')
              .map((msg: string) => msg.trim().toLowerCase())
              .every((msg: string) => msg === 'validation error');

            if (!allGenericValidationErrors) {
              errorMessage = `${errorMessage}: ${validationErrors}`;
            } else {
              if (data.message && data.message !== 'Validation failed') {
                errorMessage = data.message;
              } else {
                errorMessage = 'Validation failed. Please check your input and try again.';
              }
            }
          }
        }
          
        const apiError = new ApiError(response.status, errorMessage, response.url, category);
          
        // Add raw response data to error for debugging
        apiError.rawData = data;
        apiError.responseStatus = response.status;
          
        throw apiError;
      }
    
      return data;
    } catch (error) {
      // Handle abort errors specifically - don't wrap them in ApiError
      if ((error as any).name === 'AbortError') {
        // For abort errors, we don't want to throw an ApiError as this creates noise in error tracking
        // Instead, we re-throw the original error which will be caught by the calling function
        // Only log if there's a meaningful reason
        if ((error as any).message && (error as any).message !== 'signal is aborted without reason') {
          console.debug(`Request intentionally aborted for ${(response as any).url}: ${(error as any).message}`);
        }
        throw error;
      }
    
      // Better error serialization to avoid empty objects
      const errorDetails: Record<string, any> = {
        errorType: typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : undefined,
        isApiError: error instanceof ApiError
      };
    
      // Add stack trace only if available
      if (error instanceof Error && error.stack) {
        errorDetails.errorStack = error.stack;
      }
    
      // Add API-specific error details
      if ((error as any)?.status !== undefined) {
        errorDetails.status = (error as any).status;
      }
      if ((response as any)?.url) {
        errorDetails.url = (response as any).url;
      }
      if ((error as any)?.category) {
        errorDetails.category = (error as any).category;
      }
      if ((error as any)?.responseStatus !== undefined) {
        errorDetails.responseStatus = (error as any).responseStatus;
      }
      if ((error as any)?.rawData !== undefined) {
        errorDetails.rawData = (error as any).rawData;
      }
    
      // Don't log expected 404 errors for location endpoints (user hasn't set location yet)
      // or category endpoints (category might not exist)
      // or vehicle product endpoints (will fallback to WordPress)
      const isLocationEndpoint = (response as any).url?.includes('/location/current');
      const isCategoryEndpoint = (response as any).url?.includes('/categories/slug/');
      const isVehiclesEndpoint = (response as any).url?.includes('/vehicles/slug/');
      // /products/slug/:slug is tried first for every product page load; a 404 means
      // the segment is an ObjectId (legacy link) — fall through to /products/:id is expected.
      const isProductSlugEndpoint = (response as any).url?.includes('/products/slug/');
      const isVehicleProductsEndpoint = (response as any).url?.includes('/products/by-vehicle/');
      const is404Error = (error as any)?.status === 404 || (response as any).status === 404;
    
      // Also check if the error is an ApiError with 404 status
      const isApiError404 = error instanceof ApiError && error.status === 404;

      // Check for invalid ID format errors
      const isInvalidIdError = typeof errorDetails.errorMessage === 'string' && (
        errorDetails.errorMessage.includes('Invalid ID format') || 
        errorDetails.errorMessage.includes('Cast to ObjectId failed')
      );
    
      // Check for order status errors (redundant updates)
      const isOrderStatusError = typeof errorDetails.errorMessage === 'string' && (
        errorDetails.errorMessage.includes('Cannot mark order as failed') || 
        errorDetails.errorMessage.includes('cannot be cancelled') ||
        errorDetails.errorMessage.includes('Order already in terminal state')
      );

      // Check for auth errors (401)
      const isAuthError = (error as any)?.status === 401 || (response as any).status === 401;

      // Only log non-rate limit errors to reduce console spam
      const isRateLimitError = (error as any)?.status === 429 || (response as any).status === 429;
    
      // Suppress expected/handled errors to reduce console noise
      const shouldSuppressLog = ((isLocationEndpoint || isCategoryEndpoint || isVehiclesEndpoint || isProductSlugEndpoint) && (is404Error || isApiError404)) || isVehicleProductsEndpoint || isInvalidIdError || isAuthError || isOrderStatusError;
    
      if (!shouldSuppressLog) {
        if (!isRateLimitError) {
          const status = errorDetails.status || (error as any)?.status || 'unknown';
          const url = errorDetails.url || (response as any)?.url || '';
          if (process.env.NODE_ENV !== 'test') {
            console.error(`API Response Error [${status}] ${url}:`, errorDetails);
          }
        } else {
          if (process.env.NODE_ENV !== 'test') {
            console.warn('Rate limit hit:', errorDetails);
          }
        }
      }
    
      // Handle parsing errors
      if (error instanceof SyntaxError) {
        throw new ApiError(0, 'Invalid response format', (response as any).url, ErrorCategory.PARSING);
      }

      // Re-throw ApiError instances
      if (error instanceof ApiError) {
        throw error;
      }

      // Handle other errors with more context
      const category = this.categorizeError((response as any).status, error);
      let errorMessage = 'An unknown error occurred';

      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }

      // Add more context for network errors
      if (category === ErrorCategory.NETWORK) {
        errorMessage = `Network error: Unable to connect to the server. Please make sure the backend server is running. Details: ${errorMessage}`;
      }

      const apiError = new ApiError((response as any).status || 0, errorMessage, (response as any).url || '', category);

      // Add error details for debugging
      apiError.originalError = error;

      throw apiError;
    }
  }

  /**
   * Internal method to execute requests with retry and refresh logic
   */
  private async executeRequest<T>(
    method: string,
    endpoint: string,
    data: any | undefined,
    options?: RequestInit & { retries?: number, retryDelay?: number, timeout?: number, params?: Record<string, any> }
  ): Promise<T> {
    // Browser: always use relative /api/v1 — routed through Next.js rewrite proxy (no CORS)
    const API_BASE_URL = '/api/v1';

    const isCompleteUrl = endpoint.startsWith('http://') || endpoint.startsWith('https://');
    
    // Handle query parameters
    let finalUrl = isCompleteUrl ? endpoint : `${API_BASE_URL}${endpoint}`;
    if (options?.params) {
      const params = new URLSearchParams(options.params);
      const separator = finalUrl.includes('?') ? '&' : '?';
      finalUrl = `${finalUrl}${separator}${params.toString()}`;
    }
    
    // Start performance timer
    const startTime = performance.now();
    
    // Run request interceptors
    const initialHeaders = this.getHeaders(options?.headers);
    const interceptedConfig = await this.executeRequestInterceptors(
      method,
      endpoint,
      data,
      initialHeaders
    );
    
    if (this.enableLogging) {
      console.log(`[API] ${interceptedConfig.method} ${interceptedConfig.endpoint}`);
    }
    
    // Default settings
    let retries = options?.retries ?? 3;
    let retryDelay = options?.retryDelay ?? 1000; // 1 second default
    const timeout = options?.timeout ?? 30000; // 30 seconds default
    
    // Increase retries and delay for location endpoints
    if (locationEndpoints.some(ep => endpoint.includes(ep))) {
      retries = 5; // More retries for location endpoints
      retryDelay = 2000; // Longer initial delay
    }
    
    let lastError: any;
    
    for (let i = 0; i <= retries; i++) {
      // Create abort controller for timeout handling
      let controller: AbortController | null = null;
      let timeoutId: NodeJS.Timeout | null = null;
      
      try {
        // Use provided signal if available, otherwise create our own timeout controller
        let signal;
        
        if (options?.signal) {
          // Use the provided signal directly
          signal = options.signal;
        } else {
          // Create our own timeout controller
          controller = new AbortController();
          timeoutId = setTimeout(() => controller!.abort(new DOMException(`Request timeout exceeded after ${timeout}ms. The server may be busy or unavailable.`, 'TimeoutError')), timeout);
          signal = controller.signal;
        }
        
        // Remove params from options to avoid passing it to fetch
        const { params, ...fetchOptionsWithoutParams } = options || {};
        
        // Separate headers from other options to prevent conflicts
        const { headers: optionHeaders, ...restOptions } = fetchOptionsWithoutParams || {};
        
        const fetchOptions: RequestInit = {
          ...restOptions,
          method: interceptedConfig.method,
          headers: interceptedConfig.headers,
          signal
        };

        if (interceptedConfig.data !== undefined) {
          fetchOptions.body = JSON.stringify(interceptedConfig.data);
        }
        
        this.loadingCount++;
        this.notifyLoadingChange();
        const response = await fetch(finalUrl, fetchOptions);
        this.loadingCount = Math.max(0, this.loadingCount - 1);
        this.notifyLoadingChange();
        
        if (timeoutId) clearTimeout(timeoutId);
        
        // Calculate request duration
        const duration = performance.now() - startTime;
        
        // Log slow requests (>1s)
        if (this.enableLogging && duration > 1000) {
          console.warn(`[API SLOW] ${interceptedConfig.method} ${interceptedConfig.endpoint} took ${duration.toFixed(0)}ms`);
        }
        
        const responseData = await this.handleResponse(response);
        
        // Run response interceptors
        return await this.executeResponseInterceptors(responseData);
      } catch (error: any) {
        this.loadingCount = Math.max(0, this.loadingCount - 1);
        this.notifyLoadingChange();
        if (timeoutId) clearTimeout(timeoutId);
        
        // Handle abort errors specifically
        if (error.name === 'AbortError') {
          if (error.message && error.message !== 'signal is aborted without reason') {
            console.debug(`Request intentionally aborted for ${finalUrl}: ${error.message}`);
          }
          throw error;
        }

        // Handle Token Refresh on 401
        // Skip for auth endpoints to avoid infinite loops
        const isAuthEndpoint = endpoint.includes('/auth/login') || endpoint.includes('/auth/register') || endpoint.includes('/auth/refresh');
        
        if (error.status === 401 && !isAuthEndpoint) {
          // Only attempt refresh if we have a refresh token (skip for guest users)
          if (this.refreshToken) {
            console.debug('401 detected, attempting token refresh...');
            
            if (!this.isRefreshing) {
               this.isRefreshing = true;
               try {
                 const newToken = await this.refreshSession();
                 if (newToken) {
                   this.onRefreshed(newToken);
                 }
                 this.isRefreshing = false;
                 // Retry the request immediately
                 continue;
               } catch (refreshError) {
                this.isRefreshing = false;
                this.clearAuthToken();
                console.error('Token refresh failed:', refreshError);
                if (typeof window !== 'undefined') {
                  window.location.href = '/login?reason=refresh_failed';
                }
                throw refreshError;
              }
            } else {
               // Wait for refresh to complete
               return new Promise<T>((resolve, reject) => {
                 this.addSubscriber(() => {
                   // Retry request after token refresh
                   resolve(this.executeRequest<T>(method, endpoint, data, options));
                 });
               });
             }
          } else {
            // No refresh token - this is a guest user, don't attempt refresh
            // Just throw the 401 error normally
            console.debug('401 detected but no refresh token available (guest user)');
          }
        }
        
        lastError = error;
        
        // If it's a rate limit error and we have retries left, wait and retry
        if (error.status === 429 && i < retries) {
          const baseDelay = error.rateLimitInfo?.retryAfter ? error.rateLimitInfo.retryAfter * 1000 : (retryDelay * Math.pow(2, i));
          const jitter = Math.random() * 0.25 * baseDelay;
          const retryAfter = Math.min(baseDelay + jitter, 60000); 
          if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
            console.log(`Rate limited. Waiting ${Math.round(retryAfter)}ms before retry ${i + 1}/${retries}`);
          }
          
          rateLimitLogger.logEvent(endpoint, error.rateLimitInfo?.retryAfter || Math.ceil(retryAfter / 1000));
          
          await new Promise(resolve => setTimeout(resolve, retryAfter));
          this.loadingCount++;
          this.notifyLoadingChange();
          continue;
        }
        
        // For all other errors or if we're out of retries, throw the error
        throw error;
      }
    }
    
    // If we get here, we've exhausted all retries
    throw lastError;
  }

  /**
   * GET request with retry logic for rate limiting
   */
  async get<T>(endpoint: string, options?: RequestInit & { retries?: number, retryDelay?: number, timeout?: number, params?: Record<string, any> }): Promise<T> {
    return this.executeRequest<T>('GET', endpoint, undefined, options);
  }

  /**
   * POST request with retry logic for rate limiting
   */
  async post<T>(endpoint: string, data: any, options?: RequestInit & { retries?: number, retryDelay?: number, timeout?: number, params?: Record<string, any> }): Promise<T> {
    return this.executeRequest<T>('POST', endpoint, data, options);
  }

  /**
   * PUT request with retry logic for rate limiting
   */
  async put<T = any>(endpoint: string, data: any, options?: RequestInit & { retries?: number, retryDelay?: number, timeout?: number, params?: Record<string, any> }): Promise<T> {
    return this.executeRequest<T>('PUT', endpoint, data, options);
  }

  /**
   * PATCH request with retry logic for rate limiting
   */
  async patch<T = any>(endpoint: string, data?: any, options?: RequestInit & { retries?: number, retryDelay?: number, timeout?: number, params?: Record<string, any> }): Promise<T> {
    return this.executeRequest<T>('PATCH', endpoint, data, options);
  }

  /**
   * DELETE request with retry logic for rate limiting
   */
  async delete<T>(endpoint: string, options?: RequestInit & { retries?: number, retryDelay?: number, timeout?: number, params?: Record<string, any> }): Promise<T> {
    return this.executeRequest<T>('DELETE', endpoint, undefined, options);
  }
}

// Singleton — one instance shared across the entire browser session
const apiClient = new APIClient();

export default apiClient;
export { ApiError, ErrorCategory };
export type { FetchOptions, RateLimitInfo };

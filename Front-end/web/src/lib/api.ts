// API Client for Autobacs India Backend
// Handles all API communication with the Express backend
// Updated to fix rate limit issues

// API utility functions with retry logic and error handling

// Note: To use rate limit notifications, wrap your app with RateLimitProvider
// and call showRateLimitNotification from the useRateLimit hook when catching ApiError with status 429

import rateLimitLogger from './rateLimitLogger';

interface FetchOptions extends RequestInit {
  retries?: number;
  retryDelay?: number;
  timeout?: number;
}

interface RateLimitInfo {
  retryAfter?: number;  // Seconds until retry allowed
  resetTime?: number;   // Timestamp when rate limit resets
}

class ApiError extends Error {
  status: number;
  url: string;
  category?: string;
  rateLimitInfo?: RateLimitInfo;
  rawData?: any;
  responseStatus?: number;
  originalError?: any;

  constructor(
    status: number,
    message: string,
    url: string,
    category?: string,
    rateLimitInfo?: RateLimitInfo
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.category = category;
    this.rateLimitInfo = rateLimitInfo;
  }
}

// Enhanced error categorization
enum ErrorCategory {
  NETWORK = 'network',
  CLIENT = 'client',
  SERVER = 'server',
  TIMEOUT = 'timeout',
  PARSING = 'parsing',
  AUTH = 'auth'
}

// Storage key for JWT token
const TOKEN_KEY = 'autobacs_auth_token';

// Define location-related endpoints that need special rate limit handling
const locationEndpoints = ['/location/current', '/location/select', '/location/estimate'];

/**
 * API Client class for managing all backend communications
 */
class APIClient {
  private token: string | null = null;

  constructor() {
    // Initialize token from localStorage if available (client-side only)
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem(TOKEN_KEY);
    }
  }

  /**
   * Set authentication token
   */
  setAuthToken(token: string): void {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem(TOKEN_KEY, token);
    }
  }

  /**
   * Clear authentication token
   */
  clearAuthToken(): void {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  /**
   * Get current auth token
   */
  getAuthToken(): string | null {
    return this.token;
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
    
    // Client errors (4xx)
    if (status >= 400 && status < 500) {
      return ErrorCategory.CLIENT;
    }
    
    // Server errors (5xx)
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
    
    // Default to network for unknown errors
    return ErrorCategory.NETWORK;
  }

  /**
   * Handle API response with enhanced error categorization
   */
  private async handleResponse(response: Response): Promise<any> {
    const contentType = response.headers.get('content-type');
    const isJson = contentType?.includes('application/json');
    
    console.log('API Response:', {
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      contentType: contentType,
      isJson: isJson
    });
    
    try {
      const data = isJson ? await response.json() : await response.text();
      
      console.log('API Response Data:', {
        data: data,
        type: typeof data
      });
      
      if (!response.ok) {
        // Handle rate limit errors
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
    
      // Handle authentication errors
      if (response.status === 401) {
        this.clearAuthToken();
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      }
    
      // Extract error message
      let errorMessage = typeof data === 'object' && data.message ? data.message : 'An error occurred';
    
      // Include validation errors in the message if they exist
      if (typeof data === 'object' && data.errors && Array.isArray(data.errors)) {
        const validationErrors = data.errors.map((err: any) => {
          // Handle different error formats
          if (err.msg) return err.msg;
          if (err.message) return err.message;
          if (err.param && err.msg) return `${err.param}: ${err.msg}`;
          return 'Validation error';
        }).join(', ');
      
        // Only add validation errors if they provide additional information
        if (validationErrors && validationErrors !== 'Validation error' && validationErrors !== 'validation error') {
          errorMessage = `${errorMessage}: ${validationErrors}`;
        } else if (validationErrors) {
          // If we only have generic validation errors, use a more descriptive message
          if (validationErrors === 'Validation error' || validationErrors === 'validation error') {
            // If we have a general error message, use it with more context
            if (data.message && data.message !== 'Validation failed') {
              errorMessage = data.message;
            } else {
              errorMessage = 'Validation failed. Please check your input and try again.';
            }
          } else {
            errorMessage = validationErrors;
          }
        }
      }
    
      const category = this.categorizeError(response.status, new Error(errorMessage));
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
    const errorDetails = {
      errorType: typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : undefined,
      errorStack: error instanceof Error ? error.stack : undefined,
      // For ApiError instances
      status: (error as any)?.status,
      url: (error as any)?.url,
      category: (error as any)?.category,
      responseStatus: (error as any)?.responseStatus
    };
    
    // Don't log expected 404 errors for location endpoints (user hasn't set location yet)
    // or category endpoints (category might not exist)
    const isLocationEndpoint = (response as any).url?.includes('/location/current');
    const isCategoryEndpoint = (response as any).url?.includes('/categories/slug/');
    const is404Error = (error as any)?.status === 404 || (response as any).status === 404;
    
    // Also check if the error is an ApiError with 404 status
    const isApiError404 = error instanceof ApiError && error.status === 404;
    
    // Only log non-rate limit errors to reduce console spam
    const isRateLimitError = (error as any)?.status === 429 || (response as any).status === 429;
    
    if ((!isLocationEndpoint && !isCategoryEndpoint) || (!is404Error && !isApiError404)) {
      // Only log non-rate limit errors to reduce console spam
      if (!isRateLimitError) {
        console.error('API Response Error:', errorDetails);
      } else {
        console.warn('Rate limit hit:', errorDetails);
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
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';
      errorMessage = `Network error: Unable to connect to the server at ${API_BASE_URL}. Please make sure the backend server is running. Details: ${errorMessage}`;
    }

    const apiError = new ApiError((response as any).status || 0, errorMessage, (response as any).url || '', category);

    // Add error details for debugging
    apiError.originalError = error;

    throw apiError;
  }
}

/**
 * GET request with retry logic for rate limiting
 */
async get<T>(endpoint: string, options?: RequestInit & { retries?: number, retryDelay?: number, timeout?: number }): Promise<T> {
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';
  const isCompleteUrl = endpoint.startsWith('http://') || endpoint.startsWith('https://');
  const finalUrl = isCompleteUrl ? endpoint : `${API_BASE_URL}${endpoint}`;
  
  console.log('Making GET request to:', finalUrl);
  
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
      
      const fetchOptions = {
        method: 'GET',
        headers: this.getHeaders(options?.headers),
        signal,
        ...options
      };
      
      console.log('Fetch options:', {
        method: fetchOptions.method,
        headers: fetchOptions.headers
      });
      
      const response = await fetch(finalUrl, fetchOptions);
      console.log('Fetch response:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries())
      });
      
      if (timeoutId) clearTimeout(timeoutId);
      
      return await this.handleResponse(response);
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId);
      
      // Handle abort errors specifically
      if (error.name === 'AbortError') {
        // For abort errors, we don't want to throw an ApiError as this creates noise in error tracking
        // Instead, we re-throw the original error which will be caught by the calling function
        // Only log if there's a meaningful reason
        if (error.message && error.message !== 'signal is aborted without reason') {
          console.debug(`Request intentionally aborted for ${finalUrl}: ${error.message}`);
        }
        
        // Don't retry aborted requests, just re-throw the original AbortError
        throw error;
      }
      
      lastError = error;
      
      // If it's a rate limit error and we have retries left, wait and retry
      if (error.status === 429 && i < retries) {
        // Use retry-after header if available, otherwise use default delay with exponential backoff and jitter
        const baseDelay = error.rateLimitInfo?.retryAfter ? error.rateLimitInfo.retryAfter * 1000 : (retryDelay * Math.pow(2, i));
        // Add jitter to prevent thundering herd problem
        const jitter = Math.random() * 0.25 * baseDelay;
        const retryAfter = Math.min(baseDelay + jitter, 60000); // Cap at 60 seconds for location endpoints
        console.log(`Rate limited. Waiting ${Math.round(retryAfter)}ms before retry ${i + 1}/${retries}`);
        
        // Log rate limiting event for monitoring
        rateLimitLogger.logEvent(endpoint, error.rateLimitInfo?.retryAfter || Math.ceil(retryAfter / 1000));
        
        await new Promise(resolve => setTimeout(resolve, retryAfter));
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
 * POST request with retry logic for rate limiting
 */
async post<T>(endpoint: string, data: any, options?: RequestInit & { retries?: number, retryDelay?: number, timeout?: number }): Promise<T> {
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';
  const isCompleteUrl = endpoint.startsWith('http://') || endpoint.startsWith('https://');
  const finalUrl = isCompleteUrl ? endpoint : `${API_BASE_URL}${endpoint}`;
  
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
      
      // Separate headers from other options to prevent conflicts
      const { headers: optionHeaders, ...restOptions } = options || {};
      
      // DEBUG: Log headers being sent
      console.log('API.post() headers debug:', JSON.stringify({
        optionHeaders,
        mergedHeaders: this.getHeaders(optionHeaders)
      }, null, 2));
      
      const fetchOptions = {
        ...restOptions,
        method: 'POST',
        headers: this.getHeaders(optionHeaders),
        body: JSON.stringify(data),
        signal
      };
      
      const response = await fetch(finalUrl, fetchOptions);
      if (timeoutId) clearTimeout(timeoutId);
      
      return await this.handleResponse(response);
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId);
      
      // Handle abort errors specifically
      if (error.name === 'AbortError') {
        // For abort errors, we don't want to throw an ApiError as this creates noise in error tracking
        // Instead, we re-throw the original error which will be caught by the calling function
        // Only log if there's a meaningful reason
        if (error.message && error.message !== 'signal is aborted without reason') {
          console.debug(`Request intentionally aborted for ${finalUrl}: ${error.message}`);
        }
        
        // Don't retry aborted requests, just re-throw the original AbortError
        throw error;
      }
      
      lastError = error;
      
      // If it's a rate limit error and we have retries left, wait and retry
      if (error.status === 429 && i < retries) {
        // Use retry-after header if available, otherwise use default delay with exponential backoff and jitter
        const baseDelay = error.rateLimitInfo?.retryAfter ? error.rateLimitInfo.retryAfter * 1000 : (retryDelay * Math.pow(2, i));
        // Add jitter to prevent thundering herd problem
        const jitter = Math.random() * 0.25 * baseDelay;
        const retryAfter = Math.min(baseDelay + jitter, 60000); // Cap at 60 seconds for location endpoints
        console.log(`Rate limited. Waiting ${Math.round(retryAfter)}ms before retry ${i + 1}/${retries}`);
        
        // Log rate limiting event for monitoring
        rateLimitLogger.logEvent(endpoint, error.rateLimitInfo?.retryAfter || Math.ceil(retryAfter / 1000));
        
        await new Promise(resolve => setTimeout(resolve, retryAfter));
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
 * PUT request with retry logic for rate limiting
 */
async put<T>(endpoint: string, data: any, options?: RequestInit & { retries?: number, retryDelay?: number, timeout?: number }): Promise<T> {
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';
  const isCompleteUrl = endpoint.startsWith('http://') || endpoint.startsWith('https://');
  const finalUrl = isCompleteUrl ? endpoint : `${API_BASE_URL}${endpoint}`;
  
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
      
      // Separate headers from other options to prevent conflicts
      const { headers: optionHeaders, ...restOptions } = options || {};
      
      const fetchOptions = {
        ...restOptions,
        method: 'PUT',
        headers: this.getHeaders(optionHeaders),
        body: JSON.stringify(data),
        signal
      };
      
      const response = await fetch(finalUrl, fetchOptions);
      if (timeoutId) clearTimeout(timeoutId);
      
      return await this.handleResponse(response);
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId);
      
      // Handle abort errors specifically
      if (error.name === 'AbortError') {
        // For abort errors, we don't want to throw an ApiError as this creates noise in error tracking
        // Instead, we re-throw the original error which will be caught by the calling function
        // Only log if there's a meaningful reason
        if (error.message && error.message !== 'signal is aborted without reason') {
          console.debug(`Request intentionally aborted for ${finalUrl}: ${error.message}`);
        }
        
        // Don't retry aborted requests, just re-throw the original AbortError
        throw error;
      }
      
      lastError = error;
      
      // If it's a rate limit error and we have retries left, wait and retry
      if (error.status === 429 && i < retries) {
        // Use retry-after header if available, otherwise use default delay with exponential backoff and jitter
        const baseDelay = error.rateLimitInfo?.retryAfter ? error.rateLimitInfo.retryAfter * 1000 : (retryDelay * Math.pow(2, i));
        // Add jitter to prevent thundering herd problem
        const jitter = Math.random() * 0.25 * baseDelay;
        const retryAfter = Math.min(baseDelay + jitter, 60000); // Cap at 60 seconds for location endpoints
        console.log(`Rate limited. Waiting ${Math.round(retryAfter)}ms before retry ${i + 1}/${retries}`);
        
        // Log rate limiting event for monitoring
        rateLimitLogger.logEvent(endpoint, error.rateLimitInfo?.retryAfter || Math.ceil(retryAfter / 1000));
        
        await new Promise(resolve => setTimeout(resolve, retryAfter));
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
 * DELETE request with retry logic for rate limiting
 */
async delete<T>(endpoint: string, options?: RequestInit & { retries?: number, retryDelay?: number, timeout?: number }): Promise<T> {
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';
  const isCompleteUrl = endpoint.startsWith('http://') || endpoint.startsWith('https://');
  const finalUrl = isCompleteUrl ? endpoint : `${API_BASE_URL}${endpoint}`;
  
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
      
      // Separate headers from other options to prevent conflicts
      const { headers: optionHeaders, ...restOptions } = options || {};
      
      const fetchOptions = {
        ...restOptions,
        method: 'DELETE',
        headers: this.getHeaders(optionHeaders),
        signal
      };
      
      const response = await fetch(finalUrl, fetchOptions);
      if (timeoutId) clearTimeout(timeoutId);
      
      return await this.handleResponse(response);
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId);
      
      // Handle abort errors specifically
      if (error.name === 'AbortError') {
        // For abort errors, we don't want to throw an ApiError as this creates noise in error tracking
        // Instead, we re-throw the original error which will be caught by the calling function
        // Only log if there's a meaningful reason
        if (error.message && error.message !== 'signal is aborted without reason') {
          console.debug(`Request intentionally aborted for ${finalUrl}: ${error.message}`);
        }
        
        // Don't retry aborted requests, just re-throw the original AbortError
        throw error;
      }
      
      lastError = error;
      
      // If it's a rate limit error and we have retries left, wait and retry
      if (error.status === 429 && i < retries) {
        // Use retry-after header if available, otherwise use default delay with exponential backoff and jitter
        const baseDelay = error.rateLimitInfo?.retryAfter ? error.rateLimitInfo.retryAfter * 1000 : (retryDelay * Math.pow(2, i));
        // Add jitter to prevent thundering herd problem
        const jitter = Math.random() * 0.25 * baseDelay;
        const retryAfter = Math.min(baseDelay + jitter, 60000); // Cap at 60 seconds for location endpoints
        console.log(`Rate limited. Waiting ${Math.round(retryAfter)}ms before retry ${i + 1}/${retries}`);
        
        // Log rate limiting event for monitoring
        rateLimitLogger.logEvent(endpoint, error.rateLimitInfo?.retryAfter || Math.ceil(retryAfter / 1000));
        
        await new Promise(resolve => setTimeout(resolve, retryAfter));
        continue;
      }
      
      // For all other errors or if we're out of retries, throw the error
      throw error;
    }
  }
  
  // If we get here, we've exhausted all retries
  throw lastError;
}
}

// Create and export singleton instance
const apiClient = new APIClient();

// Export the instance as default
export default apiClient;

// Export classes and enums for external use
export { ApiError, ErrorCategory };
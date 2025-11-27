// API Client for Autobacs India Backend
// Handles all API communication with the Express backend
// Updated to fix rate limit issues

// API utility functions with retry logic and error handling

interface FetchOptions extends RequestInit {
  retries?: number;
  retryDelay?: number;
  timeout?: number;
}

interface RateLimitInfo {
  retryAfter?: number;  // Seconds until retry allowed
  resetTime?: number;   // Timestamp when rate limit resets
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public url: string,
    public category?: string,
    public rateLimitInfo?: RateLimitInfo
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Enhanced error categorization
export enum ErrorCategory {
  NETWORK = 'network',
  CLIENT = 'client',
  SERVER = 'server',
  TIMEOUT = 'timeout',
  PARSING = 'parsing',
  AUTH = 'auth'
}

// Storage key for JWT token
const TOKEN_KEY = 'autobacs_auth_token';

/**
 * API Client class for managing all backend communications
 */
export class APIClient {
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
    if (error instanceof TypeError && error.message.includes('fetch')) {
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
    if (error instanceof DOMException && error.name === 'AbortError') {
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
          
          // Don't retry rate limit errors
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
        (apiError as any).rawData = data;
        (apiError as any).responseStatus = response.status;
      
        throw apiError;
      }
      
      return data;
    } catch (error) {
      console.error('API Response Error:', {
        error: error,
        name: error?.name,
        message: error?.message,
        stack: error?.stack
      });
      
      // Handle parsing errors
      if (error instanceof SyntaxError) {
        throw new ApiError(0, 'Invalid response format', response.url, ErrorCategory.PARSING);
      }
  
      // Re-throw ApiError instances
      if (error instanceof ApiError) {
        throw error;
      }
  
      // Handle other errors with more context
      const category = this.categorizeError(response.status, error);
      let errorMessage = 'An unknown error occurred';
  
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
  
      // Add more context for network errors
      if (category === ErrorCategory.NETWORK) {
        errorMessage = `Network error: Unable to connect to the server. Please make sure the backend server is running on port 5001. Details: ${errorMessage}`;
      }
  
      const apiError = new ApiError(response.status || 0, errorMessage, response.url || '', category);
  
      // Add error details for debugging
      (apiError as any).originalError = error;
  
      throw apiError;
    }
  }

  /**
   * GET request
   */
  async get<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';
    const isCompleteUrl = endpoint.startsWith('http://') || endpoint.startsWith('https://');
    const finalUrl = isCompleteUrl ? endpoint : `${API_BASE_URL}${endpoint}`;
    const response = await fetch(finalUrl, {
      method: 'GET',
      headers: this.getHeaders(options?.headers),
      ...options
    });

    return this.handleResponse(response);
  }

  /**
   * POST request
   */
  async post<T>(endpoint: string, data: any, options?: RequestInit): Promise<T> {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';
    const isCompleteUrl = endpoint.startsWith('http://') || endpoint.startsWith('https://');
    const finalUrl = isCompleteUrl ? endpoint : `${API_BASE_URL}${endpoint}`;
    const response = await fetch(finalUrl, {
      method: 'POST',
      headers: this.getHeaders(options?.headers),
      body: JSON.stringify(data),
      ...options
    });

    return this.handleResponse(response);
  }

  /**
   * PUT request
   */
  async put<T>(endpoint: string, data: any, options?: RequestInit): Promise<T> {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';
    const isCompleteUrl = endpoint.startsWith('http://') || endpoint.startsWith('https://');
    const finalUrl = isCompleteUrl ? endpoint : `${API_BASE_URL}${endpoint}`;
    const response = await fetch(finalUrl, {
      method: 'PUT',
      headers: this.getHeaders(options?.headers),
      body: JSON.stringify(data),
      ...options
    });

    return this.handleResponse(response);
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';
    const isCompleteUrl = endpoint.startsWith('http://') || endpoint.startsWith('https://');
    const finalUrl = isCompleteUrl ? endpoint : `${API_BASE_URL}${endpoint}`;
    const response = await fetch(finalUrl, {
      method: 'DELETE',
      headers: this.getHeaders(options?.headers),
      ...options
    });

    return this.handleResponse(response);
  }
}

// Create and export singleton instance
const apiClient = new APIClient();

// Export the instance as default
export default apiClient;

// Export classes and enums for external use
export { ApiError, ErrorCategory };

// Export individual functions for backward compatibility
// export { apiGet, apiPost, apiPut, apiDelete, fetchWithRetry }; // Commented out to avoid conflicts
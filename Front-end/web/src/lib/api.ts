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
      console.error('API Response Error:', {
        error: error,
        name: (error as any)?.name,
        message: (error as any)?.message,
        stack: (error as any)?.stack
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
        errorMessage = `Network error: Unable to connect to the server. Please make sure the backend server is running on port 5002. Details: ${errorMessage}`;
      }
  
      const apiError = new ApiError(response.status || 0, errorMessage, response.url || '', category);
  
      // Add error details for debugging
      apiError.originalError = error;
  
      throw apiError;
    }
  }

  /**
   * GET request with retry logic for rate limiting
   */
  async get<T>(endpoint: string, options?: RequestInit & { retries?: number, retryDelay?: number }): Promise<T> {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5002';
    const isCompleteUrl = endpoint.startsWith('http://') || endpoint.startsWith('https://');
    const finalUrl = isCompleteUrl ? endpoint : `${API_BASE_URL}${endpoint}`;
    
    // Default retry settings
    const retries = options?.retries ?? 3;
    const retryDelay = options?.retryDelay ?? 1000; // 1 second default
    
    let lastError: any;
    
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch(finalUrl, {
          method: 'GET',
          headers: this.getHeaders(options?.headers),
          ...options
        });

        return await this.handleResponse(response);
      } catch (error: any) {
        lastError = error;
        
        // If it's a rate limit error and we have retries left, wait and retry
        if (error.status === 429 && i < retries) {
          // Use retry-after header if available, otherwise use default delay with exponential backoff
          const retryAfter = error.rateLimitInfo?.retryAfter || (retryDelay * Math.pow(2, i));
          console.log(`Rate limited. Waiting ${retryAfter}ms before retry ${i + 1}/${retries}`);
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
  async post<T>(endpoint: string, data: any, options?: RequestInit & { retries?: number, retryDelay?: number }): Promise<T> {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5002';
    const isCompleteUrl = endpoint.startsWith('http://') || endpoint.startsWith('https://');
    const finalUrl = isCompleteUrl ? endpoint : `${API_BASE_URL}${endpoint}`;
    
    // Default retry settings
    const retries = options?.retries ?? 3;
    const retryDelay = options?.retryDelay ?? 1000; // 1 second default
    
    let lastError: any;
    
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch(finalUrl, {
          method: 'POST',
          headers: this.getHeaders(options?.headers),
          body: JSON.stringify(data),
          ...options
        });

        return await this.handleResponse(response);
      } catch (error: any) {
        lastError = error;
        
        // If it's a rate limit error and we have retries left, wait and retry
        if (error.status === 429 && i < retries) {
          // Use retry-after header if available, otherwise use default delay with exponential backoff
          const retryAfter = error.rateLimitInfo?.retryAfter || (retryDelay * Math.pow(2, i));
          console.log(`Rate limited. Waiting ${retryAfter}ms before retry ${i + 1}/${retries}`);
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
  async put<T>(endpoint: string, data: any, options?: RequestInit & { retries?: number, retryDelay?: number }): Promise<T> {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5002';
    const isCompleteUrl = endpoint.startsWith('http://') || endpoint.startsWith('https://');
    const finalUrl = isCompleteUrl ? endpoint : `${API_BASE_URL}${endpoint}`;
    
    // Default retry settings
    const retries = options?.retries ?? 3;
    const retryDelay = options?.retryDelay ?? 1000; // 1 second default
    
    let lastError: any;
    
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch(finalUrl, {
          method: 'PUT',
          headers: this.getHeaders(options?.headers),
          body: JSON.stringify(data),
          ...options
        });

        return await this.handleResponse(response);
      } catch (error: any) {
        lastError = error;
        
        // If it's a rate limit error and we have retries left, wait and retry
        if (error.status === 429 && i < retries) {
          // Use retry-after header if available, otherwise use default delay with exponential backoff
          const retryAfter = error.rateLimitInfo?.retryAfter || (retryDelay * Math.pow(2, i));
          console.log(`Rate limited. Waiting ${retryAfter}ms before retry ${i + 1}/${retries}`);
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
  async delete<T>(endpoint: string, options?: RequestInit & { retries?: number, retryDelay?: number }): Promise<T> {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5002';
    const isCompleteUrl = endpoint.startsWith('http://') || endpoint.startsWith('https://');
    const finalUrl = isCompleteUrl ? endpoint : `${API_BASE_URL}${endpoint}`;
    
    // Default retry settings
    const retries = options?.retries ?? 3;
    const retryDelay = options?.retryDelay ?? 1000; // 1 second default
    
    let lastError: any;
    
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch(finalUrl, {
          method: 'DELETE',
          headers: this.getHeaders(options?.headers),
          ...options
        });

        return await this.handleResponse(response);
      } catch (error: any) {
        lastError = error;
        
        // If it's a rate limit error and we have retries left, wait and retry
        if (error.status === 429 && i < retries) {
          // Use retry-after header if available, otherwise use default delay with exponential backoff
          const retryAfter = error.rateLimitInfo?.retryAfter || (retryDelay * Math.pow(2, i));
          console.log(`Rate limited. Waiting ${retryAfter}ms before retry ${i + 1}/${retries}`);
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
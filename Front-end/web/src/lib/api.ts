// API Client for Autobacs India Backend
// Handles all API communication with the Express backend

// API utility functions with retry logic and error handling

interface FetchOptions extends RequestInit {
  retries?: number;
  retryDelay?: number;
  timeout?: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public url: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const fetchWithRetry = async (
  url: string,
  options: FetchOptions = {}
): Promise<Response> => {
  const {
    retries = 3,
    retryDelay = 1000,
    timeout = 10000,
    ...fetchOptions
  } = options;

  // Add timeout to fetch request
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  // Merge signal with existing signal if provided
  const signal = controller.signal;
  if (fetchOptions.signal) {
    const originalSignal = fetchOptions.signal;
    originalSignal.addEventListener('abort', () => controller.abort());
  }
  
  fetchOptions.signal = signal;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, fetchOptions);
      
      clearTimeout(timeoutId);
      
      // Check if response is ok
      if (response.ok) {
        return response;
      }
      
      // For 5xx errors, we might want to retry
      if (response.status >= 500 && response.status < 600 && attempt < retries) {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
        continue;
      }
      
      // For other errors, throw an ApiError
      const errorText = await response.text();
      throw new ApiError(response.status, errorText || response.statusText, url);
    } catch (error) {
      clearTimeout(timeoutId);
      
      // If this is the last attempt, re-throw the error
      if (attempt === retries) {
        if (error instanceof ApiError) {
          throw error;
        }
        
        // Wrap other errors in a generic ApiError
        throw new ApiError(
          0,
          error instanceof Error ? error.message : String(error),
          url
        );
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
    }
  }
  
  // This should never be reached, but TypeScript needs it
  throw new Error('Unexpected error in fetchWithRetry');
};

// Helper function for GET requests
export const apiGet = async <T>(url: string, options: FetchOptions = {}): Promise<T> => {
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });
  
  return response.json();
};

// Helper function for POST requests
export const apiPost = async <T>(url: string, data: any, options: FetchOptions = {}): Promise<T> => {
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    body: JSON.stringify(data),
    ...options
  });
  
  return response.json();
};

// Helper function for PUT requests
export const apiPut = async <T>(url: string, data: any, options: FetchOptions = {}): Promise<T> => {
  const response = await fetchWithRetry(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    body: JSON.stringify(data),
    ...options
  });
  
  return response.json();
};

// Helper function for DELETE requests
export const apiDelete = async <T>(url: string, options: FetchOptions = {}): Promise<T> => {
  const response = await fetchWithRetry(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });
  
  return response.json();
};

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
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return headers;
  }

  /**
   * Handle API response
   */
  private async handleResponse(response: Response): Promise<any> {
    const contentType = response.headers.get('content-type');
    const isJson = contentType?.includes('application/json');
    const data = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      // Handle authentication errors
      if (response.status === 401) {
        this.clearAuthToken();
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      }

      // Extract error message
      const errorMessage = typeof data === 'object' && data.message ? data.message : 'An error occurred';
      throw new Error(errorMessage);
    }

    return data;
  }

  /**
   * GET request
   */
  async get<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
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
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
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
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
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
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
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

// Export individual functions for backward compatibility
export { apiGet, apiPost, apiPut, apiDelete, fetchWithRetry };
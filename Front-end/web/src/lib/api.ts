// API Client for Autobacs India Backend
// Handles all API communication with the Express backend
// Updated to fix rate limit issues

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
   * Handle API response
   */
  private async handleResponse(response: Response): Promise<any> {
    const contentType = response.headers.get('content-type');
    const isJson = contentType?.includes('application/json');
    const data = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      // Handle rate limit errors
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const resetTime = retryAfter ? Date.now() + (parseInt(retryAfter) * 1000) : Date.now() + 60000; // Default to 1 minute
        
        // Don't retry rate limit errors
        const errorMessage = typeof data === 'object' && data.message ? data.message : 'Too many requests, please try again later';
        throw new ApiError(response.status, errorMessage, response.url);
      }
      
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

// Export individual functions for backward compatibility
// export { apiGet, apiPost, apiPut, apiDelete, fetchWithRetry }; // Commented out to avoid conflicts
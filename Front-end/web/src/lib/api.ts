// API Client for Autobacs India Backend
// Handles all API communication with the Express backend

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

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
  setAuthToken(token: string) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem(TOKEN_KEY, token);
    }
  }

  /**
   * Clear authentication token
   */
  clearAuthToken() {
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
      ...customHeaders,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return headers;
  }

  /**
   * Handle API response
   */
  private async handleResponse(response: Response) {
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
      const errorMessage = typeof data === 'object' && data.message
        ? data.message
        : 'An error occurred';

      throw new Error(errorMessage);
    }

    return data;
  }

  /**
   * GET request
   */
  async get(endpoint: string, options?: RequestInit) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'GET',
      headers: this.getHeaders(options?.headers),
      ...options,
    });

    return this.handleResponse(response);
  }

  /**
   * POST request
   */
  async post(endpoint: string, data?: any, options?: RequestInit) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: this.getHeaders(options?.headers),
      body: JSON.stringify(data),
      ...options,
    });

    return this.handleResponse(response);
  }

  /**
   * PUT request
   */
  async put(endpoint: string, data?: any, options?: RequestInit) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'PUT',
      headers: this.getHeaders(options?.headers),
      body: JSON.stringify(data),
      ...options,
    });

    return this.handleResponse(response);
  }

  /**
   * DELETE request
   */
  async delete(endpoint: string, options?: RequestInit) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'DELETE',
      headers: this.getHeaders(options?.headers),
      ...options,
    });

    return this.handleResponse(response);
  }
}

// Export singleton instance
export const apiClient = new APIClient();

// Named exports for convenience
export const {
  get: apiGet,
  post: apiPost,
  put: apiPut,
  delete: apiDelete,
} = apiClient;

export default apiClient;

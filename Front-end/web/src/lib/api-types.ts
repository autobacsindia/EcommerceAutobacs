/**
 * Shared API types — safe to import in both browser and server environments.
 * No runtime browser APIs (localStorage, document, window) are used here.
 */

export interface FetchOptions extends RequestInit {
  retries?: number;
  retryDelay?: number;
  timeout?: number;
  params?: Record<string, any>;
}

export interface RateLimitInfo {
  retryAfter?: number; // Seconds until retry allowed
  resetTime?: number;  // Timestamp when rate limit resets
}

/**
 * Standardized error shape returned by all services
 */
export interface ServiceError {
  message: string;
  code?: string;
  status: number;
  category?: ErrorCategory;
  details?: Record<string, any>;
}

export class ApiError extends Error {
  status: number;
  url: string;
  category?: string;
  rateLimitInfo?: RateLimitInfo;
  rawData?: any;
  responseStatus?: number;
  originalError?: any;
  code?: string; // Backend error code for consistent error handling

  constructor(
    status: number,
    message: string,
    url: string,
    category?: string,
    rateLimitInfo?: RateLimitInfo,
    code?: string
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.category = category;
    this.rateLimitInfo = rateLimitInfo;
    this.code = code;
  }

  /**
   * Convert ApiError to standardized ServiceError shape
   */
  toServiceError(): ServiceError {
    return {
      message: this.message,
      code: this.code,
      status: this.status,
      category: this.category as ErrorCategory,
      details: this.rawData
    };
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

/**
 * Request interceptor configuration
 */
export interface RequestInterceptor {
  onRequest?: (config: {
    method: string;
    endpoint: string;
    data: any;
    headers: HeadersInit;
  }) => Promise<{ method: string; endpoint: string; data: any; headers: HeadersInit }>;
  onError?: (error: any) => Promise<any>;
}

/**
 * Response interceptor configuration
 */
export interface ResponseInterceptor {
  onResponse?: (response: any) => Promise<any>;
  onError?: (error: any) => Promise<any>;
}

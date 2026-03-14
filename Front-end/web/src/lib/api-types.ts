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

export class ApiError extends Error {
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
export enum ErrorCategory {
  NETWORK = 'network',
  CLIENT = 'client',
  SERVER = 'server',
  TIMEOUT = 'timeout',
  PARSING = 'parsing',
  AUTH = 'auth'
}

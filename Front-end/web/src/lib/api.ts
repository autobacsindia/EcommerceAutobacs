/**
 * @file api.ts — barrel re-export
 *
 * Keeps all existing imports working unchanged:
 *   import apiClient from '@/lib/api';                        // browser APIClient singleton
 *   import { ApiError, ErrorCategory } from '@/lib/api';     // shared types
 *   import { getServerApiBase } from '@/lib/api';             // server-side URL helper
 *
 * For new code, prefer importing directly from the focused modules:
 *   import apiClient from '@/lib/api-client';                 // browser only
 *   import { getServerApiBase, serverFetch } from '@/lib/server-api'; // server only
 *   import { ApiError, ErrorCategory } from '@/lib/api-types'; // shared
 */

// Browser-only client (default export + named types)
export { default, ApiError, ErrorCategory } from './api-client';
export type { FetchOptions, RateLimitInfo } from './api-types';

// Server-side utilities
export { getServerApiBase, serverFetch } from './server-api';

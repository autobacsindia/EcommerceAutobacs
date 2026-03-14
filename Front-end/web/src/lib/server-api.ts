/**
 * Server-side API utilities.
 *
 * Intentionally has NO 'use client' directive — this file is server-safe and
 * must never import browser-only modules (localStorage, document, window, etc.).
 *
 * Use getServerApiBase() in:
 *   - Server Components
 *   - generateMetadata()
 *   - sitemap.ts / robots.ts
 *
 * Use serverFetch() as a thin, typed wrapper around the native fetch for the
 * same server-side contexts.
 */

/**
 * Resolves the versioned backend base URL for server-side fetch calls.
 *
 * - Browser (fallback): returns relative '/api/v1' — should not normally be
 *   called client-side, but safe if it is.
 * - Server (Node.js): reads NEXT_PUBLIC_API_URL, normalises the path, and
 *   appends /api/v1. Node.js cannot resolve relative paths, so an absolute
 *   URL pointing directly at the backend is required.
 */
export function getServerApiBase(): string {
  if (typeof window !== 'undefined') {
    // Should not normally be called client-side; return relative path as safe fallback
    return '/api/v1';
  }
  const raw = (process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api(\/v1)?$/, '');
  // Prefer 127.0.0.1 over localhost to avoid Node.js IPv6 resolution issues
  return `${raw.replace('localhost', '127.0.0.1')}/api/v1`;
}

interface ServerFetchOptions extends RequestInit {
  /** Optional bearer token for authenticated SSR requests. */
  token?: string;
  /** Next.js cache/revalidation config. */
  next?: NextFetchRequestConfig;
}

/**
 * Thin fetch wrapper for server components and SSG/SSR helpers.
 *
 * Differences from the browser APIClient:
 *   - No retries (server-side failures should surface immediately)
 *   - No token storage (tokens belong to the browser session)
 *   - No rate-limit logging
 *   - Throws a plain Error on non-OK responses (no ApiError needed server-side)
 */
export async function serverFetch<T>(
  path: string,
  options?: ServerFetchOptions
): Promise<T> {
  const url = `${getServerApiBase()}${path}`;

  const { token, next, ...rest } = options ?? {};

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(rest.headers as Record<string, string> | undefined),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(url, {
    ...rest,
    headers,
    ...(next ? { next } : {}),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.message) detail = body.message;
    } catch {
      // ignore parse error — use statusText
    }
    throw new Error(`[serverFetch] ${res.status} ${detail} — ${url}`);
  }

  return res.json() as Promise<T>;
}

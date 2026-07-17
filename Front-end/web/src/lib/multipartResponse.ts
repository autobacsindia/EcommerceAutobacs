/**
 * Helpers for raw `fetch` responses (multipart uploads that bypass the JSON
 * apiClient). Unlike apiClient, these responses can be **non-JSON**: a proxy
 * (Vercel / Railway edge) may reject an oversized body with a plain-text
 * `Request Entity Too Large` before the request ever reaches the backend.
 * Calling `res.json()` on that throws `Unexpected token 'R'...`, which masks
 * the real problem. Parse defensively and surface a precise message instead.
 */

export interface ApiResponseBody {
  message?: string;
  error?: string;
  [key: string]: unknown;
}

/** Read `token` / `XSRF-TOKEN` from cookies (browser only). */
function readAuthCookies(): { token: string; csrfToken: string } {
  if (typeof document === 'undefined') return { token: '', csrfToken: '' };
  return {
    token:     document.cookie.match(/(?:^|;\s*)token=([^;]*)/)?.[1] ?? '',
    csrfToken: document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/)?.[1] ?? '',
  };
}

/**
 * POST/PUT a multipart FormData body to an admin API route with the auth +
 * CSRF headers the raw-fetch path needs (apiClient can't be used because it
 * JSON-serializes). Returns the raw Response — pair with `parseApiResponse`.
 */
export function submitMultipart(
  url: string,
  method: 'POST' | 'PUT',
  body: FormData,
): Promise<Response> {
  const { token, csrfToken } = readAuthCookies();
  return fetch(url, {
    method,
    headers: {
      ...(token     ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken ? { 'X-XSRF-TOKEN': decodeURIComponent(csrfToken) } : {}),
    },
    credentials: 'include',
    body,
  });
}

/** Read the body once and JSON-parse it only if it actually is JSON. */
export async function parseApiResponse(res: Response): Promise<ApiResponseBody> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as ApiResponseBody;
  } catch {
    // Non-JSON body (e.g. an upstream proxy error page). Keep the raw text so
    // the caller can still show something, trimmed to avoid dumping HTML.
    return { message: text.slice(0, 200).trim() };
  }
}

/**
 * Build a user-facing error message from a non-OK response. Special-cases the
 * 413 body-limit case since it's the common upload failure and its raw text is
 * opaque to admins.
 */
export function errorMessage(
  res: Response,
  data: ApiResponseBody,
  fallback: string,
): string {
  if (res.status === 413) {
    return 'Upload too large. The file(s) exceed the ~4 MB request limit — compress the images (or split the CSV) and try again.';
  }
  return data.message || data.error || `${fallback} (HTTP ${res.status}).`;
}

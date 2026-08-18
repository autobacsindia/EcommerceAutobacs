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
  /**
   * Per-field validation detail from the backend error middleware, keyed by
   * schema path (e.g. `{ 'seo.canonical': 'Path `canonical` … is longer …' }`).
   */
  errors?: Record<string, string>;
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

/** Cap the appended field detail so one bad payload can't produce a wall of text. */
const MAX_FIELD_ERRORS = 5;

/**
 * Flatten the backend's per-field validation map into readable lines.
 *
 * This detail is the whole reason a failed admin save is actionable. The backend
 * deliberately whitelists `message` down to the bare string "Validation Error"
 * (it refuses to echo raw model errors as the top-level message), so `errors` is
 * the ONLY place naming the offending field — and dropping it left admins with an
 * `alert("Validation Error")` and no way to know what to fix.
 */
function fieldErrorDetail(data: ApiResponseBody): string {
  const entries = Object.entries(data.errors ?? {}).filter(
    ([, msg]) => typeof msg === 'string' && msg.trim(),
  );
  if (!entries.length) return '';

  const shown = entries
    .slice(0, MAX_FIELD_ERRORS)
    .map(([field, msg]) => `• ${field}: ${msg}`);
  const hidden = entries.length - shown.length;
  if (hidden > 0) shown.push(`• …and ${hidden} more field${hidden === 1 ? '' : 's'}.`);

  return `\n\n${shown.join('\n')}`;
}

/**
 * Build a user-facing error message from a non-OK response. Special-cases the
 * 413 body-limit case since it's the common upload failure and its raw text is
 * opaque to admins, and appends per-field validation detail when the backend
 * sent any.
 */
export function errorMessage(
  res: Response,
  data: ApiResponseBody,
  fallback: string,
): string {
  if (res.status === 413) {
    return 'Upload too large. The file(s) exceed the ~4 MB request limit — compress the images (or split the CSV) and try again.';
  }
  const base = data.message || data.error || `${fallback} (HTTP ${res.status}).`;
  return `${base}${fieldErrorDetail(data)}`;
}

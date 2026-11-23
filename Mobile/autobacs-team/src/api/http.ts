/**
 * The HTTP core: no Expo imports, every dependency injected, so tests drive it
 * with a fake fetch and an in-memory token store (tests/client.test.ts).
 * `client.ts` wires the real dependencies.
 *
 * Rules it enforces:
 * - Every failure is an ApiError with ONE person-readable sentence.
 *   status 0 = offline / timed out (code OFFLINE).
 * - 401 → one silent refresh (POST /auth/refresh), then one replay. If that
 *   fails the session is over: `onSignedOut` fires (the app goes to Login) and
 *   the error carries code SIGNED_OUT. Auth failure is never treated as success.
 * - Writes carry a CSRF token from /csrf-token (the server exempts Bearer
 *   requests but cookie sessions need it). A 403 with no code = stale token →
 *   refetch once and replay.
 * - A 404 "Route not found" (or 501) means the endpoint is not deployed yet:
 *   code NOT_AVAILABLE, so screens can show "coming soon" instead of an error.
 *   A 404 from a REAL route (e.g. "profile not set up") keeps its own message.
 */

export class ApiError extends Error {
  status: number;
  code?: string;
  /** Extra fields from the server's error body (distanceM, attemptsLeft, allowedTypes…). */
  extra: Record<string, unknown>;
  constructor(message: string, status: number, code?: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
  get offline(): boolean {
    return this.status === 0;
  }
  get notAvailable(): boolean {
    return this.code === 'NOT_AVAILABLE';
  }
  /** Worth retrying later without changing anything (network, server busy). */
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export const OFFLINE_MESSAGE = 'No internet connection. Your phone will try again.';
export const NOT_AVAILABLE_MESSAGE = 'This part of the app is not switched on yet.';
export const SIGNED_OUT_MESSAGE = 'Please sign in again.';

/**
 * `signedIn` is true for a cookie session too (no Bearer pair in the body), so
 * the app knows someone is signed in even when it holds no token itself.
 */
export type TokenPair = { accessToken: string | null; refreshToken: string | null; signedIn: boolean };
const EMPTY: TokenPair = { accessToken: null, refreshToken: null, signedIn: false };

export type TokenStore = {
  load(): Promise<TokenPair>;
  save(pair: TokenPair): Promise<void>;
};

export type HttpDeps = {
  baseUrl: string;
  fetch: typeof fetch;
  tokens: TokenStore;
  /** Called once when the session is definitely over (refresh refused). */
  onSignedOut?: () => void;
  timeoutMs?: number;
  uploadTimeoutMs?: number;
};

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type RequestOptions = {
  method?: Method;
  body?: unknown;
  form?: FormData;
  /** Skip the refresh-and-replay step (login and refresh themselves). */
  noAuthRetry?: boolean;
};

const AUTH_FREE = ['/auth/login', '/auth/refresh', '/csrf-token'];

export function createHttp(deps: HttpDeps) {
  const timeoutMs = deps.timeoutMs ?? 20_000;
  const uploadTimeoutMs = deps.uploadTimeoutMs ?? 60_000;
  let pair: TokenPair = EMPTY;
  let loaded = false;
  let csrf: string | null = null;
  let refreshing: Promise<boolean> | null = null;

  async function tokens(): Promise<TokenPair> {
    if (!loaded) {
      try {
        pair = await deps.tokens.load();
      } catch {
        pair = EMPTY;
      }
      loaded = true;
    }
    return pair;
  }

  async function setTokens(next: TokenPair): Promise<void> {
    pair = next;
    loaded = true;
    csrf = null;
    try {
      await deps.tokens.save(next);
    } catch {
      // Not fatal: the in-memory copy still works for this launch.
    }
  }

  async function raw(path: string, init: RequestInit, ms: number): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await deps.fetch(`${deps.baseUrl}${path}`, { ...init, credentials: 'include', signal: ctrl.signal });
    } catch {
      // Network down, DNS, TLS, or our own timeout: all mean "try again later".
      throw new ApiError(OFFLINE_MESSAGE, 0, 'OFFLINE');
    } finally {
      clearTimeout(timer);
    }
  }

  async function getCsrf(force: boolean): Promise<string | null> {
    if (csrf && !force) return csrf;
    try {
      const res = await raw('/csrf-token', { headers: { Accept: 'application/json' } }, timeoutMs);
      if (!res.ok) return null;
      const data = (await res.json()) as { csrfToken?: string };
      csrf = data.csrfToken ?? null;
    } catch {
      csrf = null; // the write is still attempted; the server decides
    }
    return csrf;
  }

  /** One refresh at a time; concurrent 401s share it. */
  function refresh(): Promise<boolean> {
    if (!refreshing) {
      refreshing = (async () => {
        const { refreshToken } = await tokens();
        try {
          const res = await raw(
            '/auth/refresh',
            {
              method: 'POST',
              headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify(refreshToken ? { refreshToken } : {}),
            },
            timeoutMs,
          );
          if (!res.ok) return false;
          const data = (await parse(res)) as { accessToken?: string; refreshToken?: string } | null;
          if (data?.accessToken) {
            await setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken ?? refreshToken, signedIn: true });
          }
          return true;
        } catch {
          return false;
        }
      })().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  async function parse(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function toError(res: Response, data: unknown): ApiError {
    const payload = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const { message, code, success: _s, ...extra } = payload;
    const msg = typeof message === 'string' ? message : '';
    if (res.status === 501 || (res.status === 404 && (data === null || /^route not found/i.test(msg)))) {
      return new ApiError(NOT_AVAILABLE_MESSAGE, res.status, 'NOT_AVAILABLE');
    }
    const fallback =
      res.status >= 500
        ? 'Our server had a problem. Please try again in a minute.'
        : res.status === 429
          ? 'Too many tries. Please wait a minute and try again.'
          : `Something went wrong (${res.status}).`;
    return new ApiError(msg || fallback, res.status, typeof code === 'string' ? code : undefined, extra);
  }

  async function request<T>(path: string, options: RequestOptions = {}, attempt = { csrf: false, auth: false }): Promise<T> {
    const { method = 'GET', body, form } = options;
    const writes = method !== 'GET';
    const { accessToken } = await tokens();

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (writes) {
      const t = await getCsrf(attempt.csrf);
      if (t) headers['X-XSRF-TOKEN'] = t;
    }

    const res = await raw(
      path,
      { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) },
      form ? uploadTimeoutMs : timeoutMs,
    );
    const data = await parse(res);
    const code = (data as { code?: unknown } | null)?.code;

    if (res.status === 403 && writes && !attempt.csrf && !code) {
      return request<T>(path, options, { ...attempt, csrf: true });
    }

    if (res.status === 401 && !options.noAuthRetry && !AUTH_FREE.includes(path)) {
      if (!attempt.auth && (await refresh())) {
        return request<T>(path, options, { ...attempt, auth: true });
      }
      await setTokens(EMPTY);
      deps.onSignedOut?.();
      throw new ApiError(SIGNED_OUT_MESSAGE, 401, 'SIGNED_OUT');
    }

    if (!res.ok) throw toError(res, data);
    return (data ?? {}) as T;
  }

  return {
    request,
    setTokens,
    clearTokens: () => setTokens(EMPTY),
    isSignedIn: async () => {
      const t = await tokens();
      return t.signedIn || !!t.accessToken;
    },
    /** For file downloads that need the same auth header. */
    authHeader: async (): Promise<Record<string, string>> => {
      const { accessToken } = await tokens();
      return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
    },
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
    del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
    upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', form }),
  };
}

export type Http = ReturnType<typeof createHttp>;

/** One plain sentence for any thrown thing. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong. Please try again.';
}

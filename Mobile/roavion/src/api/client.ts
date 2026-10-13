/**
 * The one way this app talks to the Roavion API.
 *
 * It calls the SAME `/api/v1` backend as the website, so prices, stock and
 * orders can never disagree between the two. Nothing about money is decided
 * here: the app sends what the customer chose, and the server returns what it
 * costs.
 *
 * Auth: the API accepts either an httpOnly cookie (the website) or a Bearer
 * token (documented as "mobile/API clients"). React Native's networking layer
 * keeps cookies per app install, so a normal login works unchanged — and if a
 * token is ever handed to us we send it too, which costs nothing and makes the
 * app work either way.
 *
 * Guest cart: the backend identifies an anonymous cart by the `x-session-id`
 * header, so we generate one id per install and keep it in secure storage.
 */
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

/**
 * Live API by default. `EXPO_PUBLIC_API_URL` overrides it, which is how a
 * staging backend or a local preview is pointed at without editing app.json.
 */
const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  'https://api.autobacsindia.com/api/v1';

const SESSION_KEY = 'roavion.sessionId';
const TOKEN_KEY = 'roavion.accessToken';

/** Thrown for any non-2xx response, carrying the server's own message. */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// ── per-install identity ─────────────────────────────────────────────────────

let sessionId: string | null = null;
let accessToken: string | null = null;
let loaded = false;

const randomId = () =>
  `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;

/** Read the stored ids once per app launch. Safe to call repeatedly. */
async function ready(): Promise<void> {
  if (loaded) return;
  try {
    sessionId = await SecureStore.getItemAsync(SESSION_KEY);
    accessToken = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    // Secure storage unavailable (rare). Fall back to an in-memory id: the cart
    // then lasts for this launch instead of failing outright.
  }
  if (!sessionId) {
    sessionId = randomId();
    SecureStore.setItemAsync(SESSION_KEY, sessionId).catch(() => {});
  }
  loaded = true;
}

export async function getSessionId(): Promise<string> {
  await ready();
  return sessionId!;
}

export async function setAccessToken(token: string | null): Promise<void> {
  accessToken = token;
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Not fatal: cookies still authenticate the session for this launch.
  }
}

/**
 * A brand-new guest identity. Used after sign-out so the next guest on this
 * phone does not inherit the previous person's cart.
 */
export async function resetGuestSession(): Promise<void> {
  sessionId = randomId();
  try {
    await SecureStore.setItemAsync(SESSION_KEY, sessionId);
  } catch {
    /* in-memory is enough for this launch */
  }
}

// ── requests ─────────────────────────────────────────────────────────────────

// ── CSRF ─────────────────────────────────────────────────────────────────────

/**
 * The API protects every write with a CSRF token. A browser echoes the
 * XSRF-TOKEN cookie from JavaScript; React Native stores cookies in the native
 * layer where JS cannot read them, so we ask the API for the value instead —
 * `/csrf-token` returns the SAME token it sets, exactly for this case.
 *
 * Cached for the app's lifetime and re-fetched once if a write is ever refused,
 * which covers a token that rotated while the app was in the background.
 */
let csrfToken: string | null = null;

async function getCsrf(force = false): Promise<string | null> {
  if (csrfToken && !force) return csrfToken;
  try {
    const res = await fetch(`${API_URL}/csrf-token`, {
      headers: { Accept: 'application/json' },
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { csrfToken?: string };
    csrfToken = data.csrfToken ?? null;
  } catch {
    csrfToken = null; // writes will still be attempted; the server decides
  }
  return csrfToken;
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Abort signal so a screen that unmounts stops its in-flight request. */
  signal?: AbortSignal;
};

async function request<T>(path: string, options: Options = {}, retried = false): Promise<T> {
  await ready();
  const { method = 'GET', body, signal } = options;
  const writes = method !== 'GET';

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'x-session-id': sessionId!,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (writes) {
    const token = await getCsrf(retried);
    if (token) headers['X-XSRF-TOKEN'] = token;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    // No connection, flight mode, captive wifi… one clear sentence, not a stack.
    throw new ApiError('No internet connection. Please check your network and try again.', 0);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  // A stale CSRF token is the one failure worth retrying automatically: fetch a
  // fresh one and replay the write exactly once.
  if (res.status === 403 && writes && !retried) {
    return request<T>(path, options, true);
  }

  if (!res.ok) {
    const payload = (data ?? {}) as { message?: string; code?: string };
    throw new ApiError(
      payload.message || `Something went wrong (${res.status}). Please try again.`,
      res.status,
      payload.code,
    );
  }
  return (data ?? {}) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) => request<T>(path, { method: 'POST', body, signal }),
  put: <T>(path: string, body?: unknown, signal?: AbortSignal) => request<T>(path, { method: 'PUT', body, signal }),
  del: <T>(path: string, signal?: AbortSignal) => request<T>(path, { method: 'DELETE', signal }),
};

export { API_URL };

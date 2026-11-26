/**
 * The one way Autobacs Partner talks to the API. Pattern copied from the
 * customer app (Mobile/roavion/src/api/client.ts), adapted for supplier auth:
 *
 * - Auth is a Bearer token ONLY (the supplier API never reads cookies —
 *   middleware/supplierAuth.js). It lives in SecureStore on the phone.
 * - Writes carry a CSRF token from `/csrf-token`. Sign-up / sign-in have no
 *   token yet, so they need it; with a Bearer token the server exempts the check
 *   but still counts a mismatch, so we send it always. A 403 on a write
 *   re-fetches it and replays once.
 * - A 401 while signed in means the session is gone (expired, or "sign out
 *   everywhere" bumped sessionVersion) → the app signs out locally.
 * - Network failure becomes one plain sentence, never a stack trace.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import type { LocalFile } from './types';

export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  'https://api.autobacsindia.com/api/v1';

const TOKEN_KEY = 'autobacs-partner.token';

export class ApiError extends Error {
  status: number;
  code?: string;
  /** Extra fields the server sent with the error (field, missing, retryAfterSeconds…). */
  extra: Record<string, unknown>;
  constructor(message: string, status: number, code?: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
  get offline() {
    return this.status === 0;
  }
}

export const OFFLINE_MESSAGE = 'No internet connection. Check your network and try again.';

// ── token storage ────────────────────────────────────────────────────────────
// SecureStore is native-only. On Expo web (used for previews) fall back to
// localStorage — web is a development surface, not a shipped target.

const store = {
  async get(): Promise<string | null> {
    try {
      if (Platform.OS === 'web') return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
      return await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  async set(v: string | null): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        if (v) globalThis.localStorage?.setItem(TOKEN_KEY, v);
        else globalThis.localStorage?.removeItem(TOKEN_KEY);
        return;
      }
      if (v) await SecureStore.setItemAsync(TOKEN_KEY, v);
      else await SecureStore.deleteItemAsync(TOKEN_KEY);
    } catch {
      // Not fatal: the token still works for this launch.
    }
  },
};

let token: string | null = null;
let loaded = false;
let onUnauthorized: (() => void) | null = null;

export async function loadToken(): Promise<string | null> {
  if (!loaded) {
    token = await store.get();
    loaded = true;
  }
  return token;
}

export async function setToken(next: string | null): Promise<void> {
  token = next;
  loaded = true;
  await store.set(next);
}

/** The session provider registers this so a dead session signs the app out. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

// ── CSRF ─────────────────────────────────────────────────────────────────────

let csrfToken: string | null = null;

async function getCsrf(force = false): Promise<string | null> {
  if (csrfToken && !force) return csrfToken;
  try {
    const res = await fetch(`${API_URL}/csrf-token`, { headers: { Accept: 'application/json' }, credentials: 'include' });
    if (!res.ok) return null;
    const data = (await res.json()) as { csrfToken?: string };
    csrfToken = data.csrfToken ?? null;
  } catch {
    csrfToken = null; // the write is still attempted; the server decides
  }
  return csrfToken;
}

// ── requests ─────────────────────────────────────────────────────────────────

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Options = { method?: Method; body?: unknown; form?: FormData; signal?: AbortSignal };

async function request<T>(path: string, options: Options = {}, retried = false): Promise<T> {
  await loadToken();
  const { method = 'GET', body, form, signal } = options;
  const writes = method !== 'GET';

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (writes) {
    const t = await getCsrf(retried);
    if (t) headers['X-XSRF-TOKEN'] = t;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError(OFFLINE_MESSAGE, 0, 'OFFLINE');
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

  const payload = (data ?? {}) as { message?: string; code?: string } & Record<string, unknown>;

  // Stale CSRF → refresh once. (A 403 with a code is a real refusal, e.g. SUPPLIER_STATUS.)
  if (res.status === 403 && writes && !retried && !payload.code) {
    return request<T>(path, options, true);
  }

  if (res.status === 401 && token) onUnauthorized?.();

  if (!res.ok) {
    // Server errors are `{ success:false, code, message, ...extra }` (partner API contract).
    const { message, code, success: _s, ...extra } = payload;
    throw new ApiError(
      message || (res.status >= 500 ? 'Our server had a problem. Please try again in a minute.' : `Something went wrong (${res.status}).`),
      res.status,
      code,
      extra,
    );
  }
  return (data ?? {}) as T;
}

/** Build a multipart body from a picked photo, on native and on web. */
export async function fileForm(field: string, file: LocalFile): Promise<FormData> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(file.uri)).blob();
    form.append(field, blob, file.name);
  } else {
    // React Native's FormData takes this shape for a file on disk.
    form.append(field, { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  }
  return form;
}

export const http = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', form }),
};

/** One plain sentence for any thrown thing. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const missing = err.extra.missing;
    if (err.code === 'INCOMPLETE' && Array.isArray(missing) && missing.length) return `${err.message} Missing: ${missing.join(', ')}.`;
    return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong. Please try again.';
}

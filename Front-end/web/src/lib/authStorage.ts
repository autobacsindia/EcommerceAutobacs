'use client';

/**
 * Single owner of the client-side auth cache (localStorage `auth_check`).
 *
 * Two modules read this entry and MUST agree on its key AND shape:
 *  - `context/AuthContext` writes it after every auth check (its
 *    stale-while-revalidate cache of GET /me).
 *  - `lib/api-client` reads it to decide whether a 401 on a protected endpoint
 *    should attempt a silent token refresh (a real session) or be treated as a
 *    plain guest 401 (skip refresh).
 *
 * Keeping the key literal and the `{ user, sessionVersion, timestamp }` shape in
 * exactly one place means a future change to either can't silently desync the
 * two consumers — the previous "keep in sync" comment coupling was how a guest's
 * negative-cache entry (`{ user: null }`) got mistaken for a live session and
 * surfaced a spurious "session expired" prompt.
 *
 * Crucially, the entry EXISTS for guests too (a logged-out check writes
 * `{ user: null }`), so presence of the key is NOT proof of a session.
 * `hasAuthenticatedSession()` is the authoritative signal (non-null `user`);
 * callers must use it rather than re-deriving the key or shape themselves.
 */

const AUTH_CACHE_KEY = 'auth_check';

export interface CachedAuth<U = unknown> {
  user: U | null;
  sessionVersion: number;
  timestamp: number;
}

/** Read and parse the persisted auth cache. Returns null when absent, on the
 *  server, or when the stored value is malformed. */
export function readAuthCache<U = unknown>(): CachedAuth<U> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTH_CACHE_KEY);
    if (raw == null) return null;
    return JSON.parse(raw) as CachedAuth<U>;
  } catch {
    return null;
  }
}

/** Persist the current auth state. A logged-out check passes `user: null` — this
 *  is the intentional negative cache, not a session. */
export function writeAuthCache<U = unknown>(user: U | null, sessionVersion: number): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CachedAuth<U> = { user, sessionVersion, timestamp: Date.now() };
    window.localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage unavailable (private browsing, storage full) — non-fatal.
  }
}

export function clearAuthCache(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(AUTH_CACHE_KEY);
  } catch {
    // Storage unavailable — non-fatal.
  }
}

/** Authoritative "is there a real authenticated session?" signal: a persisted
 *  cache entry whose `user` is non-null. Guests (`{ user: null }`), a missing
 *  entry, a malformed value, and the server all return false. */
export function hasAuthenticatedSession(): boolean {
  return readAuthCache()?.user != null;
}

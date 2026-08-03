'use client';

const SESSION_ID_KEY = 'autobacs_session_id';

export class TokenManager {
  /**
   * @deprecated Remove once httpOnly-cookie auth is confirmed stable across all features.
   * These were used by the pre-cookie token flow; setAuthToken/setRefreshToken are now no-ops.
   */
  token: string | null = null;
  refreshToken: string | null = null;

  // Single-inflight refresh: concurrent 401s share one promise rather than each
  // firing a separate rotation that would invalidate the preceding tokens.
  private _refreshPromise: Promise<string | null> | null = null;

  // Single-inflight CSRF seed, same reasoning as above.
  private _csrfPromise: Promise<void> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.getSessionId();
    }
  }

  /**
   * Guarantee an XSRF-TOKEN cookie exists before a state-changing request.
   *
   * The backend deliberately does NOT mint the cookie on publicly cacheable GETs
   * — a Set-Cookie there makes the response unstorable by Redis and the CDN,
   * which used to disable the whole cache layer. So a visitor who has only
   * browsed catalogue pages holds no token, and their first mutation (e.g. guest
   * "add to cart") would 403.
   *
   * Cheap in the common case: once the cookie exists this is a synchronous
   * no-op, so it costs one extra request per session at most.
   */
  async ensureCsrfToken(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (this.getCookie('XSRF-TOKEN')) return;

    if (!this._csrfPromise) {
      this._csrfPromise = fetch('/api/v1/csrf-token', { credentials: 'include' })
        .then(() => undefined)
        // Never block the request we're seeding for: if this fails the mutation
        // still goes out and gets the normal 403 + retry path.
        .catch(() => undefined)
        .finally(() => {
          this._csrfPromise = null;
        });
    }
    return this._csrfPromise;
  }

  /**
   * @deprecated Tokens are managed via httpOnly cookies set by the backend.
   * Remove after dealer-portal auth migration is complete.
   */
  setAuthToken(_token: string): void {
    console.warn('[API Client] setAuthToken() is deprecated — tokens managed via httpOnly cookies');
  }

  /**
   * @deprecated Tokens are managed via httpOnly cookies set by the backend.
   * Remove after dealer-portal auth migration is complete.
   */
  setRefreshToken(_token: string): void {
    console.warn('[API Client] setRefreshToken() is deprecated — tokens managed via httpOnly cookies');
  }

  clearAuthToken(): void {
    this.token = null;
    this.refreshToken = null;
  }

  getAuthToken(): string | null {
    return this.token;
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  getSessionId(): string {
    if (typeof window === 'undefined') return '';
    let sessionId = localStorage.getItem(SESSION_ID_KEY);
    if (!sessionId) {
      sessionId = this.generateSessionId();
      localStorage.setItem(SESSION_ID_KEY, sessionId);
    }
    return sessionId;
  }

  private generateSessionId(): string {
    const randomPart = crypto.getRandomValues(new Uint8Array(16))
      .reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), '');
    return `sess_${randomPart}_${Date.now().toString(36)}`;
  }

  async refreshSession(): Promise<string | null> {
    if (this._refreshPromise) return this._refreshPromise;
    this._refreshPromise = this._doRefresh().finally(() => {
      this._refreshPromise = null;
    });
    return this._refreshPromise;
  }

  private async _doRefresh(): Promise<string | null> {
    try {
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // browser sends refresh token cookie automatically
      });
      const data = await response.json();
      if (response.ok && data.success) {
        return 'httpOnly-cookie';
      }
      throw new Error('Refresh failed');
    } catch (error) {
      this.clearAuthToken();
      throw error;
    }
  }

  getCookie(name: string): string | null {
    if (typeof window === 'undefined') return null;
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
    return null;
  }

  getHeaders(customHeaders?: HeadersInit): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(customHeaders as Record<string, string>),
    };

    // Backward-compat: bearer token if manually set (pre-httpOnly migration)
    if (this.token && this.token !== 'httpOnly-cookie') {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const sessionId = this.getSessionId();
    console.log('[API Client] Sending x-session-id:', sessionId);
    if (sessionId) headers['x-session-id'] = sessionId;

    const xsrfToken = this.getCookie('XSRF-TOKEN');
    if (xsrfToken) headers['X-XSRF-TOKEN'] = xsrfToken;

    return headers;
  }
}

export const tokenManager = new TokenManager();

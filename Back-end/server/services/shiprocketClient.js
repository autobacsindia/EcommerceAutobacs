/**
 * Shiprocket API connection — login + authenticated requests. Nothing else.
 *
 * Shiprocket is our courier aggregator (Delhivery, DTDC, Blue Dart, Xpressbees…
 * behind one account). Booking, labels, pickups, tracking and returns are built
 * ON this client in later steps; this file only knows how to talk to the API.
 *
 * ── LOGIN ──────────────────────────────────────────────────────────────────────
 * Shiprocket has no API keys: a dedicated API user (Settings → API → Configure)
 * logs in with email + password and gets a bearer token valid for 10 days. We
 * cache that token for 9 days so it is always refreshed before it dies.
 *
 * The cache lives in REDIS, not process memory, because Railway runs several
 * replicas: one login serves them all instead of each replica (and each restart)
 * logging in again. In-process, concurrent first calls share ONE login promise
 * (single-flight). If Redis is down we fall back to a per-process memory cache —
 * slightly more logins, never an outage. A second replica racing the first login
 * just logs in too; Shiprocket accepts several live tokens, so that race is
 * harmless and not worth a distributed lock.
 *
 * ── EXPIRED / REVOKED TOKEN ────────────────────────────────────────────────────
 * A 401 means our cached token is no longer accepted (password changed, token
 * revoked). We drop it — only if it is still the one we used, so we never delete
 * a fresher token another replica just stored — then take whatever token the
 * cache now holds (logging in only if it is empty) and retry ONCE.
 *
 * ── NO AUTOMATIC RETRIES OTHERWISE ─────────────────────────────────────────────
 * Shiprocket's create calls are not idempotent on their side: blindly retrying a
 * timed-out "create order" could book two shipments. Callers that create things
 * own their idempotency (they look up before they create). This client never
 * retries anything except the single re-login above.
 *
 * Secrets: SHIPROCKET_API_EMAIL / SHIPROCKET_API_PASSWORD come from the
 * environment (Railway). They and the token are never logged or put in errors.
 */
import { getRedisClient, isRedisHealthy } from './redisClient.js';

export const DEFAULT_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';
export const TOKEN_CACHE_KEY = 'shiprocket:token';
/** Shiprocket tokens live 10 days; refresh a day early. */
export const TOKEN_TTL_SECONDS = 9 * 24 * 60 * 60;
export const DEFAULT_TIMEOUT_MS = 15_000;

export class ShiprocketError extends Error {
  /**
   * @param {string} message  safe for logs + admin UI (never contains credentials)
   * @param {object} [info]
   * @param {number} [info.status]  HTTP status from Shiprocket, 0 for network/timeout
   * @param {string} [info.code]    NOT_CONFIGURED | AUTH_FAILED | TIMEOUT | NETWORK | HTTP_ERROR | BAD_RESPONSE
   * @param {unknown} [info.details] Shiprocket's error body (validation messages)
   */
  constructor(message, { status = 0, code = 'HTTP_ERROR', details } = {}) {
    super(message);
    this.name = 'ShiprocketError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Shiprocket error bodies come as {message}, {errors:{field:[msg]}} or plain text. */
function messageFrom(body, fallback) {
  if (body && typeof body === 'object') {
    if (typeof body.message === 'string' && body.message) return body.message;
    if (body.errors && typeof body.errors === 'object') {
      const first = Object.values(body.errors).flat().find((m) => typeof m === 'string');
      if (first) return first;
    }
  }
  if (typeof body === 'string' && body.trim()) return body.trim().slice(0, 200);
  return fallback;
}

export class ShiprocketClient {
  /**
   * Everything is injectable for tests; production uses the defaults.
   * @param {object} [opts]
   * @param {() => object} [opts.env]          reads config at call time (Railway vars can change on restart)
   * @param {typeof fetch} [opts.fetchImpl]
   * @param {() => any} [opts.getRedis]        returns an ioredis-like client or null
   * @param {() => boolean} [opts.redisHealthy]
   * @param {() => number} [opts.now]
   */
  constructor({
    env = () => process.env,
    fetchImpl = (...args) => fetch(...args),
    getRedis = getRedisClient,
    redisHealthy = isRedisHealthy,
    now = () => Date.now(),
  } = {}) {
    this._env = env;
    this._fetch = fetchImpl;
    this._getRedis = getRedis;
    this._redisHealthy = redisHealthy;
    this._now = now;
    this._memToken = null; // { token, expiresAt } — fallback when Redis is unavailable
    this._loginInFlight = null;
  }

  _config() {
    const e = this._env() || {};
    return {
      email: (e.SHIPROCKET_API_EMAIL || '').trim(),
      password: e.SHIPROCKET_API_PASSWORD || '',
      baseUrl: (e.SHIPROCKET_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
      timeoutMs: Number(e.SHIPROCKET_TIMEOUT_MS) > 0 ? Number(e.SHIPROCKET_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
    };
  }

  /** True when both credentials are set. Callers hide Shiprocket buttons otherwise. */
  isConfigured() {
    const { email, password } = this._config();
    return Boolean(email && password);
  }

  _redis() {
    const r = this._getRedis?.();
    return r && this._redisHealthy?.() ? r : null;
  }

  async _readCachedToken() {
    const r = this._redis();
    if (r) {
      try {
        const t = await r.get(TOKEN_CACHE_KEY);
        if (t) return t;
      } catch (err) {
        console.warn('[Shiprocket] token cache read failed:', err.message);
      }
    }
    if (this._memToken && this._memToken.expiresAt > this._now()) return this._memToken.token;
    return null;
  }

  async _storeToken(token) {
    this._memToken = { token, expiresAt: this._now() + TOKEN_TTL_SECONDS * 1000 };
    const r = this._redis();
    if (!r) return;
    try {
      await r.set(TOKEN_CACHE_KEY, token, 'EX', TOKEN_TTL_SECONDS);
    } catch (err) {
      console.warn('[Shiprocket] token cache write failed:', err.message);
    }
  }

  /** Drop `token` from both caches — but only if it is still the cached one. */
  async _dropToken(token) {
    if (this._memToken?.token === token) this._memToken = null;
    const r = this._redis();
    if (!r) return;
    try {
      const current = await r.get(TOKEN_CACHE_KEY);
      if (current === token) await r.del(TOKEN_CACHE_KEY);
    } catch (err) {
      console.warn('[Shiprocket] token cache drop failed:', err.message);
    }
  }

  async _http(method, path, { body, token, query } = {}) {
    const { baseUrl, timeoutMs } = this._config();
    const url = new URL(baseUrl + (path.startsWith('/') ? path : `/${path}`));
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await this._fetch(url.toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new ShiprocketError(
        timedOut ? `Shiprocket did not answer within ${Math.round(timeoutMs / 1000)}s` : 'Could not reach Shiprocket',
        { status: 0, code: timedOut ? 'TIMEOUT' : 'NETWORK' }
      );
    }

    const text = await res.text().catch(() => '');
    let data = text;
    if (text) {
      try { data = JSON.parse(text); } catch { /* keep text */ }
    } else {
      data = null;
    }
    return { status: res.status, ok: res.ok, data };
  }

  async _login() {
    const { email, password } = this._config();
    if (!email || !password) {
      throw new ShiprocketError('Shiprocket is not set up yet (API user missing)', { code: 'NOT_CONFIGURED' });
    }
    const { status, ok, data } = await this._http('POST', '/auth/login', { body: { email, password } });
    if (!ok) {
      throw new ShiprocketError(
        status === 400 || status === 401 || status === 403
          ? 'Shiprocket rejected the API user login — check SHIPROCKET_API_EMAIL / SHIPROCKET_API_PASSWORD'
          : `Shiprocket login failed: ${messageFrom(data, `HTTP ${status}`)}`,
        { status, code: 'AUTH_FAILED' }
      );
    }
    const token = data && typeof data === 'object' ? data.token : null;
    if (typeof token !== 'string' || !token) {
      throw new ShiprocketError('Shiprocket login returned no token', { status, code: 'BAD_RESPONSE' });
    }
    await this._storeToken(token);
    return token;
  }

  /** A valid token: cached if we have one, else ONE shared login per process. */
  async getToken({ forceLogin = false } = {}) {
    if (!forceLogin) {
      const cached = await this._readCachedToken();
      if (cached) return cached;
    }
    if (!this._loginInFlight) {
      this._loginInFlight = this._login().finally(() => { this._loginInFlight = null; });
    }
    return this._loginInFlight;
  }

  /**
   * Authenticated call. Resolves to Shiprocket's parsed JSON body; throws
   * ShiprocketError on any non-2xx (after one re-login on 401).
   */
  async request(method, path, { body, query } = {}) {
    let token = await this.getToken();
    let res = await this._http(method, path, { body, query, token });

    if (res.status === 401) {
      await this._dropToken(token);
      // Not forceLogin: if another replica already refreshed, its token is in
      // the cache now and we use it; only an empty cache costs a login.
      token = await this.getToken();
      res = await this._http(method, path, { body, query, token });
    }

    if (!res.ok) {
      throw new ShiprocketError(messageFrom(res.data, `Shiprocket error (HTTP ${res.status})`), {
        status: res.status,
        code: res.status === 401 ? 'AUTH_FAILED' : 'HTTP_ERROR',
        details: res.data && typeof res.data === 'object' ? res.data : undefined,
      });
    }
    return res.data;
  }

  get(path, opts) { return this.request('GET', path, opts); }
  post(path, body, opts = {}) { return this.request('POST', path, { ...opts, body }); }

  /**
   * The pickup addresses saved in the Shiprocket account. Used by
   * `npm run verify-shiprocket` to prove the connection end to end, and later by
   * booking to pick the warehouse.
   * @returns {Promise<Array<{ name: string, pincode: string, city: string, state: string, primary: boolean }>>}
   */
  async listPickupLocations() {
    const data = await this.get('/settings/company/pickup');
    const rows = data?.data?.shipping_address;
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => ({
      name: String(r.pickup_location ?? ''),
      pincode: String(r.pin_code ?? ''),
      city: String(r.city ?? ''),
      state: String(r.state ?? ''),
      primary: Number(r.is_primary_location) === 1,
    }));
  }
}

export default new ShiprocketClient();

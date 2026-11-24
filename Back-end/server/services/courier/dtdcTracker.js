/**
 * DTDC direct tracking adapter — CONFIG-GATED, off until DTDC gives us API access.
 *
 * DTDC publishes no public tracking API. Contract customers get credentials from
 * their DTDC account manager for DTDC's tracking service ("blktracksvc"):
 *   1. GET  {base}/api/dtdc/authenticate?username=…&password=…  → access token (text)
 *   2. POST {base}/rest/JSONCnTrk/getTrackDetails
 *        header X-Access-Token: <token>
 *        body   { trkType: 'cnno', strcnno: '<AWB>', addtnlDtl: 'Y' }
 *      → { statusFlag, trackHeader: { strStatus, strStatusTransOn, strStatusTransTime… },
 *          trackDetails: [{ strCode, strAction, strActionDate 'DDMMYYYY', strActionTime 'HHMM', strOrigin… }] }
 * That shape is from DTDC's integration document, NOT verified against a live
 * account (we have none yet). So the parser is deliberately strict: anything it does
 * not recognise is `unknown`, which records a check and changes nothing. Verify with
 * `npm run courier-sync -- --awb <DTDC AWB>` the day credentials arrive.
 *
 * Env (Railway only, never committed):
 *   DTDC_TRACKING_USERNAME / DTDC_TRACKING_PASSWORD  — or —  DTDC_TRACKING_ACCESS_TOKEN
 *   DTDC_TRACKING_BASE_URL (optional), DTDC_TRACKING_TIMEOUT_MS (optional)
 *
 * Read-only calls. The one retry is a single re-authentication on 401.
 */
import { COURIER_STATUS } from './config.js';

export const DTDC_DEFAULT_BASE_URL = 'https://blktracksvc.dtdc.com/dtdc-api';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export class CourierError extends Error {
  constructor(message, { code = 'HTTP_ERROR', status = 0 } = {}) {
    super(message);
    this.name = 'CourierError';
    this.code = code;
    this.status = status;
  }
}

/** '17112026' + '1530' (IST) → Date. */
export function parseDtdcDate(day, time) {
  const d = String(day || '').trim();
  const t = String(time || '').trim().replace(':', '');
  const m = d.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!m) return null;
  const hh = /^\d{4}$/.test(t) ? t.slice(0, 2) : '00';
  const mm = /^\d{4}$/.test(t) ? t.slice(2, 4) : '00';
  const at = new Date(`${m[3]}-${m[2]}-${m[1]}T${hh}:${mm}:00+05:30`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Text → state. Failure words are checked FIRST so "RTO Delivered", "Not Delivered",
 * "Undelivered" can never read as delivered; delivered itself must be the whole word.
 */
export function dtdcStatusFromText(text, code) {
  const s = String(text || '').trim().toLowerCase();
  const c = String(code || '').trim().toUpperCase();
  if (!s && !c) return COURIER_STATUS.UNKNOWN;
  if (/\brto\b|return|undeliver|not delivered|non[- ]?deliver|lost|cancel|attempt/.test(s)) return COURIER_STATUS.FAILED;
  if (s === 'delivered' || c === 'DLV') return COURIER_STATUS.DELIVERED;
  if (/out for delivery/.test(s) || c === 'OUTDLV') return COURIER_STATUS.OUT_FOR_DELIVERY;
  if (/transit|booked|picked|dispatch|received|reached|arrived|manifest|bag|hub|forward/.test(s)) return COURIER_STATUS.IN_TRANSIT;
  return COURIER_STATUS.UNKNOWN;
}

/** Pure: DTDC body → the adapter contract. Exported for tests. */
export function normaliseDtdcTracking(body) {
  const unknown = { status: COURIER_STATUS.UNKNOWN, lastScanAt: null, deliveredAt: null, events: [] };
  if (!body || typeof body !== 'object' || body.statusFlag === false) return unknown;
  const header = body.trackHeader;
  if (!header || typeof header !== 'object') return unknown;

  const events = (Array.isArray(body.trackDetails) ? body.trackDetails : [])
    .map((d) => ({
      at: parseDtdcDate(d?.strActionDate, d?.strActionTime),
      status: String(d?.strAction || '').slice(0, 120),
      location: String(d?.strOrigin || d?.strDestination || '').slice(0, 120),
    }))
    .filter((ev) => ev.at)
    .sort((a, b) => b.at - a.at);

  const status = dtdcStatusFromText(header.strStatus, header.strStatusCode);
  const headerAt = parseDtdcDate(header.strStatusTransOn, header.strStatusTransTime);
  const lastScanAt = [events[0]?.at, headerAt].filter(Boolean).sort((a, b) => b - a)[0] || null;
  return {
    status,
    lastScanAt,
    deliveredAt: status === COURIER_STATUS.DELIVERED ? (headerAt || events[0]?.at || null) : null,
    events: events.slice(0, 20),
  };
}

export function createDtdcTracker({
  env = () => process.env,
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
} = {}) {
  let cached = null; // { token, expiresAt }
  let authInFlight = null;

  const config = () => {
    const e = env() || {};
    return {
      username: String(e.DTDC_TRACKING_USERNAME || '').trim(),
      password: e.DTDC_TRACKING_PASSWORD || '',
      staticToken: String(e.DTDC_TRACKING_ACCESS_TOKEN || '').trim(),
      baseUrl: String(e.DTDC_TRACKING_BASE_URL || DTDC_DEFAULT_BASE_URL).replace(/\/+$/, ''),
      timeoutMs: Number(e.DTDC_TRACKING_TIMEOUT_MS) > 0 ? Number(e.DTDC_TRACKING_TIMEOUT_MS) : 15_000,
    };
  };

  const http = async (url, init, timeoutMs) => {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new CourierError(timedOut ? 'DTDC did not answer in time' : 'Could not reach DTDC',
        { code: timedOut ? 'TIMEOUT' : 'NETWORK' });
    }
  };

  const authenticate = async () => {
    const c = config();
    if (c.staticToken) return c.staticToken;
    const url = new URL(`${c.baseUrl}/api/dtdc/authenticate`);
    url.searchParams.set('username', c.username);
    url.searchParams.set('password', c.password);
    const res = await http(url.toString(), { method: 'GET', headers: { Accept: 'text/plain, application/json' } }, c.timeoutMs);
    const text = (await res.text().catch(() => '')).trim();
    if (!res.ok || !text) {
      // Never echo the URL: it carries the password.
      throw new CourierError(`DTDC login failed (HTTP ${res.status})`, { code: 'AUTH_FAILED', status: res.status });
    }
    let token = text;
    try { const j = JSON.parse(text); token = typeof j === 'string' ? j : (j?.token || j?.accessToken || ''); } catch { /* plain text */ }
    if (!token) throw new CourierError('DTDC login returned no token', { code: 'BAD_RESPONSE', status: res.status });
    cached = { token, expiresAt: now() + TOKEN_TTL_MS };
    return token;
  };

  const getToken = async () => {
    if (cached && cached.expiresAt > now()) return cached.token;
    if (!authInFlight) authInFlight = authenticate().finally(() => { authInFlight = null; });
    return authInFlight;
  };

  const callTrack = async (token, awb) => {
    const c = config();
    return http(`${c.baseUrl}/rest/JSONCnTrk/getTrackDetails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Access-Token': token },
      body: JSON.stringify({ trkType: 'cnno', strcnno: awb, addtnlDtl: 'Y' }),
    }, c.timeoutMs);
  };

  return {
    name: 'dtdc',
    isConfigured() {
      const c = config();
      return Boolean(c.staticToken || (c.username && c.password));
    },
    async track(parcel) {
      const awb = String(parcel?.trackingNumber || '').trim();
      let token = await getToken();
      let res = await callTrack(token, awb);
      if (res.status === 401 && !config().staticToken) {
        if (cached?.token === token) cached = null;
        token = await getToken();
        res = await callTrack(token, awb);
      }
      if (!res.ok) throw new CourierError(`DTDC tracking error (HTTP ${res.status})`, { status: res.status });
      const text = await res.text().catch(() => '');
      let body = null;
      try { body = JSON.parse(text); } catch {
        throw new CourierError('DTDC returned a non-JSON tracking response', { code: 'BAD_RESPONSE', status: res.status });
      }
      return normaliseDtdcTracking(body);
    },
  };
}

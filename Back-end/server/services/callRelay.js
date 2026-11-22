/**
 * Cloudflare Realtime TURN — the hosted relay for team-chat calls.
 *
 * Why a relay at all: on many office and home networks two browsers cannot
 * reach each other directly even on the same Wi-Fi (the router keeps Wi-Fi
 * devices apart, or the internet provider shares one address between many
 * homes — Jio does). Then the still-encrypted call media goes through TURN.
 *
 * Off unless both are set (Railway variables, never the frontend):
 *   CALL_CF_TURN_KEY_ID     the TURN key's id
 *   CALL_CF_TURN_API_TOKEN  the TURN key's API token
 * The token never leaves the server; browsers get short-lived credentials.
 *
 * Credentials are minted with one API call and shared for half their life, so
 * a busy day costs a handful of API calls, not one per call. If Cloudflare is
 * unreachable the call still starts with STUN only — it then works wherever a
 * direct path exists, exactly as before — and we try again on the next call.
 */
const API = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

let cached = null; // { servers, freshUntil }
let inflight = null;

export function cloudflareTurnConfigured() {
  return !!(process.env.CALL_CF_TURN_KEY_ID && process.env.CALL_CF_TURN_API_TOKEN);
}

/** Browsers time out on port 53 (Cloudflare's own advice): leave those URLs out. */
function usable(urls) {
  const list = Array.isArray(urls) ? urls : [urls];
  return list.filter((u) => typeof u === 'string' && /^turns?:/.test(u) && !/:53(\?|$)/.test(u));
}

async function mint(fetchImpl) {
  const ttl = num(process.env.CALL_TURN_TTL_SECONDS, 6 * 3600);
  const res = await fetchImpl(`${API}/${encodeURIComponent(process.env.CALL_CF_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CALL_CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`Cloudflare TURN ${res.status}`);
  const body = await res.json();
  const servers = (Array.isArray(body?.iceServers) ? body.iceServers : [])
    .map((s) => ({ urls: usable(s?.urls), username: s?.username, credential: s?.credential }))
    .filter((s) => s.urls.length && typeof s.username === 'string' && typeof s.credential === 'string');
  if (!servers.length) throw new Error('Cloudflare TURN returned no relay');
  return { servers, freshUntil: Date.now() + (ttl * 1000) / 2 };
}

/**
 * The relay servers to hand a browser, or [] (not set up, or Cloudflare down).
 * Never throws.
 */
export async function cloudflareTurnServers({ fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (!cloudflareTurnConfigured()) return [];
  if (cached && cached.freshUntil > now) return cached.servers;
  try {
    inflight = inflight || mint(fetchImpl).finally(() => { inflight = null; });
    cached = await inflight;
    return cached.servers;
  } catch (err) {
    console.warn('[calls] TURN relay unavailable, STUN only for this call:', err.message);
    return [];
  }
}

/** Tests only. */
export function resetCloudflareTurnCache() {
  cached = null;
  inflight = null;
}

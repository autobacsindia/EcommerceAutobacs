import crypto from 'crypto';
import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';
import { getRedisClient, isRedisHealthy } from './redisClient.js';

/**
 * Link previews for team chat: the title and description of the first link in
 * a message, shown as a small card under it.
 *
 * ── Why this file is careful ────────────────────────────────────────────────
 * The SERVER fetches a URL that a person typed. Done naively that is SSRF: a
 * link to http://169.254.169.254/ (cloud metadata), http://localhost:6379/
 * (Redis) or a 10.x address would make our backend read its own private
 * network and paste the answer into chat. So:
 *   - http/https only, default ports only, no credentials in the URL;
 *   - the host is resolved HERE and every address is checked against the
 *     private / loopback / link-local / metadata ranges; the connection then
 *     goes to that vetted address (no second DNS lookup an attacker could
 *     rebind between the check and the connect);
 *   - redirects are followed by hand, at most 3, each one checked again;
 *   - 4 s total, 512 KB at most, HTML only;
 *   - only text comes back (title, description, site name). No images are
 *     fetched or shown — an image URL would make every reader's browser call
 *     a third party, and would let a sender track who read the message.
 *
 * Results (including "no preview") are cached in Redis by URL, so a link
 * pasted into five conversations is fetched once.
 */

const TIMEOUT_MS = 4000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const CACHE_TTL_S = 24 * 60 * 60;
const MISS_TTL_S = 60 * 60;
const USER_AGENT = 'RoavionTeamChat/1.0 (+https://autobacsindia.com) link-preview';

/** The first http(s) link in a message, as the message renders it (MessageItem). */
export function firstUrl(text) {
  const m = /https?:\/\/[^\s<>"']+/i.exec(String(text || ''));
  if (!m) return null;
  // Trailing punctuation belongs to the sentence, not the link.
  return m[0].replace(/[),.;:!?\]]+$/, '');
}

// ── address checks ──────────────────────────────────────────────────────────

const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const v4ToInt = (ip) => ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
const inV4 = (ip, [base, bits]) => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
};

/** True for any address the backend must never connect to on a user's behalf. */
export function isBlockedAddress(address) {
  const ip = String(address || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIPv4(ip)) return V4_BLOCKED.some((r) => inV4(ip, r));
  if (!net.isIPv6(ip)) return true; // not an IP at all: refuse
  if (ip === '::' || ip === '::1') return true;
  // IPv4-mapped / -compatible (::ffff:10.0.0.1, ::10.0.0.1): judge the IPv4 inside.
  const mapped = /^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isBlockedAddress(mapped[1]);
  const first = parseInt(ip.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (ip.startsWith('64:ff9b:') || ip.startsWith('2001:db8:') || ip.startsWith('2002:')) return true; // NAT64, docs, 6to4
  return false;
}

/**
 * Parse and check a URL's shape. Returns a URL or null. `extraPorts` is for
 * tests only (a local test server cannot listen on 80/443).
 */
export function checkUrl(raw, { extraPorts = [] } = {}) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && !((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443'))
    && !extraPorts.includes(Number(u.port))) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (net.isIP(host) && isBlockedAddress(host)) return null;
  return u;
}

/** Resolve a host and keep it only if EVERY address is public (one bad record is enough to refuse). */
async function vettedAddress(host, resolve) {
  if (net.isIP(host)) return isBlockedAddress(host) ? null : { address: host, family: net.isIP(host) };
  let records;
  try { records = await resolve(host); } catch { return null; }
  if (!records?.length || records.some((r) => isBlockedAddress(r.address))) return null;
  return records[0];
}

// ── fetching ────────────────────────────────────────────────────────────────

function getOnce(u, addr, deadline) {
  return new Promise((resolve) => {
    const lib = u.protocol === 'https:' ? https : http;
    const left = Math.max(1, deadline - Date.now());
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || undefined,
      path: `${u.pathname}${u.search}`,
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en' },
      // Connect to the address we vetted — never let the socket look the name up again.
      lookup: (_h, opts, cb) => (opts?.all ? cb(null, [addr]) : cb(null, addr.address, addr.family)),
      servername: net.isIP(u.hostname) ? undefined : u.hostname,
      timeout: left,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve({ redirect: res.headers.location });
        return;
      }
      const type = String(res.headers['content-type'] || '');
      if (res.statusCode !== 200 || !/text\/html|application\/xhtml/i.test(type)) {
        res.resume();
        resolve(null);
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        chunks.push(c);
        if (size >= MAX_BYTES) res.destroy(); // enough for the <head>
      });
      res.on('close', () => resolve({ html: Buffer.concat(chunks).subarray(0, MAX_BYTES).toString('utf8') }));
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

/**
 * Fetch a page's preview, or null. `resolve`, `allowAddress` and `extraPorts`
 * exist for tests only (a local server lives on a blocked address and a high
 * port); production always uses real DNS and the strict checks.
 */
export async function fetchPreview(rawUrl, {
  resolve = (h) => dns.lookup(h, { all: true, verbatim: true }), allowAddress, extraPorts = [],
} = {}) {
  const deadline = Date.now() + TIMEOUT_MS;
  let u = checkUrl(rawUrl, { extraPorts });
  for (let hop = 0; u && hop <= MAX_REDIRECTS && Date.now() < deadline; hop += 1) {
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const addr = allowAddress
      ? await resolve(host).then((r) => r?.[0] ?? null).catch(() => null)
      : await vettedAddress(host, resolve);
    if (!addr || (allowAddress && !allowAddress(addr.address))) return null;
    const res = await getOnce(u, addr, deadline);
    if (!res) return null;
    if (res.html != null) return parsePreview(res.html, u);
    try { u = checkUrl(new URL(res.redirect, u).toString(), { extraPorts }); } catch { return null; }
  }
  return null;
}

// ── parsing ─────────────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { const n = parseInt(h, 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
    .replace(/&#(\d+);/g, (_, d) => { const n = Number(d); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
// Control characters out, whitespace collapsed: this text ends up in a chat card.
// eslint-disable-next-line no-control-regex
const clean = (s, max) => decode(String(s || '')).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function metaContent(head, key) {
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const name = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (name !== key) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? /\bcontent\s*=\s*'([^']*)'/i.exec(tag)?.[1];
    if (content) return content;
  }
  return '';
}

/** Title / description / site name from a page's <head>. Null when there is nothing worth a card. */
export function parsePreview(html, url) {
  const head = String(html).split(/<\/head>/i)[0];
  const title = clean(metaContent(head, 'og:title') || metaContent(head, 'twitter:title') || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1], 200);
  if (!title) return null;
  const description = clean(metaContent(head, 'og:description') || metaContent(head, 'description') || metaContent(head, 'twitter:description'), 300);
  const site = clean(metaContent(head, 'og:site_name'), 80) || url.hostname.replace(/^www\./, '');
  return { url: url.toString(), title, description, site };
}

// ── cached entry point ──────────────────────────────────────────────────────

const cacheKey = (url) => `chat:preview:${crypto.createHash('sha1').update(url).digest('hex')}`;

/** The preview for `url`, from the cache or the web. Never throws. */
export async function previewFor(url) {
  if (!checkUrl(url)) return null;
  const redis = getRedisClient();
  const useCache = !!redis && isRedisHealthy();
  if (useCache) {
    try {
      const hit = await redis.get(cacheKey(url));
      if (hit) return JSON.parse(hit).preview ?? null;
    } catch { /* cache is an optimisation only */ }
  }
  let preview = null;
  try { preview = await fetchPreview(url); } catch { preview = null; }
  if (useCache) {
    try { await redis.set(cacheKey(url), JSON.stringify({ preview }), 'EX', preview ? CACHE_TTL_S : MISS_TTL_S); } catch { /* ignore */ }
  }
  return preview;
}

/** Off in tests (no real network) unless a test turns it on; CHAT_LINK_PREVIEWS=off switches it off anywhere. */
export const linkPreviewsEnabled = () => {
  const flag = String(process.env.CHAT_LINK_PREVIEWS || '').toLowerCase();
  if (flag === 'off') return false;
  if (flag === 'on') return true;
  return process.env.NODE_ENV !== 'test';
};

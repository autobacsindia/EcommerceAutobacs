/**
 * Cloudflare edge-cache purge.
 *
 * The Redis layer and the Next.js Data Cache both invalidate correctly on write.
 * Cloudflare, sitting in front of api.<domain>, did NOT — nothing in this
 * codebase purged it, so the edge TTL was not "worst case before a purge", it
 * was simply how long a write stayed invisible. config/cacheProfiles.js cut
 * `vehicle-data` s-maxage from 3600 to 300 purely to bound that. This module is
 * what makes the edge purgeable, so those TTLs can stop paying for a missing
 * feature.
 *
 * ── Plan constraints (verified against the live zone, 2026-09-19) ────────────
 * The zone is on the FREE plan. That allows exactly two purge shapes:
 *
 *   • purge by exact URL  — up to 30 URLs per request. What we use.
 *   • purge_everything    — the whole zone.
 *
 * Purge by PREFIX, by CACHE-TAG and by HOSTNAME are Enterprise-only. Do not
 * reach for them without re-checking the plan; the API accepts the call and
 * returns an error the caller would otherwise swallow.
 *
 * ⚠ purge_everything is deliberately NOT used on the write path. The zone also
 * serves img.autobacsindia.com (R2 imagery, Cache-Control immutable, max-age
 * one year). Purging the zone on every admin product edit would dump that
 * entire image cache and re-pull it from R2 — paying egress and a cold LCP on
 * every page — to fix a taxonomy row. It stays available for the deliberate,
 * occasional post-migration flush (scripts/flush-public-cache.js).
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 * Fire-and-forget and non-throwing, matching invalidateCache: a CDN purge
 * failure degrades to "stale until TTL", which is the pre-existing behaviour,
 * and must never fail the admin write that triggered it.
 *
 * No-op (silent, logged once) unless CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID
 * and PUBLIC_API_URL are all set — so dev, tests and any unconfigured
 * environment simply skip it.
 */

import Sentry from '../config/sentry.js';

const CF_API = 'https://api.cloudflare.com/client/v4';

/** Cloudflare's documented ceiling for a purge-by-URL request on non-Enterprise plans. */
export const MAX_URLS_PER_REQUEST = 30;

const TIMEOUT_MS = 5000;

/**
 * Origin that Cloudflare actually caches under. MUST be the public API host
 * (https://api.autobacsindia.com), not the Railway *.railway.app domain — a
 * purge URL that does not match the cached URL byte-for-byte is accepted by the
 * API and silently purges nothing.
 */
export const publicApiOrigin = () => (process.env.PUBLIC_API_URL || '').trim().replace(/\/+$/, '');

export const isConfigured = () =>
  Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID && publicApiOrigin());

/** Split into Cloudflare-sized batches. Exported for tests. */
export function chunk(items, size = MAX_URLS_PER_REQUEST) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Turn API-relative paths ('/categories', '/vehicles/makes?x=1') into the
 * absolute URLs Cloudflare keys its cache on. Paths are assumed to be under
 * /api/v1 — the only prefix the backend serves.
 */
export function toAbsoluteUrls(paths = []) {
  const origin = publicApiOrigin();
  if (!origin) return [];
  return paths
    .filter((p) => typeof p === 'string' && p.startsWith('/'))
    .map((p) => `${origin}/api/v1${p}`);
}

async function cfPost(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${CF_API}/zones/${process.env.CLOUDFLARE_ZONE_ID}/purge_cache`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const detail = json?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
      throw new Error(detail);
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Purge specific API paths from the edge.
 *
 * @param {string[]} paths API-relative paths, e.g. ['/vehicles/makes'].
 * @returns {Promise<number>} count of URLs submitted (0 when unconfigured).
 */
export async function purgeEdgePaths(paths = []) {
  if (!paths.length) return 0;
  if (!isConfigured()) return 0;

  const urls = toAbsoluteUrls(paths);
  if (!urls.length) return 0;

  let purged = 0;
  for (const batch of chunk(urls)) {
    try {
      await cfPost({ files: batch });
      purged += batch.length;
    } catch (err) {
      // Degraded, not broken: the edge entry simply lives out its s-maxage.
      console.warn(`[CDN] edge purge failed for ${batch.length} url(s): ${err.message}`);
      Sentry.captureException(err, {
        tags: { area: 'cdn-purge' },
        extra: { batchSize: batch.length, sample: batch.slice(0, 3) },
      });
    }
  }
  if (purged) console.log(`[CDN] purged ${purged} edge url(s)`);
  return purged;
}

/**
 * Purge the entire zone. Reserved for the deliberate post-migration flush —
 * see the warning above about the img.<domain> blast radius.
 */
export async function purgeEverything() {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ZONE_ID) {
    console.log('cloudflare  — skipped (CLOUDFLARE_API_TOKEN/CLOUDFLARE_ZONE_ID not set)');
    return false;
  }
  try {
    await cfPost({ purge_everything: true });
    console.log('cloudflare  — edge cache purged (purge_everything)');
    return true;
  } catch (err) {
    console.error(`cloudflare  — purge FAILED: ${err.message}`);
    return false;
  }
}

export default { purgeEdgePaths, purgeEverything, isConfigured, toAbsoluteUrls, chunk };

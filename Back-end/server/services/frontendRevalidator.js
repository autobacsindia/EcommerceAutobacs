/**
 * Backend → frontend on-demand revalidation.
 *
 * A cached response in Redis is only half the story: the Next.js Data Cache on
 * Vercel also holds tagged server-fetch results (home sections, PDP, category,
 * nav, page SEO) that would otherwise stay stale until their `revalidate`
 * window. When an admin writes data we POST the affected Next.js tags to the
 * frontend's /api/revalidate so the storefront refreshes within seconds instead
 * of minutes — no redeploy.
 *
 * Contract:
 *   - Fire-and-forget: never awaited by a request handler, never throws.
 *   - No-op (silent) when FRONTEND_URL or REVALIDATE_SECRET is unset — dev,
 *     tests, and any pre-cutover env just skip it.
 *   - 5s timeout, up to 3 attempts with backoff on network / 5xx; a final
 *     failure is a Sentry breadcrumb (staleness self-heals at the TTL, so this
 *     is degraded, not broken).
 *   - Only allowlisted tag prefixes are sent (defence in depth; the frontend
 *     route enforces the same list).
 */

import Sentry from '../config/sentry.js';

// Keep in sync with the identical list in the frontend's app/api/revalidate/route.ts —
// a tag that clears one list but not the other is silently dropped. Tag names are
// built centrally in utils/nextTags.js; never inline a bare tag at a call site.
const ALLOWED_PREFIXES = ['home:', 'product:', 'category:', 'nav:', 'seo:', 'blog:', 'careers:', 'promo:'];
/** Per-request cap. Mirrors the frontend route's own MAX_TAGS — sending more is silently truncated there. */
const MAX_TAGS = 20;
/**
 * Ceiling across ALL requests in one call, so a bulk write can't fan out into
 * unbounded HTTP traffic. Anything past this self-heals at the page's own
 * `revalidate` window (60s for a PDP), which is the pre-existing behaviour.
 */
const MAX_TOTAL_TAGS = 200;
const TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string[]} tags  Next.js cache tags (e.g. ['home:products', 'product:brake-pad'])
 *
 * Tags beyond MAX_TAGS are sent as ADDITIONAL sequential requests rather than
 * dropped. Truncating instead was a real bug: the expired-sale sweep reverts up
 * to 500 products in one pass and builds a `product:<slug>` tag for each, so
 * ~96% of affected PDPs were never revalidated and kept advertising the expired
 * (lower) sale price while checkout charged the reverted one.
 *
 * Callers must keep coarse/collection tags FIRST (see utils/nextTags.js) so they
 * land in the first batch and survive the MAX_TOTAL_TAGS ceiling.
 */
export async function revalidateFrontendTags(tags = []) {
  const base = process.env.FRONTEND_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!base || !secret) return; // not configured → skip silently

  const filtered = [...new Set(tags)]
    .filter((t) => typeof t === 'string' && ALLOWED_PREFIXES.some((p) => t.startsWith(p)))
    .slice(0, MAX_TOTAL_TAGS);
  if (!filtered.length) return;

  const url = `${base.replace(/\/$/, '')}/api/revalidate`;

  // Sequential, not parallel: a 500-product sweep must not open 25 concurrent
  // connections to the frontend. This is fire-and-forget, so latency is free.
  for (let i = 0; i < filtered.length; i += MAX_TAGS) {
    await postBatch(url, secret, filtered.slice(i, i + MAX_TAGS));
  }
}

/** POST one batch of <= MAX_TAGS tags, with retry. Never throws. */
async function postBatch(url, secret, filtered) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': secret },
        body: JSON.stringify({ tags: filtered }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) return;
      // 4xx is our own bug (bad secret / disallowed tag) — retrying won't help.
      if (res.status < 500) {
        console.warn(`[revalidator] frontend returned ${res.status} for tags:`, filtered);
        return;
      }
      // 5xx falls through to retry.
    } catch (err) {
      clearTimeout(timer);
      if (attempt === MAX_ATTEMPTS) {
        console.warn('[revalidator] failed after retries:', err.message);
        Sentry.captureException(err, {
          tags: { area: 'frontend-revalidation' },
          extra: { revalidateTags: filtered },
        });
        return;
      }
    }
    await sleep(200 * attempt);
  }
}

export default { revalidateFrontendTags };

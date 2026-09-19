/**
 * Server-side API utilities.
 *
 * Intentionally has NO 'use client' directive — this file is server-safe and
 * must never import browser-only modules (localStorage, document, window, etc.).
 *
 * Use getServerApiBase() in:
 *   - Server Components
 *   - generateMetadata()
 *   - sitemap.ts / robots.ts
 *
 * Use serverFetch() as a thin, typed wrapper around the native fetch for the
 * same server-side contexts.
 */

/**
 * Resolves the versioned backend base URL for server-side fetch calls.
 *
 * - Browser (fallback): returns relative '/api/v1' — should not normally be
 *   called client-side, but safe if it is.
 * - Server (Node.js): reads NEXT_PUBLIC_API_URL, normalises the path, and
 *   appends /api/v1. Node.js cannot resolve relative paths, so an absolute
 *   URL pointing directly at the backend is required.
 */
export function getServerApiBase(): string {
  if (typeof window !== 'undefined') {
    // Should not normally be called client-side; return relative path as safe fallback
    return '/api/v1';
  }
  const raw = (process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8080')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api(\/v1)?$/, '');
  // Prefer 127.0.0.1 over localhost to avoid Node.js IPv6 resolution issues
  return `${raw.replace('localhost', '127.0.0.1')}/api/v1`;
}

/**
 * Header proving to the backend that this call is our own server, not a browser.
 *
 * Server-side rendering leaves Vercel from a small pool of egress IPs, so every
 * SSR request in the fleet lands in one per-IP rate-limit bucket (300/min) and
 * starts returning 429 under load while real browsers are unaffected. The
 * backend gives requests carrying this key their own, far larger bucket.
 *
 * INTERNAL_API_KEY is deliberately NOT prefixed NEXT_PUBLIC_ — it must never be
 * inlined into client bundles. Unset ⇒ header omitted ⇒ normal per-IP limits,
 * which is the safe default.
 */
export function internalApiHeaders(): Record<string, string> {
  if (typeof window !== 'undefined') return {};
  const key = process.env.INTERNAL_API_KEY;
  return key ? { 'x-internal-key': key } : {};
}

interface ServerFetchOptions extends RequestInit {
  /** Optional bearer token for authenticated SSR requests. */
  token?: string;
  /** Next.js cache/revalidation config. */
  next?: NextFetchRequestConfig;
}

/**
 * Thin fetch wrapper for server components and SSG/SSR helpers.
 *
 * Differences from the browser APIClient:
 *   - No retries (server-side failures should surface immediately)
 *   - No token storage (tokens belong to the browser session)
 *   - No rate-limit logging
 *   - Throws a plain Error on non-OK responses (no ApiError needed server-side)
 */
export async function serverFetch<T>(
  path: string,
  options?: ServerFetchOptions
): Promise<T> {
  const url = `${getServerApiBase()}${path}`;

  const { token, next, ...rest } = options ?? {};

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...internalApiHeaders(),
    ...(rest.headers as Record<string, string> | undefined),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(url, {
    ...rest,
    headers,
    ...(next ? { next } : {}),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.message) detail = body.message;
    } catch {
      // ignore parse error — use statusText
    }
    throw new Error(`[serverFetch] ${res.status} ${detail} — ${url}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Distinguish "this entity does not exist" from "I could not tell right now".
 *
 * ⚠ THIS EXISTS BECAUSE ISR CACHES 404s. Demonstrated on a production build:
 * the API rate-limited a request (429) while a PDP was being generated
 * on-demand, the page treated any non-OK response as "missing", called
 * notFound() — and Next cached that 404. The API recovered to 200 and the
 * product page KEPT serving 404, because the cached miss outlives the blip.
 *
 * While every route was dynamically rendered this was survivable: one bad
 * request, one bad response, gone on reload. Under ISR a transient 429 or 5xx
 * turns a live product into a hard 404 that Google will act on, and that no
 * amount of retrying by the visitor will clear.
 *
 * So: ONLY a definitive 404 from the API means "absent". Anything else throws,
 * which surfaces error.tsx (retryable, not cached as a 404) and leaves the next
 * request free to succeed. Same reasoning as lib/vehicleExistence.ts, which
 * fails OPEN for exactly this reason — expressed here as a throw rather than an
 * optimistic `true`, because these callers need the entity itself, not a
 * yes/no.
 *
 * @throws when the entity's existence cannot be determined.
 */
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [250, 1000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchEntityOrNull<T>(
  url: string,
  pick: (body: unknown) => T | null,
  init?: RequestInit & { next?: NextFetchRequestConfig },
): Promise<T | null> {
  let lastError: unknown;

  // Retry transients before deciding anything.
  //
  // Throwing straight away was correct at REQUEST time (an error beats a cached
  // 404) but wrong at BUILD time, where these same functions prerender dozens of
  // slugs: one 429 or 502 in that burst would fail the whole production deploy.
  // lib/staticParams.ts soft-fails for exactly that reason, and this used to
  // contradict it. Retrying satisfies both — a blip costs a second, not a
  // deploy, and still never becomes a cached 404.
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, init);

      // Definitive absence — the only case that may become a cached 404.
      if (res.status === 404) return null;

      if (res.ok) return pick(await res.json());

      lastError = new Error(`[fetchEntityOrNull] ${res.status} ${res.statusText} — ${url}`);
      // A 4xx that is not 404 and not transient (401/403/422) will not fix
      // itself; retrying just delays the failure.
      if (!TRANSIENT_STATUSES.has(res.status)) break;
    } catch (err) {
      // Network-level failure: worth a retry.
      lastError = err;
    }

    if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
  }

  throw new Error(
    `[fetchEntityOrNull] gave up after ${RETRY_DELAYS_MS.length + 1} attempt(s) — ${url}. ` +
    'Treated as UNAVAILABLE, not as missing, so ISR cannot cache a 404 for a live entity. ' +
    `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/**
 * Should a failed data fetch during `next build` fail the BUILD?
 *
 * Two different builds run this code and they want opposite answers:
 *
 *  - Vercel (a real deploy) reaches the live API. A failure there is a genuine
 *    problem and must stop the deploy rather than bake an empty page into the
 *    cache. Vercel sets VERCEL=1.
 *  - CI only proves the code compiles and renders; ci-frontend.yml builds with
 *    NEXT_PUBLIC_API_URL=http://localhost:5000, which is deliberately
 *    unreachable. Before ISR nothing prerendered, so a build never touched the
 *    API and this never came up. Now ~117 routes prerender, and throwing there
 *    would turn every CI run red for a reason unrelated to the change.
 *
 * So: throw on Vercel, degrade in CI. Outside the build phase (request time and
 * ISR revalidation) this returns true and the caller's normal throw applies —
 * which is what keeps Next serving the last good page instead of caching a
 * failure.
 */
export function shouldFailBuildOnFetchError(): boolean {
  const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
  if (!isBuildPhase) return true;
  return Boolean(process.env.VERCEL);
}

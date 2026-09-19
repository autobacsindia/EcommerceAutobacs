import { getServerApiBase, internalApiHeaders } from './server-api';

/**
 * Slug lists for generateStaticParams, from the purpose-built /*\/sitemap
 * endpoints (already used by app/sitemap.ts — they return just slug+updatedAt,
 * not whole documents).
 *
 * ── Why the lists are SMALL, and why that is not a limitation ────────────────
 * Declaring generateStaticParams is what makes a dynamic segment statically
 * generatable AT ALL. With `dynamicParams` left at its default (true), a slug
 * that is NOT in the returned list is rendered on first request and then cached
 * exactly like a prerendered one. So the whole catalogue becomes ISR-eligible
 * either way; the list only decides what is warm on the very first hit after a
 * deploy.
 *
 * That matters because the win being bought here is <Link> prefetch — a static
 * route lets the router prefetch the full PDP on hover, so the click is
 * instant. That applies to every product once its page has been generated, not
 * just the prerendered slice. Prerendering all 900+ would add minutes to every
 * build and a burst of API load, for warmth on pages most visitors never open.
 *
 * ── Failure is deliberately soft ────────────────────────────────────────────
 * Every helper returns [] if the API is unreachable. ISR introduces a new
 * coupling — the build now talks to the API, which it never did when every
 * route was dynamic — and a deploy must not fail because the API blipped. []
 * means "prerender nothing, generate everything on demand", which is correct
 * behaviour rather than a broken build.
 */

/**
 * Deliberately small. Each prerendered page costs an API request during the
 * build, in a burst — 330 pages took the API into 429s even with the internal
 * key. And the count buys almost nothing: `dynamicParams` is true, so every
 * unlisted slug is generated on first request and cached identically. What the
 * list changes is only which pages are warm in the seconds after a deploy.
 *
 * Raise this only with a measurement showing cold-start latency actually
 * matters more than build time and build-time API load.
 */
export const STATIC_PARAM_LIMITS = {
  products: 25,
  categories: 25,
  brands: 25,
} as const;

async function slugsFrom<T extends Record<string, unknown>>(
  path: string,
  key: string,
): Promise<string[]> {
  try {
    const res = await fetch(`${getServerApiBase()}${path}`, {
      headers: internalApiHeaders(),
      // Build-time fetch: no revalidate semantics needed, but a hung API must
      // not hang the build.
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Record<string, T[] | undefined>;
    return (data[key] ?? [])
      .map((row) => (typeof row?.slug === 'string' ? row.slug : ''))
      .filter(Boolean);
  } catch {
    // Soft-fail: see the note above. Do not let a deploy die on this.
    return [];
  }
}

export const productSlugsForPrerender = () =>
  slugsFrom<{ slug: string }>(
    `/products/sitemap?limit=${STATIC_PARAM_LIMITS.products}&page=1`,
    'products',
  );

export const categorySlugsForPrerender = () =>
  slugsFrom<{ slug: string }>('/categories/sitemap', 'categories').then((s) =>
    s.slice(0, STATIC_PARAM_LIMITS.categories),
  );

export const brandSlugsForPrerender = () =>
  slugsFrom<{ slug: string }>('/brands/sitemap', 'brands').then((s) =>
    s.slice(0, STATIC_PARAM_LIMITS.brands),
  );

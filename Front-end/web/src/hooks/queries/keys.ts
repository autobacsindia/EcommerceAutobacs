/**
 * Query-key factory — the single source of truth for TanStack Query cache keys.
 *
 * Centralising keys keeps reads and mutation-invalidations in agreement: a
 * mutation calls `queryClient.invalidateQueries({ queryKey: productKeys.lists() })`
 * and every product-list query (whatever its filters) is refreshed. The key
 * namespaces deliberately mirror the backend cache tags (products / categories /
 * …) so the two layers are mentally one system.
 */

/** Normalize search params into a stable, cache-friendly key part: sorted keys, no empties. */
export function normalizeParams(params: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(params).sort()) {
    const v = params[key];
    if (v !== undefined && v !== '') out[key] = v;
  }
  return out;
}

export const productKeys = {
  all: ['products'] as const,
  lists: () => [...productKeys.all, 'list'] as const,
  list: (params: Record<string, string | undefined>) =>
    [...productKeys.lists(), normalizeParams(params)] as const,
  details: () => [...productKeys.all, 'detail'] as const,
  detail: (slug: string) => [...productKeys.details(), slug] as const,
  /** `/products/offers` — a distinct namespace from `lists()` since it's a different
   * backend route with its own cache tags, not a filter on the main listing. */
  offers: () => [...productKeys.all, 'offers'] as const,
  offersPage: (page: number) => [...productKeys.offers(), page] as const,
};

export const categoryKeys = {
  all: ['categories'] as const,
  detail: (slug: string) => [...categoryKeys.all, 'detail', slug] as const,
  products: (slug: string, params: Record<string, string | undefined>) =>
    [...categoryKeys.all, 'products', slug, normalizeParams(params)] as const,
};

export const suggestionKeys = {
  all: ['suggestions'] as const,
  query: (q: string) => [...suggestionKeys.all, q] as const,
};

export const profileKeys = {
  all: ['profile'] as const,
  me: () => [...profileKeys.all, 'me'] as const,
  verification: () => [...profileKeys.all, 'verification'] as const,
  recentOrders: () => [...profileKeys.all, 'recent-orders'] as const,
  karma: () => [...profileKeys.all, 'karma'] as const,
  karmaHistory: () => [...profileKeys.all, 'karma', 'history'] as const,
};

export const campaignKeys = {
  all: ['campaigns'] as const,
  lists: () => [...campaignKeys.all, 'list'] as const,
  /** Full campaign document for the admin editor. */
  detail: (slug: string) => [...campaignKeys.all, 'detail', slug] as const,
  /** Funnel + spend against the cap. */
  report: (slug: string) => [...campaignKeys.all, 'report', slug] as const,
  /**
   * Per-user eligibility. Keyed on cart value because the tier — and so the banner
   * copy and the savings meter — changes as the cart grows.
   */
  me: (slug: string, cartValue: number) => [...campaignKeys.all, 'me', slug, cartValue] as const,
  /**
   * One page of a campaign's allowlist. Keyed on the filters AND the cursor, so
   * scrolling caches pages independently and changing a filter starts a fresh list
   * rather than appending to the previous one.
   */
  members: (campaignId: string, filters: { status?: string; q?: string; cursor?: string | null }) =>
    [...campaignKeys.all, 'members', campaignId, filters.status ?? '', filters.q ?? '', filters.cursor ?? ''] as const,
  /** Prefix for invalidating every page of a campaign's roster after an import. */
  membersFor: (campaignId: string) => [...campaignKeys.all, 'members', campaignId] as const,
  /**
   * One page of a campaign's product-tier assignments. Keyed on the tier filter AND the
   * cursor, same reason as `members`: changing the filter must start a fresh list rather
   * than append to the previous one.
   */
  productTiers: (campaignId: string, filters: { tierCode?: string; cursor?: string | null }) =>
    [...campaignKeys.all, 'productTiers', campaignId, filters.tierCode ?? '', filters.cursor ?? ''] as const,
  /** Prefix for invalidating every page after a commit or an unassignment. */
  productTiersFor: (campaignId: string) => [...campaignKeys.all, 'productTiers', campaignId] as const,
  /** Products matching a tier's saved queries but carrying no assignment. */
  productTierDrift: (campaignId: string) => [...campaignKeys.all, 'productTierDrift', campaignId] as const,
  /**
   * What rate given products earn under the running campaign.
   *
   * Deliberately NOT keyed on the user, unlike `me`: a product's rate is a property of
   * the catalogue and the ladder, so every shopper shares one cache entry. Whether to
   * SHOW it is the per-user question, and that is `me`'s job.
   */
  productRates: (slug: string, ids: string[]) =>
    [...campaignKeys.all, 'productRates', slug, [...ids].sort().join(',')] as const,
};

export const adminKeys = {
  all: ['admin'] as const,
  /** Prefix for every list of a resource — use to invalidate all pages/filters at once. */
  resource: (resource: string) => [...adminKeys.all, resource] as const,
  list: (resource: string, params: Record<string, string | undefined>) =>
    [...adminKeys.resource(resource), normalizeParams(params)] as const,
  /** Header counters (pending orders / revenue) — polled, shared by every admin screen. */
  stats: () => [...adminKeys.all, 'stats'] as const,
};

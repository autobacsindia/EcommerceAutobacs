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

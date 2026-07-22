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

export const adminKeys = {
  all: ['admin'] as const,
  /** Prefix for every list of a resource — use to invalidate all pages/filters at once. */
  resource: (resource: string) => [...adminKeys.all, resource] as const,
  list: (resource: string, params: Record<string, string | undefined>) =>
    [...adminKeys.resource(resource), normalizeParams(params)] as const,
};

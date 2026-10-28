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
  /** `/products/facets` — per-filter counts (e.g. categories that fit one vehicle). */
  facets: (params: Record<string, string | undefined>) =>
    [...productKeys.all, 'facets', normalizeParams(params)] as const,
};

export const categoryKeys = {
  all: ['categories'] as const,
  /** The full taxonomy list — shared by the chip strip and category-page scoping. */
  list: () => [...categoryKeys.all, 'list'] as const,
  detail: (slug: string) => [...categoryKeys.all, 'detail', slug] as const,
  products: (slug: string, params: Record<string, string | undefined>) =>
    [...categoryKeys.all, 'products', slug, normalizeParams(params)] as const,
};

export const chatKeys = {
  all: ['chat'] as const,
  /** `/chat/channels` — spaces + DMs visible to me, with unread counts. */
  channels: () => [...chatKeys.all, 'channels'] as const,
  /** `/chat/channels/:id/messages` — infinite, newest page first. */
  messages: (channelId: string) => [...chatKeys.all, 'messages', channelId] as const,
  people: () => [...chatKeys.all, 'people'] as const,
  /** `/chat/channels/:id/members` — a custom group's member list. */
  members: (channelId: string) => [...chatKeys.all, 'members', channelId] as const,
  /** `/chat/channels/:id/files` — everything shared in one channel. */
  files: (channelId: string) => [...chatKeys.all, 'files', channelId] as const,
  /** `/chat/messages/:id/thread` — one thread: its root and replies. */
  thread: (rootId: string) => [...chatKeys.all, 'thread', rootId] as const,
  /**
   * `/chat/search` — message text across every channel I may see.
   * The channel is part of the key: narrowing to one channel is a different
   * result set, not a filter over the all-channels one.
   */
  search: (q: string, channelId?: string | null) =>
    [...chatKeys.all, 'search', q, channelId ?? 'all'] as const,
  /** `/chat/orders/recent` — the order picker. */
  recentOrders: () => [...chatKeys.all, 'orders'] as const,
  me: () => [...chatKeys.all, 'me'] as const,
  /** `/chat/presence` — who has team chat open. */
  presence: () => [...chatKeys.all, 'presence'] as const,
  /** `/chat/starred` — my starred messages, newest first. */
  starred: () => [...chatKeys.all, 'starred'] as const,
  /** `/chat/channels/:id/pins` — a conversation's pinned messages. */
  pins: (channelId: string) => [...chatKeys.all, 'pins', channelId] as const,
};

export const brandKeys = {
  all: ['brands'] as const,
  /** `/products/brands` — every brand with its product count. */
  list: () => [...brandKeys.all, 'list'] as const,
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
  /** One page of redemptions. Keyed on the cursor so pages cache independently. */
  redemptions: (slug: string, cursor: string | null) =>
    [...campaignKeys.all, 'redemptions', slug, cursor ?? ''] as const,
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

/**
 * The signed-in user's own affiliate data.
 *
 * Every entry is per-user by construction — the API scopes these to `req.user` and the
 * affiliate id is never accepted from the client — so the keys carry no id. Two people
 * sharing a browser profile cannot collide because the auth cookie changes and the
 * queries are invalidated on sign-out with the rest of the session.
 */
export const affiliateKeys = {
  all: ['affiliate'] as const,
  /** Profile + balance. Null for the overwhelming majority of customers. */
  me: () => [...affiliateKeys.all, 'me'] as const,
  /** One page of the caller's own commission ledger, keyed on the cursor. */
  commissions: (cursor?: string | null) =>
    [...affiliateKeys.all, 'commissions', cursor ?? ''] as const,
  /**
   * ADMIN: everyone currently owed at least the minimum payout.
   *
   * Under `affiliate` rather than `adminKeys` so building a batch — which changes who is
   * owed what — can invalidate this and the affiliate's own view with one prefix.
   */
  payoutQueue: () => [...affiliateKeys.all, 'payout-queue'] as const,
};

export const adminKeys = {
  all: ['admin'] as const,
  /** Prefix for every list of a resource — use to invalidate all pages/filters at once. */
  resource: (resource: string) => [...adminKeys.all, resource] as const,
  list: (resource: string, params: Record<string, string | undefined>) =>
    [...adminKeys.resource(resource), normalizeParams(params)] as const,
  /** Header counters (pending orders / revenue) — polled, shared by every admin screen. */
  stats: () => [...adminKeys.all, 'stats'] as const,
  /** GTM head + leads an order can be credited to ("Sold by"). */
  sellers: () => [...adminKeys.all, 'sellers'] as const,
};

/**
 * Staff panel (/team). Every list is scoped server-side to the caller's team (and,
 * for a sales member, to their own orders), so the keys carry no user id.
 */
export const staffKeys = {
  all: ['staff'] as const,
  /** Every sales-order list (own / team / paid) — invalidate after create, re-link or cancel. */
  orders: () => [...staffKeys.all, 'orders'] as const,
  salesOrders: () => [...staffKeys.orders(), 'sales'] as const,
  /** The seller's list: 'active' or the orders parked "On hold — customer thinking". */
  salesOrderList: (view: 'active' | 'on_hold') => [...staffKeys.salesOrders(), view] as const,
  /**
   * The paid-order lists. `stage` keeps "Order processing" and "Delivered" in
   * separate cache entries — they are different server queries, and an action
   * that delivers an order has to move it between the two. Both sit under
   * orders(), so the existing `invalidateQueries(staffKeys.orders())` after any
   * workflow action already refreshes them.
   */
  paidOrders: (stage?: 'processing' | 'delivered', filters: object = {}) =>
    [...staffKeys.orders(), 'paid', stage ?? 'all', filters] as const,
  salesProducts: (q: string) => [...staffKeys.all, 'sales-products', q.trim().toLowerCase()] as const,
  /**
   * Bank transfers waiting for / checked by accounts. Under orders(): confirming one
   * pays its order, so the order lists must refresh with it (and the other way round).
   */
  bankTransfers: (status: string) => [...staffKeys.orders(), 'bank-transfers', status] as const,
  /** One sales order (its payment requests). Under orders(), so list invalidation refreshes it too. */
  salesOrder: (id: string) => [...staffKeys.orders(), 'sales-order', id] as const,
  /** GTM quotations — invalidate after create, edit, cancel or accept. */
  quotations: () => [...staffKeys.all, 'quotations'] as const,
  quotationList: (status: string) => [...staffKeys.quotations(), 'list', status] as const,
  quotation: (id: string) => [...staffKeys.quotations(), 'one', id] as const,
  /** Team workflow — invalidate `orders()` after any action, since one action moves an order between lists. */
  workQueue: (queue: string, filters: object = {}) => [...staffKeys.orders(), 'work', queue, filters] as const,
  workOrder: (id: string) => [...staffKeys.orders(), 'work-order', id] as const,
  /** A customer's saved bank account, as seen from one quotation / order (masked). */
  customerBanks: () => [...staffKeys.all, 'customer-bank'] as const,
  customerBank: (kind: string, id: string) => [...staffKeys.customerBanks(), kind, id] as const,
};

/** `/staff/tasks/*` — tasks given to people in the panel. Invalidate `all` after any change. */
export const taskKeys = {
  all: [...staffKeys.all, 'tasks'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  list: (filters: object) => [...taskKeys.lists(), filters] as const,
  one: (id: string) => [...taskKeys.all, 'one', id] as const,
  comments: (id: string) => [...taskKeys.all, 'comments', id] as const,
  assignees: () => [...taskKeys.all, 'assignees'] as const,
};

/** `/admin/team-activity/*` — the admin's read-only view of the order workflow. */
export const teamActivityKeys = {
  all: ['team-activity'] as const,
  waiting: () => [...teamActivityKeys.all, 'waiting'] as const,
  performance: (days: number) => [...teamActivityKeys.all, 'performance', days] as const,
  order: (orderId: string) => [...teamActivityKeys.all, 'order', orderId] as const,
};

/** `/staff/attribution/*` — crediting a paid website order to a salesman (admin, marketing). */
export const attributionKeys = {
  all: ['attribution'] as const,
  lists: () => [...attributionKeys.all, 'list'] as const,
  order: (orderId: string) => [...attributionKeys.all, 'order', orderId] as const,
  sellers: () => [...attributionKeys.all, 'sellers'] as const,
};

/** `/admin/overview` — the admin's Company overview (teams, money waiting, activity). */
export const overviewKeys = { all: ['admin-overview'] as const };

/** `/notifications/summary` — what is waiting on me, for the header bell. */
export const notificationKeys = { all: ['notifications'] as const, summary: () => ['notifications', 'summary'] as const };

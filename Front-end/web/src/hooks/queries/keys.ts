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
  /** `/chat/mentions` — messages that @mention me, my team or @all, newest first. */
  mentions: () => [...chatKeys.all, 'mentions'] as const,
  /** `/chat/threads` — threads I started or replied to, newest activity first. */
  myThreads: () => [...chatKeys.all, 'my-threads'] as const,
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
  /** `/profile` in the "My profile" form shape (`me`) — staff and customers. */
  myProfile: () => [...profileKeys.all, 'my-profile'] as const,
  /** `/staff/photos` — { userId: photoUrl } for everyone in the panels. */
  panelPhotos: () => [...profileKeys.all, 'panel-photos'] as const,
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
  payoutQueue: (params: Record<string, string> = {}) => [...affiliateKeys.all, 'payout-queue', params] as const,
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
  /** The seller's list (view 'active' or the orders parked "On hold"), with its search / filters / sort. */
  salesOrderList: (params: Record<string, string>) => [...staffKeys.salesOrders(), params] as const,
  /** The sales lists' "Salesman" choices (the head / admin; empty for a seller). */
  salesFilterOptions: () => [...staffKeys.all, 'sales-filter-options'] as const,
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
  bankTransfers: (params: Record<string, string>) => [...staffKeys.orders(), 'bank-transfers', params] as const,
  bankTransferFilterOptions: () => [...staffKeys.orders(), 'bank-transfers', 'filter-options'] as const,
  /** One transfer's details popup. Under orders(), so confirming or rejecting refreshes it too. */
  bankTransferDetails: (id: string) => [...staffKeys.orders(), 'bank-transfer-details', id] as const,
  /** One sales order (its payment requests). Under orders(), so list invalidation refreshes it too. */
  salesOrder: (id: string) => [...staffKeys.orders(), 'sales-order', id] as const,
  /** GTM quotations — invalidate after create, edit, cancel or accept. */
  quotations: () => [...staffKeys.all, 'quotations'] as const,
  quotationList: (params: Record<string, string>) => [...staffKeys.quotations(), 'list', params] as const,
  quotation: (id: string) => [...staffKeys.quotations(), 'one', id] as const,
  /** Team workflow — invalidate `orders()` after any action, since one action moves an order between lists. */
  workQueue: (queue: string, filters: object = {}) => [...staffKeys.orders(), 'work', queue, filters] as const,
  workOrder: (id: string) => [...staffKeys.orders(), 'work-order', id] as const,
  /** Returns in the team panel — invalidate `returns()` after any return action. */
  returns: () => [...staffKeys.all, 'returns'] as const,
  returnList: (queue: string, params: Record<string, string> = {}) => [...staffKeys.returns(), 'list', queue, params] as const,
  returnOne: (id: string) => [...staffKeys.returns(), 'one', id] as const,
  returnPreview: (id: string, choices: object = {}) => [...staffKeys.returns(), 'preview', id, choices] as const,
  suppliersOwe: (params: Record<string, string> = {}) => [...staffKeys.returns(), 'owed', params] as const,
  returnOptions: (orderId: string) => [...staffKeys.returns(), 'options', orderId] as const,
  /** A customer's saved bank account, as seen from one quotation / order (masked). */
  /** The GTM leads sheet — invalidate `leads()` after a follow-up, release or reassign. */
  leads: () => [...staffKeys.all, 'leads'] as const,
  leadList: (params: Record<string, string> = {}) => [...staffKeys.leads(), 'list', params] as const,
  leadOne: (id: string) => [...staffKeys.leads(), 'one', id] as const,
  leadPeople: () => [...staffKeys.leads(), 'people'] as const,
  /** The Meta leads tab (rows from the sales lead sheet) — invalidate after an edit. */
  metaLeads: () => [...staffKeys.all, 'meta-leads'] as const,
  metaLeadList: (params: Record<string, string> = {}) => [...staffKeys.metaLeads(), 'list', params] as const,
  metaLeadOne: (id: string) => [...staffKeys.metaLeads(), 'one', id] as const,
  metaLeadPeople: () => [...staffKeys.metaLeads(), 'people'] as const,
  metaLeadActivity: (days: number) => [...staffKeys.metaLeads(), 'activity', days] as const,
  customerBanks: () => [...staffKeys.all, 'customer-bank'] as const,
  customerBank: (kind: string, id: string) => [...staffKeys.customerBanks(), kind, id] as const,
};

/**
 * `/staff/past-sales/*` — sales made in the store / by phone before the website.
 * Invalidate `all` after any add, edit, delete, restore or upload: totals and the
 * list both move.
 */
export const pastSaleKeys = {
  all: [...staffKeys.all, 'past-sales'] as const,
  list: (filters: object) => [...pastSaleKeys.all, 'list', filters] as const,
  totals: (filters: object) => [...pastSaleKeys.all, 'totals', filters] as const,
  one: (id: string) => [...pastSaleKeys.all, 'one', id] as const,
  sellers: () => [...pastSaleKeys.all, 'sellers'] as const,
  products: (q: string) => [...pastSaleKeys.all, 'products', q.trim().toLowerCase()] as const,
};

/** `/staff/tasks/*` — tasks given to people in the panel. Invalidate `all` after any change. */
export const lessonKeys = {
  all: [...staffKeys.all, 'lessons'] as const,
  lists: () => [...lessonKeys.all, 'list'] as const,
  list: (filters: object) => [...lessonKeys.lists(), filters] as const,
  one: (id: string) => [...lessonKeys.all, 'one', id] as const,
  progress: (id: string) => [...lessonKeys.all, 'progress', id] as const,
  meta: () => [...lessonKeys.all, 'meta'] as const,
};

export const handoverKeys = {
  all: [...staffKeys.all, 'handover'] as const,
  list: () => [...handoverKeys.all, 'list'] as const,
  mine: () => [...handoverKeys.all, 'mine'] as const,
  one: (id: string) => [...handoverKeys.all, 'one', id] as const,
  work: (id: string) => [...handoverKeys.all, 'work', id] as const,
};

export const pastMemberKeys = {
  all: [...staffKeys.all, 'past-members'] as const,
  list: (team: string) => [...pastMemberKeys.all, 'list', team] as const,
  one: (id: string) => [...pastMemberKeys.all, 'one', id] as const,
  tasks: (id: string) => [...pastMemberKeys.all, 'tasks', id] as const,
  orders: (id: string) => [...pastMemberKeys.all, 'orders', id] as const,
  notes: (id: string) => [...pastMemberKeys.all, 'notes', id] as const,
};

export const trainingKeys = {
  all: [...staffKeys.all, 'training'] as const,
  meta: () => [...trainingKeys.all, 'meta'] as const,
  lists: () => [...trainingKeys.all, 'list'] as const,
  list: (filters: object) => [...trainingKeys.lists(), filters] as const,
  one: (id: string) => [...trainingKeys.all, 'one', id] as const,
  paths: () => [...trainingKeys.all, 'paths'] as const,
  path: (id: string) => [...trainingKeys.all, 'path', id] as const,
  lessonOptions: (team: string) => [...trainingKeys.all, 'lesson-options', team] as const,
};

export const taskKeys = {
  all: [...staffKeys.all, 'tasks'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  list: (filters: object) => [...taskKeys.lists(), filters] as const,
  one: (id: string) => [...taskKeys.all, 'one', id] as const,
  comments: (id: string) => [...taskKeys.all, 'comments', id] as const,
  /** The sub-tasks listed under one task. */
  subtasks: (id: string) => [...taskKeys.all, 'subtasks', id] as const,
  /** The links on tasks: `allLinks()` is every task's, `links(id)` one task's. */
  allAssignedComments: () => [...taskKeys.all, 'assigned-comments'] as const,
  assignedComments: (state: string) => [...taskKeys.allAssignedComments(), state] as const,
  overview: (team: string) => [...taskKeys.all, 'overview', team] as const,
  allLinks: () => [...taskKeys.all, 'links'] as const,
  links: (id: string) => [...taskKeys.allLinks(), id] as const,
  assignees: () => [...taskKeys.all, 'assignees'] as const,
  /** The page header's late / due-today counts. */
  summary: () => [...taskKeys.all, 'summary'] as const,
  /** The Inbox: what happened on your tasks. `state` is 'all' or 'unread'. */
  inboxes: () => [...taskKeys.all, 'inbox'] as const,
  inbox: (state: string) => [...taskKeys.inboxes(), state] as const,
  /** Your running timer (one at a time, across all tasks). */
  timer: () => [...taskKeys.all, 'timer'] as const,
  /** The time logged on tasks: `times()` is every task's, `time(id)` one task's. */
  times: () => [...taskKeys.all, 'time'] as const,
  time: (id: string) => [...taskKeys.times(), id] as const,
  /** A team's folders and lists (with open-task counts): `spaces()` is every team's. */
  spaces: () => [...taskKeys.all, 'space'] as const,
  space: (team: string) => [...taskKeys.spaces(), team] as const,
};

/** `/admin/team-activity/*` — the admin's read-only view of the order workflow. */
export const teamActivityKeys = {
  all: ['team-activity'] as const,
  waiting: () => [...teamActivityKeys.all, 'waiting'] as const,
  performance: (days: number) => [...teamActivityKeys.all, 'performance', days] as const,
  order: (orderId: string) => [...teamActivityKeys.all, 'order', orderId] as const,
};

/** `/push/devices` — the admin's "who has pop-ups working". */
export const pushDeviceKeys = {
  all: ['push-devices'] as const,
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

// A customer's own returns, per order (the tracker on the order page).
export const customerReturnKeys = {
  all: ['customer-returns'] as const,
  forOrder: (orderId: string) => ['customer-returns', 'order', orderId] as const,
};

/** `/notifications/summary` — what is waiting on me, for the header bell. */
export const notificationKeys = { all: ['notifications'] as const, summary: () => ['notifications', 'summary'] as const };

export const paymentConfigKeys = {
  all: ['payment-config'] as const,
  /** `/payment-config/razorpay` — the public key id checkout and the EMI widget share. */
  razorpay: () => [...paymentConfigKeys.all, 'razorpay'] as const,
};

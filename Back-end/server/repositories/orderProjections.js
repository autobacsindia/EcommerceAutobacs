/**
 * Field projections for the order LIST reads.
 *
 * ── WHY THESE EXIST ────────────────────────────────────────────────────────────────
 * Both order lists returned WHOLE documents. Measured over the 200 most recent
 * production orders (re-measured after `cancellations` was added):
 *
 *     full document       1841 B
 *     customer list        441 B   −76.0%    18.0 KB → 4.3 KB per page (limit 10)
 *     admin list           542 B   −70.6%    36.0 KB → 10.6 KB per page (limit 20)
 *     CRM lead history     143 B   −92.2%    36.0 KB → 2.8 KB per lead (limit 20)
 *
 * `cancellations` costs ~0 on the typical row: 0 of the 200 sampled orders carried one,
 * and an order that never cancels anything simply has no such field.
 *
 * The single heaviest field is `statusHistory`, which neither list reads and which GROWS
 * with every status change — so the un-projected read got steadily worse for exactly the
 * orders with the most fulfilment activity. `shippingAddress`, `tracking`, `notes` and
 * `sessionId` are likewise read by neither.
 *
 * ── WHY THEY LIVE HERE AND NOT IN orderRepository.js ───────────────────────────────
 * Thirteen test suites replace orderRepository with `jest.unstable_mockModule(..., () =>
 * ({ default: mockRepo }))`. A named export added to that module is therefore missing
 * from every one of those mocks, and ESM fails the whole suite with "does not provide an
 * export named …". Constants in their own module are never mocked, so the projections
 * can be imported by controllers without dragging the mock surface along.
 *
 * ── WHY PER CALL SITE, AND WHY OPT-IN ──────────────────────────────────────────────
 * The three readers need genuinely different fields; one shared "list" shape would
 * either starve one of them or carry the union of all three. And `select` stays OPT-IN
 * at the repository (defaulting to the whole document) because a narrowing DEFAULT
 * silently starves callers that never asked for it — the first draft of this change
 * defaulted to the customer shape and immediately broke an unrelated CRM assertion on
 * `order.source`. A missing projected field is invisible at the call site and surfaces
 * as `undefined` somewhere far away, so the safe default is "everything".
 *
 * ⚠️ Adding a field to one of these screens means adding it here too. This is the
 * failure mode of a projection: the screen simply renders nothing, with no error
 * anywhere — `cancellations` was missed exactly once, and the part-cancelled badge was
 * silently dead until a test caught it.
 */

/** Customer /orders list — see Front-end/web/src/app/orders/page.tsx. */
export const CUSTOMER_LIST_FIELDS =
  'orderNumber status totalAmount createdAt trackingNumber items shipments cancellations';

/**
 * Admin /admin/orders table — see Front-end/web/src/app/admin/orders/page.tsx.
 * Covers the table, the status control, the refund badge and BOTH CSV exports.
 */
export const ADMIN_LIST_FIELDS =
  'orderNumber createdAt status paymentStatus cancelledBy totalAmount refundDetails user items shipments cancellations';

/**
 * CRM lead detail — narrower still: it renders a purchase timeline, not a basket, so it
 * needs no `items` and therefore no product join at all.
 * See Front-end/web/src/lib/leads.ts `OrderHistoryItem`.
 */
export const LEAD_HISTORY_FIELDS =
  'orderNumber totalAmount status paymentStatus cancelledBy createdAt';

/**
 * Which statuses the admin status menu may offer — a mirror of the server's rules in
 * Back-end/server/services/orderStatusService.js (STATUS_TRANSITIONS + ADMIN_CORRECTIONS).
 *
 * The server is the authority and refuses anything else. This mirror only keeps the
 * menu honest: it used to offer every status from every status, so a cancelled order
 * could be "moved back" to Processing, which the server then recorded as PAID with no
 * money behind it. Now:
 *   - nothing leaves Cancelled or Returned,
 *   - nothing goes backwards from Delivered,
 *   - an unpaid order is never moved by hand (its payment moves it), and
 *   - the only shortcut is Processing → Delivered (handed over in store).
 *
 * The parcel roll-ups' own corrections (a lost parcel walking Shipped back to
 * Processing) are deliberately not here: they happen by themselves, never from the menu.
 */

const TRANSITIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  awaiting_payment: [], // payment-driven: Razorpay or an accounts-confirmed bank transfer
  processing: ['shipped', 'delivered', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['returned'],
  returned: [],
  cancelled: [],
});

/** Statuses the admin may move an order to from `currentStatus` (may be empty). */
export function getAdminNextStatuses(currentStatus: string): string[] {
  return [...(TRANSITIONS[currentStatus] ?? [])];
}


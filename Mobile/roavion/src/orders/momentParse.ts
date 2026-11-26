/**
 * Reads the server's `moment` (GET /orders/:id, built by
 * Back-end/server/utils/orderMoment.js) into a safe, typed value.
 *
 * The app never decides which moment an order is in — it only accepts what the
 * server said. Anything it does not recognise (a key added on the server after this
 * app version shipped, a malformed field) means "no card", never a wrong card.
 * Pure: no React Native imports, so it runs under `node --test`.
 */
import type { MomentKey, OrderMomentData } from './momentCopy';

export const MOMENT_KEYS: readonly MomentKey[] = [
  'payment_failed', 'refunded', 'cancelled', 'returning', 'delivered', 'on_hold',
  'late', 'partly', 'shipped', 'packed', 'preparing', 'placed',
  'delivery_failed', 'out_for_delivery', 'date_moved', 'in_transit',
];
const KNOWN = new Set<string>(MOMENT_KEYS);

/** Long enough for any real note; a runaway value can't push the page around. */
const NOTE_MAX = 500;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

export function parseMoment(raw: unknown): OrderMomentData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.key !== 'string' || !KNOWN.has(r.key)) return null;

  const out: OrderMomentData = { key: r.key as MomentKey };
  if (r.refundDue === true) out.refundDue = true;
  const refund = r.refund as { amount?: unknown } | null | undefined;
  if (refund && typeof refund === 'object' && typeof refund.amount === 'number' && Number.isFinite(refund.amount)) {
    out.refund = { amount: refund.amount };
  }
  if (typeof r.returnStep === 'number' && Number.isFinite(r.returnStep)) out.returnStep = r.returnStep;
  const late = r.late as { dueDay?: unknown } | undefined;
  if (late && typeof late === 'object' && typeof late.dueDay === 'string') out.late = { dueDay: late.dueDay };
  const note = str(r.note);
  if (note) out.note = note.length > NOTE_MAX ? `${note.slice(0, NOTE_MAX - 1)}…` : note;
  const newDay = str(r.newDay);
  if (newDay) out.newDay = newDay;
  const at = str(r.at);
  if (at) out.at = at;
  return out;
}

/** Phone-storage key for an order's play-once memory (SecureStore allows [A-Za-z0-9._-]). */
export function memoryKey(orderId: string): string {
  return `autobacs.moment.${orderId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

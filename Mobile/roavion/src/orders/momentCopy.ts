/**
 * COPIED from the website: Front-end/web/src/components/orders/orderMomentCopy.ts.
 * Keep the words identical — change the website first, then re-copy here. Differences:
 * `formatRupees` is inlined (same code as Front-end/web/src/lib/formatRupees.ts) and the
 * play-once memory lives in momentMemory.ts (phone storage instead of localStorage).
 *
 * Order moments — the words for each picture, and the play-once memory.
 *
 * The scene key comes from the server (GET /orders/:id → `moment`, built by
 * Back-end/server/utils/orderMoment.js from confirmed order state). This file never
 * decides WHICH moment an order is in; it only words it. Owner-approved designs,
 * 2026-11-26 (artifact "Autobacs Order Moments").
 */
/** Same as Front-end/web/src/lib/formatRupees.ts — "₹47,800", or "₹47,800.50" with paise. */
export function formatRupees(amount: number | null | undefined, { exact = false }: { exact?: boolean } = {}): string {
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const hasPaise = Math.round(value * 100) % 100 !== 0;
  const digits = exact && hasPaise ? 2 : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export type MomentKey =
  | 'payment_failed' | 'refunded' | 'cancelled' | 'returning' | 'delivered' | 'on_hold'
  | 'late' | 'partly' | 'shipped' | 'packed' | 'preparing' | 'placed'
  // Delivery updates operations records on a parcel in transit.
  | 'delivery_failed' | 'out_for_delivery' | 'date_moved' | 'in_transit';

export interface OrderMomentData {
  key: MomentKey;
  refundDue?: boolean;
  refund?: { amount: number } | null;
  returnStep?: number;
  late?: { dueDay: string };
  /** Delivery updates: the team's note, exactly as the customer sees it under the parcel. */
  note?: string;
  /** date_moved: the new expected day, 'YYYY-MM-DD'. */
  newDay?: string;
  /** Delivery updates: when it was recorded (ISO). A newer one plays again. */
  at?: string;
}

export type MomentTone = 'go' | 'care' | 'calm';

export interface MomentCopy {
  chip: string;
  tone: MomentTone;
  title: string;
  body: string;
  /** The team's own words on a delivery update, shown as a quote under the body. */
  note?: string;
  /** "Updated Thu 3 Dec" for delivery updates, so an old update never reads as today. */
  updated?: string;
  /** Return steps, with the index of the current one. */
  steps?: { labels: string[]; at: number };
}

const RETURN_STEPS = ['Requested', 'Pickup', 'Received', 'Refund'];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** 'YYYY-MM-DD' (an India calendar day) → "Mon 30 Nov"; null when malformed. */
export function momentDay(day: string | undefined | null): string | null {
  if (!day || !DAY_RE.test(day)) return null;
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? dayFmt.format(d).replace(',', '') : null;
}

/** Short calendar text for the late doodle: "Mon 30". */
export function momentDayShort(day: string | undefined | null): string | null {
  const full = momentDay(day);
  return full ? full.split(' ').slice(0, 2).join(' ') : null;
}

const IST_MS = 330 * 60 * 1000;
/** ISO time → its India calendar day as "Thu 3 Dec"; null when malformed. */
export function momentDayOf(iso: string | undefined | null): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? momentDay(new Date(t + IST_MS).toISOString().slice(0, 10)) : null;
}

/**
 * @param moment - from the server
 * @param shipped - at least one parcel is with the courier (from `progress`)
 */
export function momentCopy(moment: OrderMomentData, { shipped = false }: { shipped?: boolean } = {}): MomentCopy {
  switch (moment.key) {
    case 'payment_failed':
      return {
        chip: 'Payment not completed', tone: 'calm', title: 'Your payment didn’t go through',
        body: 'Your order is waiting for payment. If money left your account, your bank returns it on its own, usually within 5–7 working days.',
      };
    case 'refunded': {
      const amount = moment.refund && moment.refund.amount > 0 ? formatRupees(moment.refund.amount, { exact: true }) : null;
      return {
        chip: 'Refund done', tone: 'go', title: 'Your money is on its way back',
        body: `${amount ? `We have refunded ${amount}.` : 'We have refunded your payment.'} It can take a few working days to show in your account.`,
      };
    }
    case 'cancelled':
      return {
        chip: 'Cancelled', tone: 'calm', title: 'Your order is cancelled',
        body: moment.refundDue
          ? 'Because you had paid, your refund has started. You’ll see it here once it’s done.'
          : 'No payment was taken for this order.',
      };
    case 'returning': {
      const at = Math.min(Math.max(moment.returnStep ?? 0, 0), 2);
      const body = [
        'We have your return request and our team is reviewing it.',
        'Your return is accepted. We arrange the pickup and tell you when the courier is coming.',
        'We have the part back. Once it passes our check, we start your refund.',
      ][at];
      return { chip: 'Return', tone: 'go', title: 'Your return is in progress', body, steps: { labels: RETURN_STEPS, at } };
    }
    case 'delivered':
      return {
        chip: 'Delivered', tone: 'go', title: 'Delivered. We hope you love it.',
        body: 'Need help with fitting, or is something not right? We’re one message away.',
      };
    case 'on_hold':
      return {
        chip: 'Needs your input', tone: 'care', title: 'One item needs a quick word with you',
        body: 'A part is out of stock, so we need your choice: wait for new stock, or take a refund. Our team will contact you.',
      };
    case 'late': {
      const day = momentDay(moment.late?.dueDay);
      const promise = day ? `We expected to deliver by ${day}. ` : '';
      return {
        chip: 'Taking a little longer', tone: 'care', title: 'Sorry, this is taking a little longer',
        body: shipped
          ? `${promise}Your parcel is still with the courier and we’re following up with them. We’ll message you the moment it moves.`
          : `${promise}Your order is still with us and our team is on it. We’ll message you the moment it moves.`,
      };
    }
    case 'delivery_failed':
    case 'out_for_delivery':
    case 'in_transit':
    case 'date_moved': {
      const note = moment.note?.trim() || undefined;
      const on = momentDayOf(moment.at);
      const updated = on ? `Updated ${on}` : undefined;
      if (moment.key === 'delivery_failed') {
        return {
          chip: 'Delivery attempt', tone: 'care', title: 'The courier couldn’t deliver this time',
          body: 'The courier will try again. Keep your phone close, or message us if you’d like a different time.',
          note, updated,
        };
      }
      if (moment.key === 'out_for_delivery') {
        return {
          chip: 'Out for delivery', tone: 'go', title: 'Out for delivery',
          body: 'Your parcel is with the delivery partner in your area. Keep your phone close.',
          note, updated,
        };
      }
      if (moment.key === 'date_moved') {
        const day = momentDay(moment.newDay);
        return {
          chip: 'Date updated', tone: 'care', title: 'Your delivery date has changed',
          body: day ? `New expected date: ${day}. We’re sorry for the wait.` : 'We’ve updated your expected delivery date. We’re sorry for the wait.',
          updated,
        };
      }
      return { chip: 'In transit', tone: 'go', title: 'Your parcel is moving', body: 'Your parcel is on its way with the courier.', note, updated };
    }
    case 'partly':
      return {
        chip: 'Part shipped', tone: 'care', title: 'Part of your order is on its way',
        body: 'Some of your items have shipped. The rest follow separately, and we’ll tell you when they leave.',
      };
    case 'shipped':
      return { chip: 'Shipped', tone: 'go', title: 'On the road to you', body: 'Your parcel is with the courier.' };
    case 'packed':
      return {
        chip: 'Packed', tone: 'go', title: 'Packed and ready to go',
        body: 'Your parcel is sealed and labelled. The courier picks it up next, and we’ll send you the tracking details when it leaves.',
      };
    case 'preparing':
      return {
        chip: 'Preparing', tone: 'go', title: 'We’re getting your parts ready',
        body: 'Our team is checking each part before it is packed.',
      };
    case 'placed':
    default:
      return {
        chip: 'Order placed', tone: 'go', title: 'Order placed. Thank you!',
        body: 'We have your order, and our team will start on it shortly.',
      };
  }
}

const UPDATE_KEYS: ReadonlySet<MomentKey> = new Set(['delivery_failed', 'out_for_delivery', 'date_moved', 'in_transit']);

/**
 * What "the same update" means for play-once: the scene, plus the return step, plus
 * the time of a delivery update (a second failed attempt is a new update).
 */
export function momentSignature(moment: OrderMomentData): string {
  if (moment.key === 'returning') return `returning:${moment.returnStep ?? 0}`;
  if (UPDATE_KEYS.has(moment.key) && moment.at) return `${moment.key}:${moment.at}`;
  return moment.key;
}

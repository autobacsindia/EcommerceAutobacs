/**
 * Order moments — the words for each picture, and the play-once memory.
 *
 * The scene key comes from the server (GET /orders/:id → `moment`, built by
 * Back-end/server/utils/orderMoment.js from confirmed order state). This file never
 * decides WHICH moment an order is in; it only words it. Owner-approved designs,
 * 2026-11-26 (artifact "Autobacs Order Moments").
 */
import { formatRupees } from '@/lib/formatRupees';

export type MomentKey =
  | 'payment_failed' | 'refunded' | 'cancelled' | 'returning' | 'delivered' | 'on_hold'
  | 'late' | 'partly' | 'shipped' | 'packed' | 'preparing' | 'placed';

export interface OrderMomentData {
  key: MomentKey;
  refundDue?: boolean;
  refund?: { amount: number } | null;
  returnStep?: number;
  late?: { dueDay: string };
}

export type MomentTone = 'go' | 'care' | 'calm';

export interface MomentCopy {
  chip: string;
  tone: MomentTone;
  title: string;
  body: string;
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

/** What "the same update" means for play-once: the scene, plus the return step. */
export function momentSignature(moment: OrderMomentData): string {
  return moment.key === 'returning' ? `returning:${moment.returnStep ?? 0}` : moment.key;
}

const storageKey = (orderId: string) => `ab:order-moment:${orderId}`;

/** True when this browser already played this exact update for this order. */
export function alreadyPlayed(orderId: string, signature: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(orderId)) === signature;
  } catch {
    return false; // private mode / blocked storage: play it, harmlessly
  }
}

export function rememberPlayed(orderId: string, signature: string): void {
  try {
    window.localStorage.setItem(storageKey(orderId), signature);
  } catch {
    /* storage blocked: the moment simply plays again next visit */
  }
}

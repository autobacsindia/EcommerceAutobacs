/**
 * Order status wording + pill colours, shared by My orders and the order screen.
 * Wording mirrors the website so an email, the site and the app never describe the
 * same parcel three different ways. (Moved here unchanged from app/orders.tsx.)
 */
import { colors } from '../theme';

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'grey' | 'red' }> = {
  awaiting_payment: { label: 'Awaiting payment', tone: 'amber' },
  processing: { label: 'Processing', tone: 'amber' },
  shipped: { label: 'Shipped', tone: 'green' },
  delivered: { label: 'Delivered', tone: 'green' },
  returned: { label: 'Returned', tone: 'grey' },
  cancelled: { label: 'Cancelled', tone: 'red' },
};

const TONES = {
  green: { bg: colors.greenSoft, fg: colors.green },
  amber: { bg: colors.goldSoft, fg: colors.ink2 },
  grey: { bg: colors.page, fg: colors.muted },
  red: { bg: colors.redSoft, fg: colors.red },
};

export function orderStatus(code: string) {
  const status = STATUS[code] ?? { label: code, tone: 'grey' as const };
  return { status, tone: TONES[status.tone] };
}

/** "Paid" only when the server says so. */
export function paymentLabel(paymentStatus: string): string {
  return paymentStatus === 'paid' ? 'Paid' : paymentStatus === 'refunded' ? 'Refunded' : 'Not paid';
}

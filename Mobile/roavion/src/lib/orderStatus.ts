/**
 * How an order's state is worded and coloured, in one place.
 *
 * The list screen and the detail screen both show it, and before this they each
 * carried their own copy — which is how a parcel ends up called "Shipped" on one
 * screen and "Dispatched" on the next. The wording also mirrors the website and
 * the confirmation email on purpose: a customer who reads all three should not
 * have to work out whether they are being told about the same parcel.
 */
import { colors } from '../theme';

export type Tone = 'green' | 'amber' | 'grey' | 'red';

export const STATUS: Record<string, { label: string; tone: Tone }> = {
  awaiting_payment: { label: 'Awaiting payment', tone: 'amber' },
  processing: { label: 'Processing', tone: 'amber' },
  shipped: { label: 'Shipped', tone: 'green' },
  delivered: { label: 'Delivered', tone: 'green' },
  returned: { label: 'Returned', tone: 'grey' },
  cancelled: { label: 'Cancelled', tone: 'red' },
};

export const TONES: Record<Tone, { bg: string; fg: string }> = {
  green: { bg: colors.greenSoft, fg: colors.green },
  amber: { bg: '#fdf3e2', fg: '#9a6700' },
  grey: { bg: '#eceeed', fg: colors.muted },
  red: { bg: '#fdeaee', fg: colors.red },
};

/** An unknown status shows its own name rather than nothing — a new status on
 *  the server must never render a blank pill on an app nobody has updated. */
export const statusOf = (status: string) =>
  STATUS[status] ?? { label: status.replace(/_/g, ' '), tone: 'grey' as const };

/**
 * The journey a normal order takes, for the progress track on the detail
 * screen. Cancelled and returned are deliberately absent: they are not steps
 * towards delivery, they are the order leaving the path, and drawing them as
 * the "next step" would read as a promise.
 */
export const JOURNEY = ['processing', 'shipped', 'delivered'] as const;

export const isOffPath = (status: string) => status === 'cancelled' || status === 'returned';

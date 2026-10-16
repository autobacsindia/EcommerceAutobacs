/**
 * Payment status and Razorpay offers, shown the same way on the customer's order
 * page and in admin.
 *
 * Both read the server's word only: `paymentStatus` is set by the verified
 * webhook path, and `gatewayOffer` is written there after Razorpay itself confirmed
 * the offer. Nothing here computes money — it displays what the order recorded.
 */
import { BadgePercent, CheckCircle, Clock, RotateCcw, XCircle } from 'lucide-react';

/** A Razorpay offer applied at checkout (see Order.gatewayOffer on the API). */
export interface GatewayOffer {
  offerIds?: string[];
  name?: string;
  /** Rupees the offer took off. */
  discount: number;
  /** Rupees actually charged. */
  amountPaid: number;
  paymentId?: string;
}

type Tone = 'store' | 'admin';

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS: Record<string, { label: string; store: string; admin: string; Icon: typeof Clock }> = {
  paid: { label: 'Paid', store: 'bg-green-500/10 text-green-700 border-green-500/30', admin: 'bg-green-100 text-green-800 border-green-200', Icon: CheckCircle },
  pending: { label: 'Awaiting payment', store: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/30', admin: 'bg-yellow-100 text-yellow-800 border-yellow-200', Icon: Clock },
  failed: { label: 'Payment failed', store: 'bg-red-500/10 text-red-600 border-red-500/30', admin: 'bg-red-100 text-red-800 border-red-200', Icon: XCircle },
  refunded: { label: 'Refunded', store: 'bg-obsidian-raised text-ink/70 border-hairline', admin: 'bg-gray-100 text-gray-800 border-gray-200', Icon: RotateCcw },
  cancelled: { label: 'Payment cancelled', store: 'bg-obsidian-raised text-ink/70 border-hairline', admin: 'bg-gray-100 text-gray-800 border-gray-200', Icon: XCircle },
  expired: { label: 'Payment link expired', store: 'bg-obsidian-raised text-ink/70 border-hairline', admin: 'bg-gray-100 text-gray-800 border-gray-200', Icon: Clock },
};

/** "Paid", "Awaiting payment", "Payment failed"… as a pill. */
export function PaymentStatusTag({ paymentStatus, tone = 'store' }: { paymentStatus?: string | null; tone?: Tone }) {
  const s = STATUS[(paymentStatus || 'pending').toLowerCase()] ?? STATUS.pending;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${tone === 'store' ? s.store : s.admin}`}
      data-testid="payment-status-tag"
    >
      <s.Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {s.label}
    </span>
  );
}

/**
 * Under the order total: the Razorpay offer and what was actually paid. Renders
 * nothing for an order without one.
 */
export function GatewayOfferRows({ offer, tone = 'store' }: { offer?: GatewayOffer | null; tone?: Tone }) {
  if (!offer || !(offer.discount > 0)) return null;
  const muted = tone === 'store' ? 'text-ink-muted' : 'text-gray-600';
  const strong = tone === 'store' ? 'text-ink' : 'text-gray-900';
  return (
    <div className="mt-2 space-y-1.5" data-testid="gateway-offer">
      <div className="flex justify-between gap-3">
        <span className={`flex items-start gap-1.5 ${muted}`}>
          <BadgePercent className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
          <span>
            Razorpay offer
            {offer.name && <span className="block text-xs">{offer.name}</span>}
          </span>
        </span>
        <span className="shrink-0 text-green-700">-{inr(offer.discount)}</span>
      </div>
      <div className={`flex justify-between font-semibold ${strong}`}>
        <span>{tone === 'store' ? 'You paid' : 'Amount paid'}</span>
        <span>{inr(offer.amountPaid)}</span>
      </div>
    </div>
  );
}

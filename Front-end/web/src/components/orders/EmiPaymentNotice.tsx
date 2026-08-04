import { Info } from 'lucide-react';
import type { OrderPaymentSummary } from '@/lib/types';

/**
 * EMI plan summary + the refund caveat, for an order paid on EMI.
 *
 * Renders nothing for non-EMI payments, so callers can drop it in unconditionally.
 *
 * WHY THE CAVEAT IS HERE AND NOT ONLY IN AN EMAIL: on EMI the loan is between the
 * customer and their bank, not us. We are settled the full amount and never touch the
 * interest — so when a refund lands, the customer is still out of pocket for interest
 * already billed plus any bank cancellation charge, and neither we nor Razorpay can
 * reverse those. Stating it on the order (not first in a refund email, when they are
 * already unhappy) is what keeps it from becoming a dispute.
 *
 * `tone` picks the palette: the storefront order page is on the dark obsidian theme,
 * the admin is on the light one.
 */
export default function EmiPaymentNotice({
  payment,
  tone = 'dark',
}: {
  payment?: OrderPaymentSummary | string | null;
  tone?: 'dark' | 'light';
}) {
  if (!payment || typeof payment === 'string') return null;
  const emi = payment.methodDetails?.emi;
  if (!emi) return null;

  const label = payment.emiPlanLabel || 'EMI';
  const isDark = tone === 'dark';

  return (
    <div
      className={
        isDark
          ? 'rounded-sm border border-gold/30 bg-gold/5 p-3'
          : 'rounded-lg border border-amber-200 bg-amber-50 p-3'
      }
    >
      <div className="flex items-start gap-2">
        <Info className={`mt-0.5 h-4 w-4 shrink-0 ${isDark ? 'text-gold' : 'text-amber-600'}`} />
        <div className="space-y-1">
          <p className={`text-xs font-display font-bold ${isDark ? 'text-ink/80' : 'text-amber-900'}`}>
            {label}
          </p>
          <p className={`text-xs leading-relaxed ${isDark ? 'text-ink-muted' : 'text-amber-800'}`}>
            Your bank charged the full order amount and converted it into instalments.
            The interest is charged by your bank, not by Autobacs India. If this order is
            refunded, the bank returns the principal only — interest already billed and
            any cancellation charge set by your bank are not refundable, and refunds take
            5–7 business days.
          </p>
        </div>
      </div>
    </div>
  );
}

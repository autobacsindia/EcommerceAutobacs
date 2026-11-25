import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The "Nothing Extra" delivery note (Herald's all-teams meeting, 2026-11-23). The
 * wording is the owner's, word for word — change it only with their OK.
 *
 * Styled as a calm information note (neutral surface, info icon), not a warning:
 * it sets an honest expectation, it does not alarm.
 */
export const CHECKOUT_DELIVERY_NOTE =
  "We deal in machinery and equipment. General delivery is 7–10 days, up to 15 days for heavy goods. That's not where we aim to be. We keep you in the loop throughout, and we're improving every week to serve you better.";

export default function CheckoutDeliveryNote({ className }: { className?: string }) {
  return (
    <aside
      role="note"
      aria-label="Delivery time"
      className={cn('flex items-start gap-3 rounded-lg border border-hairline bg-gold-soft p-4', className)}
      data-testid="checkout-delivery-note"
    >
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden />
      <p className="font-display text-sm leading-relaxed text-ink/80">{CHECKOUT_DELIVERY_NOTE}</p>
    </aside>
  );
}

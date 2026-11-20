import type { CardFeeWaiver } from '@/hooks/queries/useCardFeeWaivers';

/**
 * Black Friday "₹0 DELIVERY" diagonal corner ribbon (owner, 2026-11-20). ONE component
 * for every surface (hero cards, product grid cards, home shelf tiles, the product page
 * photo) so they always match.
 *
 * Usage: render it inside the photo box (which must be `position: relative`). It fills
 * that box with a clipping layer (`.zd-ribbon-box`, rounded like its parent), so the
 * slope is cut cleanly at the top-right corner. That layer is a size container: the band
 * scales itself to the photo it sits on (small tile → 7.5px text, product page → 12px),
 * never wraps, takes no clicks and is absolutely placed (no layout shift).
 *
 * Callers decide WHETHER to show it: only when the server sent a fee waiver for the
 * product (`useCardFeeWaivers`), which it does only for products orderable now while the
 * ₹0-fees offer is live. Anything top-left (the Save tag) must sit above it (z-index ≥ 2).
 * Styles: `.zd-ribbon*` in app/globals.css.
 */
export function ZeroDeliveryRibbon({ testId = 'zero-delivery-ribbon' }: { testId?: string }) {
  return (
    <span className="zd-ribbon-box" aria-hidden="true">
      <span className="zd-ribbon" data-testid={testId}>₹0 Delivery</span>
    </span>
  );
}

/** "Save ₹12,224+" — the discount plus the fees waived, floored; null below ₹1. */
export function zeroDeliverySaveLabel(waiver: CardFeeWaiver | null | undefined, format: (n: number) => string): string | null {
  if (!waiver) return null;
  const rupees = Math.floor(waiver.save);
  return rupees >= 1 ? `Save ${format(rupees)}+` : null;
}

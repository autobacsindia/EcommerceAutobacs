import type { CardFeeWaiver } from '@/hooks/queries/useCardFeeWaivers';

/**
 * Black Friday "receipt tear-off" for product cards (owner's pick, 2026-11-20): under
 * the price, a small receipt with each delivery fee struck through to ₹0 and "You pay"
 * = the card's price. Colour code: red = the discount badge, green = ₹0 fees.
 *
 * Every figure is the server's (`useCardFeeWaivers`), for the CHEAPEST PIN, so the struck
 * amounts are a floor and the badge reads "Save ₹X+". Nothing is added up here except
 * flooring the badge to whole rupees, which can only under-state.
 *
 * Fixed height whether loading or loaded, so the grid never shifts (CLS); no images.
 */

/** "Save ₹12,224+" — the discount plus the fees waived, floored; null below ₹1. */
export function zeroDeliverySaveLabel(waiver: CardFeeWaiver | null | undefined, format: (n: number) => string): string | null {
  if (!waiver) return null;
  const rupees = Math.floor(waiver.save);
  return rupees >= 1 ? `Save ${format(rupees)}+` : null;
}

/** Green corner ribbon over the photo. Sits inside the image's reserved square. */
export function ZeroDeliveryRibbon() {
  return (
    <span
      data-testid="zero-delivery-ribbon"
      className="pointer-events-none absolute bottom-0 right-0 rounded-tl-lg bg-emerald-600 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white shadow-sm"
    >
      ₹0 Delivery
    </span>
  );
}

// 5 rows × 15px + padding + the dashed tear line. Kept in one place so the skeleton
// and the receipt are the same height.
const BOX = 'mt-2 h-[92px] rounded-md border border-dashed border-emerald-600/40 bg-emerald-50/70 px-2 py-1.5 text-[11px] leading-[15px]';

function Row({ label, amount, format }: { label: string; amount: number; format: (n: number) => string }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="truncate text-ink-muted">{label}</span>
      <span className="shrink-0 whitespace-nowrap">
        {amount > 0 && <s className="mr-1 text-ink-muted">{format(amount)}</s>}
        <span className="font-bold text-emerald-700">{format(0)}</span>
      </span>
    </div>
  );
}

export default function ZeroDeliveryReceipt({
  waiver,
  pending = false,
  price,
  format,
}: {
  waiver: CardFeeWaiver | null | undefined;
  /** Offer live, figures still loading: reserve the space. */
  pending?: boolean;
  /** The price the card shows: what the shopper pays, fees included. */
  price: number;
  /** The page's own formatter (CurrencyContext); pass an exact one so paise show. */
  format: (n: number) => string;
}) {
  if (!waiver) {
    return pending ? <div aria-hidden data-testid="zero-delivery-receipt-pending" className={`${BOX} animate-pulse`} /> : null;
  }
  return (
    <div data-testid="zero-delivery-receipt" className={BOX} aria-label="Black Friday: delivery fees are ₹0">
      <Row label="Shipping" amount={waiver.shipping} format={format} />
      <Row label="Packing" amount={waiver.packing} format={format} />
      <Row label="Handling" amount={waiver.handling} format={format} />
      <Row label="Other fees" amount={waiver.other} format={format} />
      <div className="flex items-baseline justify-between gap-1 border-t border-dashed border-emerald-600/40 font-bold text-ink">
        <span>You pay</span>
        <span className="whitespace-nowrap">{format(price)}</span>
      </div>
    </div>
  );
}

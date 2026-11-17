import { formatRupees } from '@/lib/formatRupees';

/** The delivery-fee snapshot stored on an order (never re-derived from today's rates). */
export interface OrderDeliveryFeesSnapshot {
  pin?: string | null;
  remote?: boolean;
  distanceKm?: number | null;
  place?: { district?: string | null; state?: string | null } | null;
  band?: { upToKm: number | null; ratePerKg: number; slabRate?: number } | null;
  mode?: 'courier' | 'freight';
  chargedKg?: number;
  estimated?: boolean;
  gstOnFeesPercent?: number;
  lines: { code: string; label: string; amount: number }[];
  total: number;
  charged: number;
  offer: { code: string; applied: boolean; saving: number };
}

interface Props {
  fees: OrderDeliveryFeesSnapshot | null | undefined;
  /** What was charged for shipping on orders without a snapshot (older orders). */
  shippingCost: number;
  /** Admin view adds the weight/PIN detail staff need to book the courier. */
  admin?: boolean;
  /** Old orders: how to word "no shipping charged". */
  legacyNoChargeLabel?: string;
}

const money = (n: number) => formatRupees(n ?? 0, { exact: true });

/**
 * Delivery-fee rows for an order summary — customer and admin order pages.
 * Rendered only from the order's own snapshot: an order is an immutable financial
 * record, so today's rate card must never change what it says was charged.
 */
export default function OrderDeliveryFees({ fees, shippingCost, admin = false, legacyNoChargeLabel = 'Extra — paid on delivery' }: Props) {
  if (!fees) {
    return (
      <div className="flex justify-between">
        <span className="text-ink-muted">Shipping</span>
        <span className="text-ink/70">{(shippingCost || 0) > 0 ? money(shippingCost) : legacyNoChargeLabel}</span>
      </div>
    );
  }
  const bf = fees.offer.applied;
  const waived = fees.charged < fees.total;
  return (
    <div className="space-y-1.5" data-testid="order-delivery-fees">
      {fees.lines.map((l) => (
        <div key={l.code} className="flex justify-between gap-3">
          <span className="text-ink-muted">{l.label}</span>
          {bf ? (
            // Black Friday: the full fee, struck through, and the ₹0 the customer paid.
            <span className="text-right">
              <s className="text-ink-muted">{money(l.amount)}</s>{' '}
              <span className="font-semibold text-green-700">{money(0)} (Black Friday offer)</span>
            </span>
          ) : (
            <span className={waived ? 'text-ink-muted line-through' : 'text-ink/70'}>{money(l.amount)}</span>
          )}
        </div>
      ))}
      {bf ? (
        <div className="flex justify-between rounded-md bg-green-50 px-2 py-1.5 font-semibold text-green-700">
          <span>🎉 You saved {money(fees.offer.saving)} with the Black Friday offer</span>
        </div>
      ) : waived ? (
        <div className="flex justify-between text-green-700">
          <span>Delivery fees waived (coupon)</span>
          <span>-{money(fees.total - fees.charged)}</span>
        </div>
      ) : null}
      <div className="flex justify-between font-semibold">
        <span className="text-ink">Delivery fees charged</span>
        <span className="text-ink">{money(fees.charged)}</span>
      </div>
      {admin && (
        <p className="text-xs text-ink-muted">
          {fees.mode === 'freight' ? 'Freight' : 'Courier'} · {fees.chargedKg} kg charged
          {fees.pin ? ` · PIN ${fees.pin}` : ''}{fees.remote ? ' (remote area)' : ''}
          {fees.place?.district ? ` · ${fees.place.district}${fees.place.state ? `, ${fees.place.state}` : ''}` : ''}
          {typeof fees.distanceKm === 'number' ? ` · ~${fees.distanceKm.toLocaleString('en-IN')} km` : ''}
          {fees.band
            ? fees.mode === 'courier' && typeof fees.band.slabRate === 'number'
              ? ` · ₹${fees.band.slabRate}/slab band`
              : ` · ₹${fees.band.ratePerKg}/kg band`
            : ''}
          {fees.estimated ? ' · box size estimated' : ''}
          {' · '}book as PREPAID — the customer must not pay the courier again.
        </p>
      )}
    </div>
  );
}

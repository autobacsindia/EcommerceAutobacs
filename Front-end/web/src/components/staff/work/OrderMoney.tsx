import type { OrderMoney, OrderMoneyLine } from './types';
import { rupees } from '@/components/staff/sales/types';

const NA = 'Price not saved';
const amount = (n: number | null) => (n == null ? NA : rupees(n));

/** One item's price on the order: "₹1,200 × 3 = ₹3,600" (the order's own saved price). */
export function LinePrice({ line }: { line: OrderMoneyLine }) {
  if (line.price == null) return <p className="text-xs text-amber-700">{NA}</p>;
  return (
    <p className="text-xs text-gray-600" data-testid="line-price">
      {line.listPrice != null && <span className="mr-1 text-gray-400 line-through">{rupees(line.listPrice)}</span>}
      {rupees(line.price)} × {line.quantity} = <span className="font-semibold text-gray-900">{amount(line.lineTotal)}</span>
    </p>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-0.5 ${strong ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
      <dt>{label}</dt>
      <dd className="whitespace-nowrap text-right">{value}</dd>
    </div>
  );
}

/**
 * The order's totals under its priced items, so accounts can tick each line off
 * against the payment. Every figure is the order's own saved copy.
 */
export function OrderMoneySummary({ money, itemCount }: { money: OrderMoney; itemCount: number }) {
  const mismatch = money.itemsTotal != null && money.subtotal != null && money.itemsTotal !== money.subtotal;
  return (
    <div className="mt-2 rounded-lg bg-gray-50 p-3" aria-label="Order amount">
      <dl>
        <Row label={`Items (${itemCount})`} value={amount(money.subtotal)} />
        {money.discount > 0 && (
          <Row label={money.couponCode ? `Discount (${money.couponCode})` : 'Discount'} value={`−${rupees(money.discount)}`} />
        )}
        <Row label="Delivery" value={money.shipping > 0 ? rupees(money.shipping) : 'Free'} />
        <Row label="Order total" value={amount(money.total)} strong />
        {money.tax > 0 && <p className="text-right text-xs text-gray-500">Includes GST of {rupees(money.tax)}</p>}
        {money.gatewayOffer && (
          <>
            <Row label={`Bank offer at payment${money.gatewayOffer.name ? ` (${money.gatewayOffer.name})` : ''}`} value={`−${rupees(money.gatewayOffer.discount)}`} />
            {money.gatewayOffer.amountPaid != null && <Row label="Customer paid" value={rupees(money.gatewayOffer.amountPaid)} strong />}
          </>
        )}
      </dl>
      {money.itemsTotal == null && (
        <p className="mt-2 text-xs text-amber-800">Some items on this older order have no saved price, so the items cannot be added up.</p>
      )}
      {mismatch && (
        <p className="mt-2 text-xs text-amber-800">
          The items add up to {rupees(money.itemsTotal as number)}, but the order&apos;s items amount is {rupees(money.subtotal as number)}.
        </p>
      )}
    </div>
  );
}

import { formatDateIST } from '@/lib/datetime';
import { rupees } from '@/components/staff/sales/types';
import { paymentLabel, type CustomerPastSale } from './types';

/**
 * What this customer bought in the store / by phone before the website, matched
 * on their phone number (Back-end services/pastSaleService.customerPastSales).
 * Shown to staff only; renders nothing when there is none.
 */
export default function CustomerPastSales({ sales }: { sales: CustomerPastSale[] }) {
  if (!sales.length) return null;
  const total = sales.reduce((n, s) => n + s.totalAmount, 0);
  return (
    <section aria-label="Bought before the website" className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-900">Bought before the website</h2>
      <p className="mb-3 text-xs text-gray-500">{sales.length} past sale{sales.length === 1 ? '' : 's'} · {rupees(total)} · matched by phone</p>
      <ul className="space-y-2 text-sm">
        {sales.map((s) => (
          <li key={s.id} className="border-t border-gray-100 pt-2 first:border-0 first:pt-0">
            <p className="flex justify-between gap-2">
              <span className="text-gray-700">{formatDateIST(s.saleDate)}{s.invoiceNo ? ` · Bill ${s.invoiceNo}` : ''}</span>
              <span className="font-medium text-gray-900">{rupees(s.totalAmount)}</span>
            </p>
            <p className="text-xs text-gray-500">
              {s.items.map((i) => `${i.name}${i.quantity > 1 ? ` × ${i.quantity}` : ''}`).join(', ')}
              {` · ${paymentLabel(s.paymentMethod)}`}{s.soldBy ? ` · sold by ${s.soldBy}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

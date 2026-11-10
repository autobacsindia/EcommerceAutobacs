'use client';

import { formatRupees } from '@/lib/formatRupees';

export interface CustomerExtra {
  id: string;
  sequence: number;
  amount: number;
  reason: string;
  statusLabel: string;
  payUrl: string | null;
  hasReceipt: boolean;
}
export interface CustomerExtraTotals { extrasPaid: number; finalAmount: number }

/** Below the order total: each extra the customer agreed to, and how to pay what is waiting. */
export default function CustomerExtraCharges({ orderId, extras, totals }: { orderId: string; extras?: CustomerExtra[]; totals?: CustomerExtraTotals }) {
  if (!extras?.length) return null;
  return (
    <div className="mt-4 space-y-3 border-t border-hairline pt-4">
      <p className="text-[12px] font-display font-bold uppercase tracking-[0.12em] text-ink-muted">Extra charges</p>
      {extras.map((e) => (
        <div key={e.id} className="space-y-1">
          <div className="flex justify-between gap-3">
            <span className="text-ink/80">{e.reason}</span>
            <span className="shrink-0 font-bold text-ink">{formatRupees(e.amount, { exact: true })}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
            <span>{e.statusLabel}</span>
            {e.payUrl && <a href={e.payUrl} target="_blank" rel="noopener noreferrer" className="rounded-full bg-gold px-4 py-1.5 font-bold text-black">Pay now</a>}
            {e.hasReceipt && <a href={`/api/v1/orders/${orderId}/extra-charges/${e.id}/receipt`} className="underline">Download receipt</a>}
          </div>
        </div>
      ))}
      {totals && totals.extrasPaid > 0 && (
        <div className="flex justify-between border-t border-hairline pt-3">
          <span className="font-display text-ink">Total with extras</span>
          <span className="font-display font-bold text-gold">{formatRupees(totals.finalAmount, { exact: true })}</span>
        </div>
      )}
    </div>
  );
}

'use client';

import { money, type PaymentMargin } from './api';

/**
 * Our margin on a supplier payment, as the server worked it out: the customer's price
 * for these items (GST included, after coupon) against every supplier payment on them.
 * Red when below the admin's minimum, with procurement's reason and who accepted it.
 * e.g. sale ₹1,00,000, supplier ₹75,000 → "Margin 25% (₹25,000) — minimum 30%".
 */
export default function MarginBox({ m, compact = false }: { m: PaymentMargin; compact?: boolean }) {
  const pct = m.pct == null ? '—' : `${m.pct}%`;
  const amount = m.pct == null ? '' : ` (${money(m.sale - m.cost)})`;
  if (!m.below) {
    return (
      <p className="text-sm text-gray-700" aria-label="Margin">
        Margin <strong className="text-green-700">{pct}</strong>{amount} — customer paid {money(m.sale)}, supplier cost {money(m.cost)}
        {m.pct == null && ' · not known yet (foreign bill)'}
      </p>
    );
  }
  return (
    <div role="status" aria-label="Below minimum margin" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
      <p className="font-semibold">⚠️ Below minimum margin: {pct}{amount} — minimum {m.minPct}%</p>
      {!compact && <p>Customer paid {money(m.sale)} · supplier cost {money(m.cost)}</p>}
      <p className="mt-1"><span className="font-medium">Procurement’s reason:</span> {m.reason || '—'}</p>
      {m.acceptedByName && <p className="mt-1 text-xs text-red-700">Lower margin accepted by {m.acceptedByName}</p>}
    </div>
  );
}

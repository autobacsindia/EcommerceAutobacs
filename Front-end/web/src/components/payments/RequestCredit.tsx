'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { creditPreview, errorMessage, money, setRequestCredit, type PaymentRequest } from './api';
import { supplierKeys, type Supplier } from './suppliers';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The money on a payment that used supplier credit, as accounts checks it:
 *   Full bill ₹40,000 · Supplier credit used − ₹15,000 · Remaining to pay ₹25,000
 * or, when credit covers it all, "Nothing to transfer". Figures from the server.
 */
export function CreditSum({ r }: { r: PaymentRequest }) {
  if (!r.credit || r.bill == null) return null;
  const cur = r.currency || 'INR';
  const toPay = round2(r.bill - r.credit.amount);
  return (
    <dl className="mt-2 space-y-0.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" aria-label="Supplier credit used">
      <div className="flex justify-between gap-3"><dt>Full bill</dt><dd className="font-medium">{money(r.bill, cur)}</dd></div>
      <div className="flex justify-between gap-3"><dt>Supplier credit used</dt><dd className="font-medium">− {money(r.credit.amount, cur)}</dd></div>
      <div className="flex justify-between gap-3 border-t border-emerald-200 pt-1">
        <dt className="font-semibold">Remaining to pay</dt>
        <dd className="font-bold">{toPay > 0 ? money(toPay, cur) : 'Nothing — no transfer'}</dd>
      </div>
      {r.paidByCredit && r.status !== 'paid' && (
        <p className="pt-1 text-xs">Credit pays the whole bill. Approving it closes it as paid — it does not go to the admin to pay.</p>
      )}
    </dl>
  );
}

/**
 * On a waiting supplier payment (the server says who: `can.credit` — procurement on
 * their own, accounts and the admin on any): use the supplier's credit on it, or
 * take the credit off again. The server works out the figures and re-checks the
 * balance under a lock; this shows the supplier's balance and a preview.
 */
export function CreditControl({ r, onSaved }: { r: PaymentRequest; onSaved: (r: PaymentRequest) => void }) {
  const [error, setError] = useState('');
  const sid = r.supplier?.id || '';
  const cur = r.currency || 'INR';
  const supplierQ = useQuery({
    queryKey: supplierKeys.one(sid),
    queryFn: () => apiClient.get<{ supplier: Supplier }>(`/suppliers/${encodeURIComponent(sid)}`),
    enabled: Boolean(sid),
  });
  const save = useMutation({
    mutationFn: (body: { useCredit?: boolean; creditToUse?: number }) => setRequestCredit(r.id, { ...body, rev: r.rev }),
    onSuccess: (res) => { setError(''); supplierQ.refetch(); onSaved(res.request); },
    onError: (e) => setError(errorMessage(e, 'Could not change the credit. Refresh and try again.')),
  });
  const owed = (supplierQ.data?.supplier.credit || []).find((b) => b.currency === cur)?.owed ?? 0;
  const bill = r.bill ?? (cur === 'INR' ? r.amount : r.foreignAmount ?? 0);
  const used = r.credit?.amount ?? 0;
  // Using more: what this payment already uses + what the supplier still has, up to the bill.
  const more = owed > 0 && used < bill ? creditPreview(round2(owed + used), bill) : null;
  if (supplierQ.isPending) return null;
  if (!more && !used) return null;
  return (
    <div className="rounded-lg border border-emerald-200 bg-white p-3 text-sm" aria-label="Use supplier credit">
      <p className="text-gray-800">
        {r.payee.name} owes us <strong>{money(owed, cur)}</strong> more in supplier credit{used ? ` (this payment already uses ${money(used, cur)})` : ''}.
      </p>
      {more && (
        <p className="mt-1 text-gray-600">
          Using it: bill {money(more.bill, cur)} − credit {money(more.used, cur)} = {more.toPay > 0 ? `pay ${money(more.toPay, cur)}` : 'nothing to pay'} · {money(more.left, cur)} credit left.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {more && (
          <button type="button" disabled={save.isPending} onClick={() => save.mutate({ useCredit: true })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Use supplier credit
          </button>
        )}
        {used > 0 && (
          <button type="button" disabled={save.isPending} onClick={() => save.mutate({ creditToUse: 0 })}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Remove credit (pay the full bill)
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

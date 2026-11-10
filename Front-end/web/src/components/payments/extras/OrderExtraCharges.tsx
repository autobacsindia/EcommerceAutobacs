'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, TriangleAlert } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import { extraKeys, newClientKey, type OrderExtras } from './api';
import ExtraChargeCard from './ExtraChargeCard';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';

function AddExtraForm({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [clientKey] = useState(newClientKey);
  const add = useMutation({
    mutationFn: () => apiClient.post(`/staff/orders/${encodeURIComponent(orderId)}/extra-charges`, { amount: Number(amount), reason: reason.trim(), customerConfirmed: confirmed, clientKey }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: extraKeys.all }); onClose(); },
    onError: (e) => setError(errorMessage(e, 'Could not save this extra charge.')),
  });
  return (
    <form className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }} aria-label="Add an extra charge">
      <div>
        <label htmlFor="extra-amount" className="mb-1 block text-xs font-medium text-gray-700">Extra amount, including GST (₹)</label>
        <input id="extra-amount" className={input} type="number" min={1} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div>
        <label htmlFor="extra-reason" className="mb-1 block text-xs font-medium text-gray-700">Reason (the customer will see this)</label>
        <textarea id="extra-reason" className={input} rows={2} required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Example: Larger screen fitting" />
      </div>
      <label className="flex items-start gap-2 text-sm text-gray-800">
        <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        The customer has confirmed they will pay this extra amount.
      </label>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={add.isPending || !confirmed} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Send to Accounts</button>
        <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold">Close</button>
      </div>
    </form>
  );
}

/** The extra charges of one order: staff order panel and Admin order page. */
export default function OrderExtraCharges({ orderId }: { orderId: string }) {
  const [adding, setAdding] = useState(false);
  const { data, isError } = useQuery({
    queryKey: extraKeys.order(orderId),
    queryFn: async () => (await apiClient.get(`/staff/orders/${encodeURIComponent(orderId)}/extra-charges`)) as unknown as OrderExtras,
  });
  if (isError || !data?.extras) return null;
  const { extras, totals, canAdd } = data;
  if (!extras.length && !canAdd) return null;

  return (
    <section aria-label="Extra charges" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Extra charges</p>
        {canAdd && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50">
            <Plus className="h-3.5 w-3.5" /> Add extra charge
          </button>
        )}
      </div>
      {totals.extrasWaiting > 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900"><TriangleAlert className="h-4 w-4 shrink-0" /> Extra {rupees(totals.extrasWaiting)} not paid yet. Delivery continues as normal.</p>
      )}
      {extras.length > 0 && (
        <p className="text-sm text-gray-800">Original {rupees(totals.original)} + extras paid {rupees(totals.extrasPaid)} = <strong>{rupees(totals.finalAmount)}</strong>{totals.extrasRefunded > 0 ? ` · ${rupees(totals.extrasRefunded)} refunded` : ''}</p>
      )}
      {adding && <AddExtraForm orderId={orderId} onClose={() => setAdding(false)} />}
      <ul className="space-y-2">{extras.map((e) => <ExtraChargeCard key={e.id} extra={e} />)}</ul>
    </section>
  );
}

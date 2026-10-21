'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, UserCheck } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { attributionKeys, staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';

export interface CreditedOrder {
  id: string;
  seller: { id: string; name: string } | null;
  history: { at: string; by: string; from: string | null; to: string | null; note: string }[];
}
interface Seller { id: string; name: string; isHead: boolean }

const NONE = '';

/**
 * "Sold by" on a paid website order — admin and marketing credit it to the GTM
 * salesman who closed the sale, so it counts in their orders and reports.
 *
 * Shows nothing for any other order (the server answers `null`). The server is
 * the authority: it re-checks who may do this, that the order is a paid website
 * order, and that nobody changed the credit since this screen loaded
 * (`expectedSalesUserId`) — so a stale screen gets "refresh", never a silent overwrite.
 */
export default function OrderSellerCredit({ orderId }: { orderId: string }) {
  const qc = useQueryClient();
  const orderQ = useQuery({
    queryKey: attributionKeys.order(orderId),
    queryFn: () => apiClient.get<{ order: CreditedOrder | null }>(`/staff/attribution/orders/${orderId}`).then((r) => r.order),
  });
  const order = orderQ.data ?? null;
  const sellersQ = useQuery({
    queryKey: attributionKeys.sellers(),
    queryFn: () => apiClient.get<{ sellers: Seller[] }>('/staff/attribution/sellers').then((r) => r.sellers),
    enabled: !!order,
    staleTime: 5 * 60 * 1000,
  });

  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const current = order?.seller?.id ?? NONE;
  const picked = choice ?? current;

  const save = useMutation({
    mutationFn: () => apiClient.put<{ order: CreditedOrder }>(`/staff/attribution/orders/${orderId}`, {
      salesUserId: picked || null,
      expectedSalesUserId: current || null,
      ...(note.trim() && { note: note.trim() }),
    }).then((r) => r.order),
    onSuccess: (updated) => {
      qc.setQueryData(attributionKeys.order(orderId), updated);
      // The salesman's "my orders" and the team lists now include (or drop) this order.
      qc.invalidateQueries({ queryKey: staffKeys.orders() });
      qc.invalidateQueries({ queryKey: attributionKeys.lists() });
      setChoice(null); setNote(''); setError('');
    },
    onError: (e: unknown) => {
      setError(e instanceof Error && e.message ? e.message : 'Could not save. Refresh and try again.');
      // A 409 means someone else changed it: show what is there now.
      qc.invalidateQueries({ queryKey: attributionKeys.order(orderId) });
    },
  });

  if (!order) return null;
  const sellers = sellersQ.data ?? [];
  // A credited salesman who has since left still shows by name.
  const options = order.seller && !sellers.some((s) => s.id === order.seller!.id)
    ? [...sellers, { id: order.seller.id, name: `${order.seller.name} (no longer selling)`, isHead: false }]
    : sellers;

  return (
    <div className="bg-white rounded-lg shadow" aria-label="Sold by">
      <div className="p-6 border-b">
        <h2 className="flex items-center gap-2 text-xl font-semibold"><UserCheck className="h-5 w-5" /> Sold by</h2>
        <p className="mt-1 text-sm text-gray-500">
          Paid on the website. If a salesman closed this sale, credit it to them so it counts in their orders.
        </p>
      </div>
      <div className="space-y-3 p-6">
        <p className="text-sm">
          Now: <strong>{order.seller ? order.seller.name : 'Website (no salesman)'}</strong>
        </p>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Credit to</span>
          <select aria-label="Credit to" value={picked} onChange={(e) => { setChoice(e.target.value); setError(''); }}
            disabled={sellersQ.isLoading || save.isPending}
            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value={NONE}>Website (no salesman)</option>
            {options.map((s) => <option key={s.id} value={s.id}>{s.name}{s.isHead ? ' (GTM head)' : ''}</option>)}
          </select>
        </label>
        {picked !== current && (
          <>
            <input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300}
              placeholder="Note (optional) — e.g. closed on a call"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <div className="flex gap-2">
              <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </button>
              <button type="button" onClick={() => { setChoice(null); setNote(''); setError(''); }}
                className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>
            </div>
          </>
        )}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {order.history.length > 0 && (
          <details className="text-xs text-gray-600">
            <summary className="cursor-pointer select-none">Changes ({order.history.length})</summary>
            <ol className="mt-2 space-y-1">
              {order.history.map((h, i) => (
                <li key={i}>
                  {formatDateTimeIST(h.at)} — {h.by}: {h.from ?? 'Website'} → {h.to ?? 'Website'}{h.note && ` · ${h.note}`}
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </div>
  );
}

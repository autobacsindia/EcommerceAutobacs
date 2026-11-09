'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, UserCheck } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { attributionKeys, staffKeys } from '@/hooks/queries/keys';
import { formatDateTimeIST } from '@/lib/datetime';
import SellerChangeProofDialog, { type ProofFailure } from '@/components/orders/SellerChangeProofDialog';

export interface CreditedOrder {
  id: string;
  seller: { id: string; name: string } | null;
  history: {
    at: string; by: string; from: string | null; to: string | null; note: string;
    proofRequired?: boolean;
    files?: { id: string; name: string }[];
  }[];
}
interface Seller { id: string; name: string; isHead: boolean }

const NONE = '';

/**
 * "Sold by" on a paid website order — admin and marketing credit it to the GTM
 * salesman who closed the sale, so it counts in their orders and reports.
 *
 * Shows nothing for any other order (the server answers `null`). The server is
 * the authority: it re-checks who may do this, that the order is a paid website
 * order, that proof came with the change (the popup), and that nobody changed the
 * credit since this screen loaded (`expectedSalesUserId`) — so a stale screen gets
 * "refresh", never a silent overwrite.
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
  const [error, setError] = useState('');
  const current = order?.seller?.id ?? NONE;

  async function refresh() {
    // The salesman's "my orders" and the team lists now include (or drop) this order.
    qc.invalidateQueries({ queryKey: staffKeys.orders() });
    qc.invalidateQueries({ queryKey: attributionKeys.lists() });
    await qc.invalidateQueries({ queryKey: attributionKeys.order(orderId) });
  }

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
          <select aria-label="Credit to" value={current}
            onChange={(e) => { if (e.target.value !== current) { setChoice(e.target.value); setError(''); } }}
            disabled={sellersQ.isLoading || choice !== null}
            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value={NONE}>Website (no salesman)</option>
            {options.map((s) => <option key={s.id} value={s.id}>{s.name}{s.isHead ? ' (GTM head)' : ''}</option>)}
          </select>
        </label>
        {choice !== null && (
          <SellerChangeProofDialog
            orderId={orderId}
            fromId={current}
            fromName={order.seller?.name ?? 'Website (no salesman)'}
            toId={choice}
            toName={choice ? options.find((s) => s.id === choice)?.name ?? 'this salesman' : 'Website (no salesman)'}
            onCancel={() => setChoice(null)}
            onSaved={async () => { await refresh(); setChoice(null); }}
            onConflict={async ({ message }: ProofFailure) => { await refresh(); setChoice(null); setError(message); }}
          />
        )}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {order.history.length > 0 && (
          <details className="text-xs text-gray-600">
            <summary className="cursor-pointer select-none">Changes ({order.history.length})</summary>
            <ol className="mt-2 space-y-1">
              {order.history.map((h, i) => (
                <li key={i}>
                  {formatDateTimeIST(h.at)} — {h.by}: {h.from ?? 'Website'} → {h.to ?? 'Website'}{h.note && ` · ${h.note}`}
                  {h.proofRequired === false && <span className="text-gray-400"> · before proof was required</span>}
                  {!!h.files?.length && (
                    <span className="mt-0.5 flex flex-wrap gap-x-3">
                      {h.files.map((f) => (
                        <a key={f.id} href={`/api/v1/staff/attribution/orders/${encodeURIComponent(orderId)}/proof/${encodeURIComponent(f.id)}`}
                          target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 underline">
                          <Paperclip className="h-3 w-3" />{f.name}
                        </a>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </div>
  );
}

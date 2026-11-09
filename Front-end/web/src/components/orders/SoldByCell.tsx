'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { adminKeys } from '@/hooks/queries/keys';
import SellerChangeProofDialog, { type ProofFailure } from './SellerChangeProofDialog';

export type Seller = { id: string; name: string; isHead: boolean };

/** The salesmen an order can be credited to (GTM head + leads). Cached for the page. */
export function useSellers(enabled = true) {
  return useQuery({
    queryKey: adminKeys.sellers(),
    queryFn: async () => (await apiClient.get<{ sellers: Seller[] }>('/staff/attribution/sellers')).sellers ?? [],
    enabled,
    staleTime: 5 * 60_000,
  });
}

/**
 * "Sold by" for one order: Website order, or the salesman. On a PAID order a
 * dropdown starts a change, which needs proof in a popup (admin and marketing —
 * the server checks, and refuses if someone changed it meanwhile). The dropdown
 * keeps showing the current salesman until the server has confirmed the new one. An unpaid order shows it as text: its payment
 * links are tied to the salesman until it is paid.
 */
export default function SoldByCell({
  orderId, paid, seller, sellers, onChanged,
}: {
  orderId: string;
  paid: boolean;
  seller: { _id: string; name?: string } | null | undefined;
  sellers: Seller[] | undefined;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const current = seller?._id ? String(seller._id) : '';
  const label = current ? seller?.name || 'Salesman' : 'Website order';

  if (!paid || !sellers) {
    return <span className={`text-sm ${current ? 'font-medium text-gray-900' : 'text-gray-500'}`}>{label}</span>;
  }
  // Keep a former salesman (no longer active) visible as the current choice.
  const options = current && !sellers.some((s) => s.id === current) ? [...sellers, { id: current, name: `${label} (inactive)`, isHead: false }] : sellers;

  function change(next: string) {
    if (next === current) return;
    setError('');
    setTarget({ id: next, name: next ? options.find((s) => s.id === next)?.name || 'this salesman' : 'Website order' });
  }

  const refresh = () => qc.invalidateQueries({ queryKey: adminKeys.resource('orders') });

  return (
    <div className="min-w-[10rem]">
      <div className="flex items-center gap-1">
        <select
          aria-label="Sold by"
          value={current}
          disabled={!!target}
          onChange={(e) => change(e.target.value)}
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
        >
          <option value="">Website order</option>
          {options.map((s) => <option key={s.id} value={s.id}>{s.name}{s.isHead ? ' (GTM head)' : ''}</option>)}
        </select>
      </div>
      {error && <p role="alert" className="mt-1 max-w-[14rem] whitespace-normal text-xs text-red-700">{error}</p>}
      {target && (
        <SellerChangeProofDialog
          orderId={orderId}
          fromId={current}
          fromName={label}
          toId={target.id}
          toName={target.name}
          onCancel={() => setTarget(null)}
          onSaved={async () => { await refresh(); onChanged(); setTarget(null); }}
          onConflict={async ({ message }: ProofFailure) => { await refresh(); setTarget(null); setError(message); }}
        />
      )}
    </div>
  );
}

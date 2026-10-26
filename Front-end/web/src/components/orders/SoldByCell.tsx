'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { adminKeys } from '@/hooks/queries/keys';

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

const errorText = (e: unknown) => (e as { rawData?: { message?: string } })?.rawData?.message || 'Could not change the salesman.';

/**
 * "Sold by" for one order: Website order, or the salesman. On a PAID order a
 * dropdown changes it (admin and marketing — the server checks, and refuses if
 * someone changed it meanwhile). An unpaid order shows it as text: its payment
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = seller?._id ? String(seller._id) : '';
  const label = current ? seller?.name || 'Salesman' : 'Website order';

  if (!paid || !sellers) {
    return <span className={`text-sm ${current ? 'font-medium text-gray-900' : 'text-gray-500'}`}>{label}</span>;
  }
  // Keep a former salesman (no longer active) visible as the current choice.
  const options = current && !sellers.some((s) => s.id === current) ? [...sellers, { id: current, name: `${label} (inactive)`, isHead: false }] : sellers;

  async function change(next: string) {
    if (next === current) return;
    const toName = next ? options.find((s) => s.id === next)?.name || 'this salesman' : 'Website order';
    if (!window.confirm(`Change "Sold by" to ${toName}?`)) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.put(`/staff/attribution/orders/${encodeURIComponent(orderId)}`, {
        salesUserId: next || null,
        expectedSalesUserId: current || null,
      });
      await qc.invalidateQueries({ queryKey: adminKeys.resource('orders') });
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-[10rem]">
      <div className="flex items-center gap-1">
        <select
          aria-label="Sold by"
          value={current}
          disabled={busy}
          onChange={(e) => change(e.target.value)}
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
        >
          <option value="">Website order</option>
          {options.map((s) => <option key={s.id} value={s.id}>{s.name}{s.isHead ? ' (GTM head)' : ''}</option>)}
        </select>
        {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />}
      </div>
      {error && <p role="alert" className="mt-1 max-w-[14rem] whitespace-normal text-xs text-red-700">{error}</p>}
    </div>
  );
}

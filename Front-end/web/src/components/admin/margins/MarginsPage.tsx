'use client';

/**
 * Admin → Margins: what we make on what procurement buys.
 *
 *   • Totals for the date range (customer paid, supplier cost, margin ₹ and %).
 *   • Order lines — per item sold, lowest margin first or newest first.
 *   • Products — the same, added up per product.
 *   • Below-margin exceptions — every supplier payment under the minimum: who raised
 *     it, the order, how far below, the reason, who accepted or declined it.
 *   • The minimum margin % itself (admin only; new payments only).
 *
 * Every figure comes from the server (supplierMarginService) — nothing is worked out here.
 * Margin = (customer's price incl. GST, after coupon − supplier bill incl. GST) ÷ customer's price.
 */
import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { adminKeys } from '@/hooks/queries/keys';
import EntityLink from '@/components/ui/EntityLink';
import { formatDateIST } from '@/lib/datetime';

type Totals = { sale: number; cost: number; margin: number; marginPct: number | null; lines: number; belowLines: number; minPct: number };
type LineRow = {
  id: string; orderId: string; orderNumber: string; orderDate: string; name: string; quantity: number;
  sale: number; cost: number; margin: number; marginPct: number | null; minPct: number; below: boolean; refs: string[]; suppliers: string[];
};
type ProductRow = { productId: string; name: string; units: number; lines: number; sale: number; cost: number; margin: number; marginPct: number; belowLines: number };
type ExceptionRow = {
  id: string; number: string; status: string; orderId: string | null; orderNumber: string; items: string[]; supplier: string;
  requestedByName: string; createdAt: string; sale: number; cost: number; marginPct: number | null; minPct: number; shortBy: number;
  reason: string; acceptedByName: string; acceptedAt: string | null; decisionNote: string;
};
type Page<T> = { rows: T[]; nextCursor: string | null };
type Settings = { minPct: number; defaultPct: number; updatedByName: string; updatedAt: string | null };

const RESOURCE = 'margins';
const PAGE = 50;
const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pct = (n: number | null) => (n == null ? '—' : `${n}%`);
const errorText = (e: unknown) => (e as { message?: string })?.message || 'Could not load this. Please try again.';
const input = 'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const tabBtn = (on: boolean) => `rounded-lg px-3 py-1.5 text-sm font-medium ${on ? 'bg-blue-600 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`;
const STATUS: Record<string, string> = { submitted: 'Waiting for accounts', approved: 'Approved', on_hold: 'On hold', paid: 'Paid', declined: 'Declined', cancelled: 'Cancelled' };

type Tab = 'lines' | 'products' | 'exceptions';

function useRows<T>(path: string, params: Record<string, string>) {
  return useInfiniteQuery({
    queryKey: adminKeys.list(RESOURCE, { path, ...params }),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ limit: String(PAGE), ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)) });
      if (pageParam) q.set('cursor', pageParam);
      return apiClient.get<Page<T>>(`/admin/margins/${path}?${q.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

function MoreButton({ q }: { q: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown } }) {
  if (!q.hasNextPage) return null;
  return (
    <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
      {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
    </button>
  );
}

const Pct = ({ value, below }: { value: number | null; below: boolean }) => (
  <span className={`font-semibold ${below ? 'text-red-700' : value != null && value >= 0 ? 'text-green-700' : 'text-gray-500'}`}>{pct(value)}</span>
);

function TotalsBar({ from, to }: { from: string; to: string }) {
  const q = useQuery({
    queryKey: adminKeys.list(RESOURCE, { path: 'totals', from, to }),
    queryFn: () => apiClient.get<{ totals: Totals }>(`/admin/margins/totals?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`),
  });
  if (q.isPending) return <p className="text-sm text-gray-500"><Loader2 className="inline h-4 w-4 animate-spin" /> Loading totals…</p>;
  if (q.isError) return <p role="alert" className="text-sm text-red-700">{errorText(q.error)}</p>;
  const t = q.data.totals;
  const tiles: [string, string, string?][] = [
    ['Customers paid', rupees(t.sale)],
    ['Supplier cost', rupees(t.cost)],
    ['Our margin', rupees(t.margin), pct(t.marginPct)],
    ['Below minimum', `${t.belowLines} of ${t.lines} lines`, `minimum ${t.minPct}%`],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Margin totals">
      {tiles.map(([label, value, sub]) => (
        <div key={label} className="rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
          <p className="text-lg font-bold text-gray-900">{value}</p>
          {sub && <p className="text-xs text-gray-600">{sub}</p>}
        </div>
      ))}
    </div>
  );
}

function LinesTab({ from, to }: { from: string; to: string }) {
  const [sort, setSort] = useState<'lowest' | 'newest'>('lowest');
  const [belowOnly, setBelowOnly] = useState(false);
  const q = useRows<LineRow>('lines', { from, to, sort, below: belowOnly ? '1' : '' });
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? [];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">Sort
          <select aria-label="Sort lines" className={input} value={sort} onChange={(e) => setSort(e.target.value as 'lowest' | 'newest')}>
            <option value="lowest">Lowest margin first</option>
            <option value="newest">Newest first</option>
          </select>
        </label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={belowOnly} onChange={(e) => setBelowOnly(e.target.checked)} /> Below minimum only</label>
      </div>
      {q.isPending ? <p className="text-sm text-gray-500">Loading…</p> : q.isError ? <p role="alert" className="text-sm text-red-700">{errorText(q.error)}</p> : !rows.length ? (
        <p className="text-sm text-gray-500">No order lines with a supplier cost in this range.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-sm" aria-label="Margin by order line">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="p-2">Order</th><th className="p-2">Item</th><th className="p-2 text-right">Customer paid</th><th className="p-2 text-right">Supplier cost</th><th className="p-2 text-right">Margin</th><th className="p-2 text-right">%</th><th className="p-2">Supplier · payments</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-t border-gray-100 ${r.below ? 'bg-red-50/60' : ''}`}>
                  <td className="p-2 whitespace-nowrap"><EntityLink type="order" id={r.orderId} value={r.orderNumber} label="Order number" newTab /><div className="text-xs text-gray-500">{formatDateIST(r.orderDate)}</div></td>
                  <td className="p-2">{r.name}{r.quantity > 1 ? ` × ${r.quantity}` : ''}</td>
                  <td className="p-2 text-right">{rupees(r.sale)}</td>
                  <td className="p-2 text-right">{rupees(r.cost)}</td>
                  <td className="p-2 text-right">{rupees(r.margin)}</td>
                  <td className="p-2 text-right"><Pct value={r.marginPct} below={r.below} /></td>
                  <td className="p-2 text-xs text-gray-600">{r.suppliers.join(', ')}{r.refs.length ? ` · ${r.refs.join(', ')}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MoreButton q={q} />
    </div>
  );
}

function ProductsTab({ from, to }: { from: string; to: string }) {
  const [sort, setSort] = useState<'lowest' | 'sale'>('lowest');
  const q = useRows<ProductRow>('products', { from, to, sort });
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? [];
  return (
    <div>
      <label className="mb-3 flex items-center gap-2 text-sm">Sort
        <select aria-label="Sort products" className={input} value={sort} onChange={(e) => setSort(e.target.value as 'lowest' | 'sale')}>
          <option value="lowest">Lowest margin first</option>
          <option value="sale">Biggest sellers first</option>
        </select>
      </label>
      {q.isPending ? <p className="text-sm text-gray-500">Loading…</p> : q.isError ? <p role="alert" className="text-sm text-red-700">{errorText(q.error)}</p> : !rows.length ? (
        <p className="text-sm text-gray-500">No products bought from suppliers in this range.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-sm" aria-label="Margin by product">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="p-2">Product</th><th className="p-2 text-right">Units</th><th className="p-2 text-right">Customers paid</th><th className="p-2 text-right">Supplier cost</th><th className="p-2 text-right">Margin</th><th className="p-2 text-right">%</th><th className="p-2 text-right">Below min.</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId} className="border-t border-gray-100">
                  <td className="p-2">{r.name}</td>
                  <td className="p-2 text-right">{r.units}</td>
                  <td className="p-2 text-right">{rupees(r.sale)}</td>
                  <td className="p-2 text-right">{rupees(r.cost)}</td>
                  <td className="p-2 text-right">{rupees(r.margin)}</td>
                  <td className="p-2 text-right"><Pct value={r.marginPct} below={r.belowLines > 0} /></td>
                  <td className="p-2 text-right">{r.belowLines ? `${r.belowLines} of ${r.lines}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MoreButton q={q} />
    </div>
  );
}

function ExceptionsTab() {
  const q = useRows<ExceptionRow>('exceptions', {});
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? [];
  return (
    <div>
      <p className="mb-3 text-sm text-gray-600">Every supplier payment raised below the minimum margin — procurement had to give a reason, and accounts had to accept it.</p>
      {q.isPending ? <p className="text-sm text-gray-500">Loading…</p> : q.isError ? <p role="alert" className="text-sm text-red-700">{errorText(q.error)}</p> : !rows.length ? (
        <p className="text-sm text-gray-500">No below-margin payments yet.</p>
      ) : (
        <ul className="space-y-3" aria-label="Below-margin exceptions">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-red-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-gray-900">
                  {r.number}
                  {' · '}{r.orderId ? <EntityLink type="order" id={r.orderId} value={r.orderNumber} label="Order number" newTab /> : r.orderNumber}
                  {' · '}{r.items.join(', ')}
                </p>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">{STATUS[r.status] || r.status}</span>
              </div>
              <p className="mt-1 text-red-800">
                Margin <strong>{pct(r.marginPct)}</strong> (minimum {r.minPct}%) — customer paid {rupees(r.sale)}, supplier cost {rupees(r.cost)}, {rupees(r.shortBy)} over the most we should pay.
              </p>
              <p className="mt-1 text-gray-700"><span className="font-medium">Reason:</span> {r.reason || '—'}</p>
              <p className="mt-1 text-xs text-gray-500">
                Raised by {r.requestedByName} on {formatDateIST(r.createdAt)} · supplier {r.supplier || '—'}
                {r.acceptedByName ? ` · accepted by ${r.acceptedByName}${r.acceptedAt ? ` on ${formatDateIST(r.acceptedAt)}` : ''}` : ''}
                {r.decisionNote ? ` · declined: “${r.decisionNote}”` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
      <MoreButton q={q} />
    </div>
  );
}

function MinimumSetting() {
  const qc = useQueryClient();
  const key = adminKeys.list(RESOURCE, { path: 'settings' });
  const q = useQuery({ queryKey: key, queryFn: () => apiClient.get<{ settings: Settings }>('/admin/margins/settings') });
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState('');
  const save = useMutation({
    mutationFn: (minPct: string) => apiClient.put<{ settings: Settings }>('/admin/margins/settings', { minPct }),
    onSuccess: (res) => {
      qc.setQueryData(key, res);
      qc.invalidateQueries({ queryKey: adminKeys.resource(RESOURCE) });
      setDraft('');
      setMsg(`Saved: ${res.settings.minPct}% for new supplier payments.`);
    },
    onError: (e) => setMsg(errorText(e)),
  });
  const s = q.data?.settings;
  return (
    <form className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm" aria-label="Minimum margin"
      onSubmit={(e) => { e.preventDefault(); if (draft.trim()) save.mutate(draft.trim()); }}>
      <label className="flex flex-col gap-1">
        <span className="font-medium text-gray-800">Minimum margin (%)</span>
        <input aria-label="Minimum margin percent" className={`${input} w-28`} inputMode="decimal" placeholder={s ? String(s.minPct) : '30'} value={draft} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <button type="submit" disabled={save.isPending || !draft.trim()} className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">Save</button>
      <p className="w-full text-xs text-gray-500">
        Now {s ? `${s.minPct}%` : '…'}{s?.updatedByName ? ` (set by ${s.updatedByName}${s.updatedAt ? ` on ${formatDateIST(s.updatedAt)}` : ''})` : ' (default)'}.
        {' '}Below it, procurement must give a reason and accounts must approve. Changes apply to new payments only.
      </p>
      {msg && <p role="status" className="w-full text-xs text-gray-700">{msg}</p>}
    </form>
  );
}

export default function MarginsPage() {
  const [tab, setTab] = useState<Tab>('lines');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Margins</h1>
        <p className="text-sm text-gray-500">
          What we make on items bought from suppliers: what the customer paid (GST included, after coupon) against what we pay the supplier (GST included). Delivery fees are left out.
        </p>
      </div>
      <MinimumSetting />
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">From<input type="date" aria-label="From date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex flex-col gap-1">To<input type="date" aria-label="To date" className={input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {(from || to) && <button type="button" onClick={() => { setFrom(''); setTo(''); }} className="rounded-lg px-3 py-2 text-gray-700 hover:bg-gray-100">Clear dates</button>}
      </div>
      <TotalsBar from={from} to={to} />
      <div className="flex flex-wrap gap-2" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'lines'} className={tabBtn(tab === 'lines')} onClick={() => setTab('lines')}>Order lines</button>
        <button type="button" role="tab" aria-selected={tab === 'products'} className={tabBtn(tab === 'products')} onClick={() => setTab('products')}>Products</button>
        <button type="button" role="tab" aria-selected={tab === 'exceptions'} className={tabBtn(tab === 'exceptions')} onClick={() => setTab('exceptions')}>Below-margin exceptions</button>
      </div>
      {tab === 'lines' && <LinesTab from={from} to={to} />}
      {tab === 'products' && <ProductsTab from={from} to={to} />}
      {tab === 'exceptions' && <ExceptionsTab />}
    </div>
  );
}

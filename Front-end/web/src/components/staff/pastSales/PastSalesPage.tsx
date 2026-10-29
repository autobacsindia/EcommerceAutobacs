'use client';

import { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Loader2, Pencil, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import { pastSaleKeys } from '@/hooks/queries/keys';
import { formatDateIST, formatDateTimeIST } from '@/lib/datetime';
import { errorMessage, rupees } from '@/components/staff/sales/types';
import PastSaleForm from './PastSaleForm';
import PastSaleUpload from './PastSaleUpload';
import {
  channelLabel, paymentLabel, viewerOf,
  type PastSale, type PastSalePage, type PastSaleSeller, type PastSaleTotals, type Viewer,
} from './types';

const input = 'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100';
const ACTION_LABEL = { created: 'Entered', edited: 'Edited', deleted: 'Deleted', restored: 'Restored' } as const;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function History({ id }: { id: string }) {
  const q = useQuery({
    queryKey: pastSaleKeys.one(id),
    queryFn: () => apiClient.get<{ sale: PastSale }>(`/staff/past-sales/${encodeURIComponent(id)}`),
  });
  if (q.isPending) return <p className="text-xs text-gray-500">Loading history…</p>;
  if (q.isError) return <p className="text-xs text-red-700">{errorMessage(q.error, 'Could not load the history.')}</p>;
  return (
    <ol className="space-y-1.5 text-xs text-gray-600">
      {(q.data.sale.history || []).map((h, i) => (
        <li key={`${h.at}-${i}`}>
          <span className="font-medium text-gray-800">{ACTION_LABEL[h.action]}</span> by {h.by || 'someone'}, {formatDateTimeIST(h.at)}
          {h.changes.length > 0 && (
            <ul className="ml-4 list-disc">
              {h.changes.map((c) => <li key={c.field}>{c.field}: <s>{c.from || 'empty'}</s> → {c.to || 'empty'}</li>)}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

function SaleRow({ s, viewer, onEdit }: { s: PastSale; viewer: Viewer; onEdit: (s: PastSale) => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: pastSaleKeys.all });
  const remove = useMutation({
    mutationFn: () => apiClient.delete(`/staff/past-sales/${encodeURIComponent(s.id)}`),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(errorMessage(e, 'Could not delete the sale.')),
  });
  const restore = useMutation({
    mutationFn: () => apiClient.post(`/staff/past-sales/${encodeURIComponent(s.id)}/restore`, {}),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(errorMessage(e, 'Could not restore the sale.')),
  });

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {formatDateIST(s.saleDate)} · {s.customer.name} · {rupees(s.totalAmount)}
          </p>
          <p className="text-sm text-gray-600">
            {s.items.map((i) => `${i.name}${i.quantity > 1 ? ` × ${i.quantity}` : ''}`).join(', ')}
          </p>
          <p className="text-xs text-gray-500">
            {[s.invoiceNo && `Bill ${s.invoiceNo}`, paymentLabel(s.paymentMethod), channelLabel(s.channel),
              viewer.seesAll && `Sold by ${s.soldBy?.name || 'no salesman'}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        {s.deleted && <span className="shrink-0 rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-700">Deleted</span>}
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {s.customer.phone && <div className="flex gap-2"><dt className="text-gray-500">Phone</dt><dd>{s.customer.phone}</dd></div>}
            {s.customer.email && <div className="flex gap-2"><dt className="text-gray-500">Email</dt><dd className="break-all">{s.customer.email}</dd></div>}
            {(s.customer.city || s.customer.state) && <div className="flex gap-2"><dt className="text-gray-500">Place</dt><dd>{[s.customer.city, s.customer.state].filter(Boolean).join(', ')}</dd></div>}
            {s.vehicle && <div className="flex gap-2"><dt className="text-gray-500">Car</dt><dd>{s.vehicle}</dd></div>}
            {s.business && <div className="flex gap-2 sm:col-span-2"><dt className="text-gray-500">Business</dt><dd>{[s.business.legalName, s.business.gstin].filter(Boolean).join(' · ')}</dd></div>}
            <div className="flex gap-2"><dt className="text-gray-500">Items total</dt><dd>{rupees(s.itemsTotal)}</dd></div>
            {s.discount > 0 && <div className="flex gap-2"><dt className="text-gray-500">Discount</dt><dd>{rupees(s.discount)}</dd></div>}
            {s.gstAmount != null && <div className="flex gap-2"><dt className="text-gray-500">GST</dt><dd>{rupees(s.gstAmount)}</dd></div>}
            <div className="flex gap-2 sm:col-span-2"><dt className="text-gray-500">Entered</dt><dd>{s.enteredBy}, {formatDateTimeIST(s.enteredAt)}{s.batchId ? ' (sheet upload)' : ''}</dd></div>
            {s.deleted && <div className="flex gap-2 sm:col-span-2"><dt className="text-gray-500">Deleted</dt><dd>{s.deleted.by}{s.deleted.at ? `, ${formatDateTimeIST(s.deleted.at)}` : ''}</dd></div>}
          </dl>
          <ul className="text-sm text-gray-700">
            {s.items.map((i, n) => <li key={n}>{i.name} — {i.quantity} × {rupees(i.price)}</li>)}
          </ul>
          {s.amountMismatch && <p className="text-xs text-amber-700">The items minus the discount do not add up to the total paid — saved as written on the bill.</p>}
          {s.notes && <p className="rounded-lg bg-gray-50 p-2 text-sm text-gray-700">{s.notes}</p>}
          <div>
            <p className="mb-1 text-xs font-medium text-gray-700">History</p>
            <History id={s.id} />
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />} {open ? 'Less' : 'Details'}
        </button>
        {s.can.edit && (
          <button type="button" onClick={() => onEdit(s)}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Pencil className="h-4 w-4" /> Edit
          </button>
        )}
        {s.can.delete && (
          <button type="button" disabled={remove.isPending}
            onClick={() => { if (window.confirm(`Delete this sale (${s.customer.name}, ${rupees(s.totalAmount)})? It stops counting in the totals. You can restore it later.`)) remove.mutate(); }}
            className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        )}
        {s.can.restore && (
          <button type="button" disabled={restore.isPending} onClick={() => restore.mutate()}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <RotateCcw className="h-4 w-4" /> Restore
          </button>
        )}
      </div>
    </li>
  );
}

function Totals({ filters, viewer }: { filters: Record<string, string>; viewer: Viewer }) {
  const q = useQuery({
    queryKey: pastSaleKeys.totals(filters),
    queryFn: () => apiClient.get<PastSaleTotals>(`/staff/past-sales/totals?${new URLSearchParams(filters)}`),
  });
  if (q.isPending || q.isError) return null;
  const { sellers, total } = q.data;
  return (
    <section aria-label="Totals" className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-500">{viewer.seesAll ? 'All past sales' : 'My past sales'}{filters.from || filters.to ? ' in these dates' : ''}</p>
      <p className="text-2xl font-bold text-gray-900">{rupees(total.value)} <span className="text-base font-medium text-gray-500">· {total.sales} sale{total.sales === 1 ? '' : 's'}</span></p>
      {viewer.seesAll && sellers.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 font-medium">Salesman</th><th className="py-1 text-right font-medium">Sales</th><th className="py-1 text-right font-medium">Value</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {sellers.map((r) => (
              <tr key={r.id || 'none'}><td className="py-1.5">{r.name}</td><td className="py-1.5 text-right">{r.sales}</td><td className="py-1.5 text-right">{rupees(r.value)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * Past sales — made in the store, by phone or on WhatsApp before the website.
 * A salesman enters and corrects their own; accounts and the admin see all, and
 * can delete and restore. They count in the salesman totals here and show in a
 * customer's history on the lead page. They never reach orders, emails or queues.
 */
export default function PastSalesPage() {
  const { user } = useAuth();
  const viewer = viewerOf(user);
  const [mode, setMode] = useState<'list' | 'add' | 'upload'>('list');
  const [editing, setEditing] = useState<PastSale | null>(null);
  const [notice, setNotice] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [seller, setSeller] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const term = useDebounced(q.trim(), 300);

  const range = { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(seller ? { seller } : {}) };
  const listFilters = { ...range, ...(term ? { q: term } : {}), ...(showDeleted ? { deleted: '1' } : {}) };

  const sellers = useQuery({
    queryKey: pastSaleKeys.sellers(),
    queryFn: () => apiClient.get<{ sellers: PastSaleSeller[] }>('/staff/past-sales/sellers'),
    enabled: viewer.manage,
    staleTime: 5 * 60_000,
  });
  const list = useInfiniteQuery({
    queryKey: pastSaleKeys.list(listFilters),
    queryFn: ({ pageParam }) => apiClient.get<PastSalePage>(`/staff/past-sales?${new URLSearchParams({ ...listFilters, ...(pageParam ? { cursor: pageParam } : {}) })}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.sales) ?? [];

  const finish = (warnings: string[], message: string) => {
    setMode('list');
    setEditing(null);
    setNotice([message, ...warnings]);
  };

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Past sales</h1>
          <p className="text-sm text-gray-500">Sales made in the store, by phone or on WhatsApp before the website. They count in the sales totals and show in the customer&rsquo;s history. Customers are not contacted.</p>
        </div>
        {mode === 'list' && !editing && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setMode('add'); setNotice([]); }}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" /> Add a sale
            </button>
            <button type="button" onClick={() => { setMode('upload'); setNotice([]); }}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50">
              <Upload className="h-4 w-4" /> Upload a sheet
            </button>
          </div>
        )}
      </div>

      {notice.length > 0 && (
        <div role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
          {notice.map((n, i) => <p key={n} className={i ? 'mt-1 text-amber-800' : ''}>{n}</p>)}
        </div>
      )}

      {mode === 'add' && <PastSaleForm viewer={viewer} onDone={(w) => finish(w, 'Sale saved.')} onCancel={() => setMode('list')} />}
      {editing && <PastSaleForm key={editing.id} sale={editing} viewer={viewer} onDone={(w) => finish(w, 'Changes saved.')} onCancel={() => setEditing(null)} />}
      {mode === 'upload' && <PastSaleUpload viewer={viewer} onClose={() => setMode('list')} />}

      <Totals filters={range} viewer={viewer} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="mb-1 block text-xs font-medium text-gray-700">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Phone, bill no. or name" maxLength={100} className={`${input} w-56`} />
        </label>
        <label className="text-sm"><span className="mb-1 block text-xs font-medium text-gray-700">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
        </label>
        <label className="text-sm"><span className="mb-1 block text-xs font-medium text-gray-700">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
        </label>
        {viewer.manage && (
          <label className="text-sm"><span className="mb-1 block text-xs font-medium text-gray-700">Salesman</span>
            <select value={seller} onChange={(e) => setSeller(e.target.value)} className={input}>
              <option value="">Everyone</option>
              <option value="none">No salesman</option>
              {(sellers.data?.sellers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.current ? '' : ' (former)'}</option>)}
            </select>
          </label>
        )}
        {viewer.manage && (
          <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> Show deleted
          </label>
        )}
      </div>

      {list.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {list.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(list.error, 'Could not load past sales.')}</p>}
      {list.isSuccess && rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          {showDeleted ? 'No deleted sales.' : term || from || to || seller ? 'No sales match.' : 'No past sales yet. Add one, or upload a sheet.'}
        </p>
      )}

      <ul className="space-y-3">
        {rows.map((s) => <SaleRow key={s.id} s={s} viewer={viewer} onEdit={(sale) => { setEditing(sale); setMode('list'); setNotice([]); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />)}
      </ul>

      {list.hasNextPage && (
        <button type="button" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}

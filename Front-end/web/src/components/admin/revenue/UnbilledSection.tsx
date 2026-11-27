'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { adminKeys } from '@/hooks/queries/keys';
import { formatCurrency } from '@/lib/utils';
import { errorMessage } from '@/components/staff/sales/types';
import { orderRef, type RevenuePeriod, type UnbilledDecision, type UnbilledRow, type UnbilledState } from './types';

const dateIN = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
/** Today in IST as yyyy-mm-dd — the latest date the form accepts (the server checks too). */
const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

const TABS: { state: UnbilledState; label: string }[] = [
  { state: 'open', label: 'Counted' },
  { state: 'needs_check', label: 'To check' },
  { state: 'in_panel', label: 'Same as a website order' },
  { state: 'billed', label: 'Now billed' },
  { state: 'removed', label: 'Removed' },
];

/** Only a real web link is rendered as a link — never javascript: or similar. */
const isWebLink = (v?: string) => !!v && /^https:\/\/[^\s]+$/i.test(v);

function useRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: adminKeys.companyRevenueAll() }),
    qc.invalidateQueries({ queryKey: adminKeys.stats() }),
  ]);
}

/**
 * "Paid, no sale bill yet": money that came in with no Zoho invoice. Counted in
 * revenue and shown apart. Figures and decisions are the server's; this only shows them.
 */
export default function UnbilledSection({ period }: { period: RevenuePeriod }) {
  const [state, setState] = useState<UnbilledState>('open');
  const [adding, setAdding] = useState(false);
  const list = useInfiniteQuery({
    queryKey: adminKeys.unbilled(state, period),
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ state, period });
      if (pageParam) q.set('cursor', pageParam);
      return apiClient.get<{ receipts: UnbilledRow[]; nextCursor: string | null }>(`/admin/revenue/unbilled?${q.toString()}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.receipts) ?? [];

  return (
    <section id="unbilled" className="scroll-mt-20 rounded-2xl border border-amber-200 bg-white">
      <div className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-900">Paid, no sale bill yet</h2>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            aria-expanded={adding}
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white"
          >
            {adding ? 'Close' : 'Add paid sale without bill'}
          </button>
        </div>
        <p className="mt-1 text-sm text-gray-600">
          Money we received with no Zoho invoice yet. It <strong>is counted in revenue</strong> and shown here apart.
          It comes from the Zoho payments upload (money not on any bill) or is added by hand with proof.
          Once the sale bill is made in Zoho it drops out here and the bill counts instead — never both.
        </p>
        {adding && <AddForm onDone={() => { setAdding(false); setState('open'); }} />}
        <div role="group" aria-label="Show" className="mt-3 flex flex-wrap gap-1.5 text-xs">
          {TABS.map((t) => (
            <button
              key={t.state}
              type="button"
              aria-pressed={state === t.state}
              onClick={() => setState(t.state)}
              className={`rounded-full px-3 py-1 font-medium ${state === t.state ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {list.isError && <p role="alert" className="px-4 pb-4 text-sm text-red-700">{errorMessage(list.error, 'Could not load the list.')}</p>}
      {list.isPending && <p className="px-4 pb-4 text-sm text-gray-500">Loading…</p>}
      {!list.isPending && !list.isError && rows.length === 0 && <p className="px-4 pb-4 text-sm text-gray-500">Nothing here.</p>}
      <ul className="divide-y divide-gray-100 border-t border-gray-100">
        {rows.map((r) => <UnbilledItem key={r._id} row={r} />)}
      </ul>
      {list.hasNextPage && (
        <div className="p-4">
          <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} className="text-sm font-medium text-blue-700">
            {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
    </section>
  );
}

function UnbilledItem({ row }: { row: UnbilledRow }) {
  const refresh = useRefresh();
  const [asking, setAsking] = useState<'billed' | 'remove' | null>(null);
  const [text, setText] = useState('');
  const decide = useMutation({
    mutationFn: (body: { decision: UnbilledDecision; invoiceNumber?: string; note?: string }) =>
      apiClient.patch(`/admin/revenue/unbilled/${encodeURIComponent(row._id)}`, body),
    onSuccess: async () => { setAsking(null); setText(''); await refresh(); },
  });
  const o = row.order;
  const btn = 'rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50';

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium text-gray-900">
          {dateIN(row.receivedAt)} · {row.customerName} · {formatCurrency(row.amount)}
          {row.paymentTotal != null && row.paymentTotal !== row.amount && row.state !== 'billed' && (
            <span className="font-normal text-gray-500"> (of a {formatCurrency(row.paymentTotal)} payment; the rest is on a bill)</span>
          )}
        </p>
        <p className="text-gray-600">
          {row.source === 'zoho_payment' ? `Zoho payment ${row.paymentNumber ?? ''}` : `Added by ${row.addedByName || 'an admin'}`}
          {row.mode && ` · ${row.mode}`}
          {row.reference && ` · Ref ${row.reference}`}
          {row.billedAs && ` · Billed as ${row.billedAs}`}
        </p>
        {row.proof && (
          <p className="text-gray-600">
            Proof:{' '}
            {isWebLink(row.proof)
              ? <a href={row.proof} target="_blank" rel="noopener noreferrer" className="break-all text-blue-700 hover:underline">{row.proof}</a>
              : <span className="break-all">{row.proof}</span>}
          </p>
        )}
        {o && (
          <p className="text-gray-600">
            Looks like <a href={`/admin/orders/${o._id}`} className="text-blue-700 hover:underline">{orderRef(o._id)}</a> · {dateIN(o.createdAt)} · {o.shippingAddress?.fullName || '—'} · {formatCurrency(o.totalAmount)}
          </p>
        )}
        {row.note && <p className="text-xs text-gray-500">Note: {row.note}</p>}
        {row.reason && <p className="text-xs text-gray-500">{row.reason}</p>}
        {decide.isError && <p role="alert" className="mt-1 text-sm text-red-700">{errorMessage(decide.error, 'Could not save that.')}</p>}
        {asking && (
          <form
            className="mt-2 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              decide.mutate(asking === 'billed' ? { decision: 'billed', invoiceNumber: text.trim() } : { decision: 'remove', note: text.trim() });
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={asking === 'billed' ? 60 : 300}
              required
              aria-label={asking === 'billed' ? 'Zoho invoice number' : 'Why remove it'}
              placeholder={asking === 'billed' ? 'AUTO/26-27/0300' : 'Why it should not count'}
              className="rounded-lg border border-gray-300 px-2 py-1.5"
            />
            <button type="submit" disabled={decide.isPending || !text.trim()} className={btn}>Save</button>
            <button type="button" onClick={() => setAsking(null)} className="text-gray-600">Cancel</button>
          </form>
        )}
      </div>
      {!asking && (
        <div className="flex flex-wrap gap-2">
          {row.state === 'needs_check' && o && (
            <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'same_as_panel' })} className={btn}>
              Same as that order
            </button>
          )}
          {row.state !== 'open' && row.state !== 'billed' && (
            <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'count' })} className={btn}>
              {row.state === 'needs_check' ? 'Separate sale — count it' : 'Count it'}
            </button>
          )}
          {(row.state === 'open' || row.state === 'needs_check') && (
            <button type="button" disabled={decide.isPending} onClick={() => { setAsking('billed'); setText(''); }} className={btn}>
              Now billed in Zoho
            </button>
          )}
          {row.state !== 'removed' && row.state !== 'billed' && (
            <button type="button" disabled={decide.isPending} onClick={() => { setAsking('remove'); setText(''); }} className={btn}>
              Remove
            </button>
          )}
        </div>
      )}
    </li>
  );
}

const EMPTY = { customerName: '', amount: '', receivedAt: '', mode: '', proof: '', note: '' };

function AddForm({ onDone }: { onDone: () => void }) {
  const refresh = useRefresh();
  const [f, setF] = useState(EMPTY);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  const add = useMutation({
    mutationFn: () => apiClient.post('/admin/revenue/unbilled', {
      customerName: f.customerName.trim(),
      amount: Number(f.amount),
      receivedAt: f.receivedAt,
      mode: f.mode.trim() || null,
      proof: f.proof.trim(),
      note: f.note.trim() || null,
    }),
    onSuccess: async () => { setF(EMPTY); await refresh(); onDone(); },
  });
  const input = 'mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5';

  return (
    <form
      aria-label="Add paid sale without bill"
      className="mt-3 grid gap-3 rounded-xl bg-gray-50 p-4 text-sm sm:grid-cols-2"
      onSubmit={(e) => { e.preventDefault(); add.mutate(); }}
    >
      <label className="block">Customer<input required maxLength={200} value={f.customerName} onChange={set('customerName')} className={input} /></label>
      <label className="block">Amount received (₹, incl. GST)<input required type="number" min="1" step="0.01" inputMode="decimal" value={f.amount} onChange={set('amount')} className={input} /></label>
      <label className="block">Date received<input required type="date" max={todayIST()} value={f.receivedAt} onChange={set('receivedAt')} className={input} /></label>
      <label className="block">How it was paid (optional)<input maxLength={60} placeholder="Bank transfer, UPI, cash…" value={f.mode} onChange={set('mode')} className={input} /></label>
      <label className="block sm:col-span-2">Proof<input required maxLength={500} placeholder="ClickUp link, quote number or bank reference" value={f.proof} onChange={set('proof')} className={input} /></label>
      <label className="block sm:col-span-2">Note (optional)<input maxLength={500} value={f.note} onChange={set('note')} className={input} /></label>
      {add.isError && <p role="alert" className="text-red-700 sm:col-span-2">{errorMessage(add.error, 'Could not add it.')}</p>}
      <div className="sm:col-span-2">
        <button type="submit" disabled={add.isPending} className="rounded-lg bg-gray-900 px-4 py-2 font-medium text-white disabled:opacity-50">
          {add.isPending ? 'Saving…' : 'Add — counts in revenue'}
        </button>
      </div>
    </form>
  );
}

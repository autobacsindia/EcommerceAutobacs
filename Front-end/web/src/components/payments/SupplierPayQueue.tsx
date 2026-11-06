'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, Loader2, Paperclip } from 'lucide-react';
import { errorMessage, paymentKeys, postForm, rupees, toLocalInput, fromLocalInput } from './api';
import { DealLine } from './DealSummary';
import FilePicker from './FilePicker';
import { MAX_ATTACHMENTS, PHOTO_OR_PDF } from '@/lib/attachments';
import { getPayGroup, listPayGroups, payQueueKeys, sumRupees } from './suppliers';
import { formatDateIST } from '@/lib/datetime';
import { useListParams } from '@/lib/hooks/useListParams';
import { ListClear, ListResultLine, ListSearch, ListSelect } from '@/components/panel/ListControls';

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500';

const SORTS = [
  { value: 'oldest', label: 'Waiting longest first' },
  { value: 'total_desc', label: 'Most to pay first' },
  { value: 'count_desc', label: 'Most payments first' },
  { value: 'name', label: 'Supplier name A–Z' },
];
const PAID_TO = [{ value: 'bank', label: 'Bank account' }, { value: 'upi', label: 'UPI' }];

/** One supplier's approved payments: tick some, pay them in one transfer. */
function GroupDetail({ id, canPay, onBack }: { id: string; canPay: boolean; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: payQueueKeys.group(id), queryFn: () => getPayGroup(id), retry: false });
  const rows = useMemo(() => q.data?.group.requests ?? [], [q.data]);
  const [ticked, setTicked] = useState<string[]>([]);
  const [method, setMethod] = useState<'bank' | 'upi' | 'razorpay' | 'other'>('bank');
  const [reference, setReference] = useState('');
  const [at, setAt] = useState(toLocalInput());
  const [proof, setProof] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const chosen = rows.filter((r) => ticked.includes(r.id));
  const total = sumRupees(chosen.map((r) => r.amount));
  const allTicked = rows.length > 0 && chosen.length === rows.length;

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!chosen.length) { setError('Tick the payments you are paying.'); return; }
    if (!window.confirm(`Record ONE transfer of ${rupees(total)} to ${q.data?.group.name} for ${chosen.length} payment${chosen.length === 1 ? '' : 's'}?`)) return;
    const form = new FormData();
    form.append('ids', JSON.stringify(chosen.map((r) => r.id)));
    form.append('expectedTotal', String(total));
    form.append('method', method);
    form.append('reference', reference.trim());
    form.append('transactionAt', fromLocalInput(at));
    for (const f of proof) form.append('proof', f);
    setBusy(true);
    try {
      await postForm('/payment-requests/pay-batch', form);
      setDone(`Recorded ${rupees(total)} for ${chosen.length} payment${chosen.length === 1 ? '' : 's'}.`);
      setTicked([]); setReference(''); setProof([]);
      await qc.invalidateQueries({ queryKey: paymentKeys.all });
    } catch (err) {
      setError(errorMessage(err, 'Could not record the payment. Refresh and try again.'));
      await qc.invalidateQueries({ queryKey: payQueueKeys.group(id) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"><ChevronLeft className="h-4 w-4" /> All suppliers</button>
      {done && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{done}</p>}
      {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {q.isError && <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">{errorMessage(q.error, 'Nothing left to pay for this supplier.')}</p>}
      {q.isSuccess && (
        <>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{q.data.group.name}</h2>
            <p className="text-sm text-gray-600">{q.data.group.destination} · {rows.length} to pay · {rupees(q.data.group.total)} in all</p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="p-3">{canPay && <input type="checkbox" aria-label="Tick all" checked={allTicked} onChange={(e) => setTicked(e.target.checked ? rows.map((r) => r.id) : [])} />}</th>
                  <th className="p-3">Request</th><th className="p-3">Order · item</th><th className="p-3">Customer</th><th className="p-3">Status</th><th className="p-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className={ticked.includes(r.id) ? 'bg-blue-50' : ''}>
                    <td className="p-3">{canPay && <input type="checkbox" aria-label={`Pay ${r.number}`} checked={ticked.includes(r.id)}
                      onChange={(e) => setTicked(e.target.checked ? [...ticked, r.id] : ticked.filter((x) => x !== r.id))} />}</td>
                    <td className="p-3"><span className="font-medium text-gray-900">{r.number}</span><span className="block text-xs text-gray-500">{formatDateIST(r.createdAt)} · {r.requestedBy}</span>
                      {r.bankNotice && <span className="mt-1 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3 w-3" /> Bank details changed recently</span>}</td>
                    <td className="p-3">{r.order?.number} · {r.itemNames.join(', ')}{r.deal && <DealLine d={r.deal} />}</td>
                    <td className="p-3">{r.customer?.name}</td>
                    <td className="p-3">{r.statusLabel}{r.status === 'on_hold' && r.decisionNote ? <span className="block text-xs text-gray-500">{r.decisionNote}</span> : null}</td>
                    <td className="p-3 text-right font-semibold">{rupees(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canPay && (
            <form onSubmit={pay} aria-label="Pay ticked payments" className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-sm text-gray-800">Ticked: <strong>{chosen.length}</strong> · Total to send: <strong className="text-lg">{rupees(total)}</strong></p>
              <p className="text-xs text-gray-500">Send this amount in one transfer from the company bank / Razorpay, then record it. Unticked payments stay here for later.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className={label} htmlFor="pb-method">Paid by</label>
                  <select id="pb-method" className={input} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                    <option value="bank">Bank transfer</option><option value="upi">UPI</option><option value="razorpay">Razorpay payout</option><option value="other">Other</option>
                  </select></div>
                <div><label className={label} htmlFor="pb-ref">Reference (UTR / payout ID) — optional</label>
                  <input id="pb-ref" className={input} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} /></div>
                <div className="sm:col-span-2"><label className={label} htmlFor="pb-at">Transaction date &amp; time (when the money was sent)</label>
                  <input id="pb-at" type="datetime-local" className={input} required max={toLocalInput()} value={at} onChange={(e) => setAt(e.target.value)} /></div>
              </div>
              <FilePicker files={proof} onChange={setProof} max={MAX_ATTACHMENTS} accept={PHOTO_OR_PDF} label="Attach payment screenshots" icon={<Paperclip className="h-4 w-4" />} onError={setError} />
              {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
              <button type="submit" disabled={busy || !chosen.length} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Record payment of {rupees(total)}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Approved supplier payments, one row per supplier account with the total to
 * pay. The admin opens one, ticks what to pay now, and records one transfer.
 * Search / "Paid to" / sort are done by the server and kept in the page address
 * (the page wraps this in <Suspense>); a found supplier shows ALL it is owed.
 */
export default function SupplierPayQueue({ canPay }: { canPay: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const { values: v, set, clear } = useListParams({ q: '', method: '', sort: 'oldest' });
  const sort = SORTS.some((x) => x.value === v.sort) ? v.sort : 'oldest';
  const params: Record<string, string> = {
    ...(v.q ? { q: v.q } : {}),
    ...(v.method ? { method: v.method } : {}),
    ...(sort !== 'oldest' ? { sort } : {}),
  };
  const filtered = !!(v.q || v.method);
  const q = useQuery({
    queryKey: payQueueKeys.groups(params),
    queryFn: () => listPayGroups(params),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  if (open) return <GroupDetail id={open} canPay={canPay} onBack={() => setOpen(null)} />;
  const groups = q.data?.groups ?? [];
  const summary = q.data?.summary;
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Rupee payments only. A supplier bill in another currency (THB, USD…) is paid on its own from Payments, where you record the rupees the bank debited.
      </p>
      <div role="search" aria-label="Search supplier payments" className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ListSearch value={v.q} onChange={(text) => set({ q: text.trim() })} label="Search suppliers to pay"
            placeholder="Search supplier, UPI ID, bank, account digits, PR or order no., amount" />
          <ListSelect label="Paid to" value={v.method} onChange={(m) => set({ method: m })} options={PAID_TO} allLabel="Bank or UPI" />
          <ListSelect label="Sort" value={sort} onChange={(x) => set({ sort: x })} options={SORTS} />
        </div>
        <div className="flex min-h-[1.75rem] flex-wrap items-center justify-between gap-2">
          {summary
            ? <ListResultLine count={summary.count} capped={false} total={summary.total} noun={['supplier', 'suppliers']} formatTotal={rupees} />
            : <span />}
          {filtered && <ListClear onClear={() => clear(['sort'])} />}
        </div>
      </div>
      {q.isPending && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {q.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage(q.error, 'Could not load supplier payments.')}</p>}
      {q.isSuccess && groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          {filtered ? 'No supplier to pay matches — try fewer words or clear the search.' : 'No approved supplier payments to pay.'}
        </p>
      )}
      {q.data?.truncated && <p className="text-xs text-amber-700">Showing the oldest 500 supplier payments — pay some to see the rest.</p>}
      <ul className={`space-y-2 ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
        {groups.map((g) => (
          <li key={g.id}>
            <button type="button" onClick={() => setOpen(g.id)} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-4 text-left hover:border-blue-300 hover:bg-blue-50/40">
              <span className="min-w-0">
                <span className="block font-semibold text-gray-900">{g.name}</span>
                <span className="block text-sm text-gray-600">{g.destination}</span>
                {g.bankNotice && <span className="mt-1 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3 w-3" /> Bank details changed recently</span>}
              </span>
              <span className="text-right">
                <span className="block text-lg font-bold text-gray-900">{rupees(g.total)}</span>
                <span className="block text-xs text-gray-500">{g.count} payment{g.count === 1 ? '' : 's'}{g.onHold ? ` · ${g.onHold} on hold` : ''}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

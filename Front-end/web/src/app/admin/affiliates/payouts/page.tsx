'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatDateTimeIST } from '@/lib/datetime';
import { useListParams } from '@/lib/hooks/useListParams';
import { ListClear, ListDateRange, ListResultLine, ListSearch, ListSelect } from '@/components/panel/ListControls';

/**
 * Affiliate payout batches.
 *
 * We do not send money — an admin transfers the net from their own bank and records the
 * UTR here. So this screen is a LEDGER of transfers that happened, not a control panel
 * that moves funds. Two terminal outcomes only: paid (with a reference) or failed
 * (which releases the rows back into the payable pool). There is deliberately no
 * partial state — a manual NEFT lands or it does not.
 *
 * The server searches, filters and sorts; the status, search, dates and sort live in
 * the page address (Back, refresh and a shared link keep them), so the page renders
 * inside <Suspense>.
 */

interface Payout {
  _id: string;
  affiliate: { _id: string; code?: string; name: string; email: string } | null;
  status: 'draft' | 'processing' | 'paid' | 'failed' | 'cancelled';
  grossPaise: number;
  tdsPercent: number;
  tdsPaise: number;
  netPaise: number;
  commissionCount: number;
  reference?: string;
  bankSnapshot?: { accountHolderName?: string; accountLast4?: string; ifsc?: string; upiId?: string };
  paidAt?: string | null;
  failureReason?: string;
  createdAt: string;
}

interface ListResponse {
  success: boolean;
  payouts: Payout[];
  nextCursor: string | null;
  /** First page only: how many match and their net total in paise (capped at 1,000). */
  summary?: { count: number; total: number | null; capped: boolean };
}

const TABS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'To pay' },
  { value: 'processing', label: 'Processing' },
  { value: 'paid', label: 'Paid' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'amount_desc', label: 'Net amount: high to low' },
  { value: 'amount_asc', label: 'Net amount: low to high' },
];

const STATUS_STYLES: Record<Payout['status'], string> = {
  draft: 'bg-amber-100 text-amber-800',
  processing: 'bg-sky-100 text-sky-800',
  paid: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-600',
};

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AdminAffiliatePayoutsPage() {
  return (
    <Suspense>
      <AdminAffiliatePayouts />
    </Suspense>
  );
}

function AdminAffiliatePayouts() {
  const { values: v, set, clear } = useListParams({ status: '', q: '', from: '', to: '', sort: 'newest' });
  const status = TABS.some((t) => t.value === v.status) ? v.status : '';
  const sort = SORTS.some((x) => x.value === v.sort) ? v.sort : 'newest';
  const filtered = Boolean(status || v.q || v.from || v.to);
  const [summary, setSummary] = useState<ListResponse['summary']>();
  const [rows, setRows] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  // Only the latest request may paint: a filter change fires a load with the old cursor
  // and then one from the first page, and the first may answer last.
  const latestLoad = useRef(0);
  const load = useCallback(async () => {
    const mine = ++latestLoad.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '25' });
      if (status) params.set('status', status);
      if (v.q) params.set('q', v.q);
      if (v.from) params.set('from', v.from);
      if (v.to) params.set('to', v.to);
      if (sort !== 'newest') params.set('sort', sort);
      if (cursor) params.set('cursor', cursor);
      const res = await apiClient.get<ListResponse>(`${API_ENDPOINTS.AFFILIATE_PAYOUTS_ADMIN}?${params}`);
      if (mine !== latestLoad.current) return;
      setRows(res.payouts || []);
      setNextCursor(res.nextCursor);
      // The count comes with the first page only; keep it while paging.
      if (!cursor) setSummary(res.summary);
      setError(null);
    } catch (err) {
      if (mine !== latestLoad.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load payouts');
    } finally {
      if (mine === latestLoad.current) setLoading(false);
    }
  }, [cursor, status, v.q, v.from, v.to, sort]);

  useEffect(() => { load(); }, [load]);
  // A filter, search or sort change starts again from the first page.
  useEffect(() => { setCursor(null); setCursorStack([]); }, [status, v.q, v.from, v.to, sort]);

  /*
    Every mutation reloads afterwards, including on failure. A 409 here means another
    admin resolved this batch first — the screen is stale, and refetching is the only
    honest response. Never optimistically flip a payout row: this is money.
  */
  const run = async (id: string, fn: () => Promise<unknown>) => {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      await load();
      setBusyId(null);
    }
  };

  const markPaid = (p: Payout) => {
    const reference = prompt(
      `Record the bank reference (UTR) for ${rupees(p.netPaise)} paid to ${p.affiliate?.name || 'this affiliate'}:`
    );
    if (!reference?.trim()) return;
    run(p._id, () => apiClient.post(API_ENDPOINTS.AFFILIATE_PAYOUT_MARK_PAID(p._id), {
      reference: reference.trim(),
    }));
  };

  const markFailed = (p: Payout) => {
    if (!confirm('Mark this transfer as failed? The commissions go back into the payable pool and can be re-batched.')) return;
    const failureReason = prompt('Why did it fail? (optional)') ?? undefined;
    run(p._id, () => apiClient.post(API_ENDPOINTS.AFFILIATE_PAYOUT_MARK_FAILED(p._id), { failureReason }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-600">
          Transfers are made from your bank, then recorded here. Marking one failed
          releases its commissions so they can be paid in a later batch.
        </p>
        <a
          href={`/api/v1${API_ENDPOINTS.AFFILIATE_PAYOUTS_ADMIN}/tds-export`}
          className="inline-flex shrink-0 items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
        >
          <Download className="w-4 h-4" aria-hidden /> TDS CSV
        </a>
      </div>

      <div role="tablist" aria-label="Payout status" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.value || 'all'} type="button" role="tab" aria-selected={status === t.value} onClick={() => set({ status: t.value })}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${status === t.value ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div role="search" aria-label="Search and filter payouts" className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ListSearch value={v.q} onChange={(text) => set({ q: text.trim() })} label="Search payouts"
            placeholder="Search affiliate, code, UTR, account digits, UPI ID, amount" />
          <ListSelect label="Sort" value={sort} onChange={(x) => set({ sort: x })} options={SORTS} />
        </div>
        <ListDateRange label="Made on" from={v.from} to={v.to} onChange={(from, to) => set({ from, to })}>
          <span>Made</span>
        </ListDateRange>
        <div className="flex min-h-[1.75rem] flex-wrap items-center justify-between gap-2">
          {summary
            ? <ListResultLine count={summary.count} capped={summary.capped} total={summary.total} noun={['payout', 'payouts']} formatTotal={rupees} />
            : <span />}
          {filtered && <ListClear onClear={() => clear(['sort'])} />}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Affiliate</th>
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 font-medium text-right">Gross</th>
              <th className="px-4 py-3 font-medium text-right">TDS</th>
              <th className="px-4 py-3 font-medium text-right">Net</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Reference</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                {filtered
                  ? 'No payouts match — try fewer words or clear the filters.'
                  : <>No payouts yet. Build one from an affiliate&apos;s page once they have a payable balance.</>}
              </td></tr>
            )}
            {!loading && rows.map((p) => (
              <tr key={p._id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3">
                  {p.affiliate ? (
                    <Link href={`/admin/affiliates/${p.affiliate._id}`} className="text-blue-600 hover:underline">
                      {p.affiliate.name}
                    </Link>
                  ) : '—'}
                  <div className="text-xs text-gray-500 font-mono">{p.affiliate?.code || ''}</div>
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">
                  {p.bankSnapshot?.accountLast4
                    ? <>••••{p.bankSnapshot.accountLast4}<div>{p.bankSnapshot.ifsc}</div></>
                    : (p.bankSnapshot?.upiId || '—')}
                </td>
                <td className="px-4 py-3 text-right">{rupees(p.grossPaise)}</td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {p.tdsPaise ? `${rupees(p.tdsPaise)} (${p.tdsPercent}%)` : '—'}
                </td>
                <td className="px-4 py-3 text-right font-medium">{rupees(p.netPaise)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[p.status]}`}>
                    {p.status}
                  </span>
                  {p.failureReason && <div className="mt-1 text-xs text-red-600">{p.failureReason}</div>}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{p.reference || '—'}</td>
                <td className="px-4 py-3 text-gray-600 text-xs">{formatDateTimeIST(p.createdAt)}</td>
                <td className="px-4 py-3">
                  {(p.status === 'draft' || p.status === 'processing') && (
                    <div className="flex gap-2">
                      <button
                        disabled={busyId === p._id}
                        onClick={() => markPaid(p)}
                        className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs hover:bg-green-700 disabled:opacity-50"
                      >
                        Record paid
                      </button>
                      <button
                        disabled={busyId === p._id}
                        onClick={() => markFailed(p)}
                        className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs hover:bg-gray-50 disabled:opacity-50"
                      >
                        Failed
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between">
        <button
          onClick={() => {
            const stack = [...cursorStack];
            setCursor(stack.pop() ?? null);
            setCursorStack(stack);
          }}
          disabled={cursorStack.length === 0}
          className="px-4 py-2 border border-gray-300 rounded-lg disabled:opacity-40"
        >
          Previous
        </button>
        <button
          onClick={() => {
            if (!nextCursor) return;
            setCursorStack((s) => [...s, cursor ?? '']);
            setCursor(nextCursor);
          }}
          disabled={!nextCursor}
          className="px-4 py-2 border border-gray-300 rounded-lg disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

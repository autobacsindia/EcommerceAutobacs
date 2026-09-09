'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatDateTimeIST } from '@/lib/datetime';

/**
 * Affiliate payout batches.
 *
 * We do not send money — an admin transfers the net from their own bank and records the
 * UTR here. So this screen is a LEDGER of transfers that happened, not a control panel
 * that moves funds. Two terminal outcomes only: paid (with a reference) or failed
 * (which releases the rows back into the payable pool). There is deliberately no
 * partial state — a manual NEFT lands or it does not.
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
}

const STATUS_STYLES: Record<Payout['status'], string> = {
  draft: 'bg-amber-100 text-amber-800',
  processing: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-600',
};

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AdminAffiliatePayoutsPage() {
  const [rows, setRows] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '25' });
      if (cursor) params.set('before', cursor);
      const res = await apiClient.get<ListResponse>(`${API_ENDPOINTS.AFFILIATE_PAYOUTS_ADMIN}?${params}`);
      setRows(res.payouts || []);
      setNextCursor(res.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payouts');
    } finally {
      setLoading(false);
    }
  }, [cursor]);

  useEffect(() => { load(); }, [load]);

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
                No payouts yet. Build one from an affiliate&apos;s page once they have a payable balance.
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

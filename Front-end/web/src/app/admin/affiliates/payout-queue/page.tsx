'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BellRing, PauseCircle } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatDateIST } from '@/lib/datetime';
import { usePayoutQueue, type PayoutQueueRow } from '@/hooks/queries/useAffiliate';
import { affiliateKeys } from '@/hooks/queries/keys';

/**
 * Who is owed money right now.
 *
 * ── WHY THIS SCREEN EXISTS ───────────────────────────────────────────────────────
 * Nothing used to tell anyone a payout was due. The affiliate had no way to ask, and the
 * admin had no list — the affiliate table showed status and rates but not what anyone was
 * owed, so finding out meant opening every detail page in turn. At forty affiliates that
 * is a monthly chore that gets skipped, and unpaid commission is the fastest way to lose
 * an affiliate.
 *
 * ── IT MOVES NO MONEY ────────────────────────────────────────────────────────────
 * This is a worklist. "Build batch" claims the rows into a payout record; the actual
 * transfer is still a human making a NEFT/UPI payment and recording the UTR on
 * /admin/affiliates/payouts. Nothing here shortens that path.
 *
 * Every figure is server-computed and arrives in PAISE. This page divides by 100 to
 * display and never sums anything itself — in particular `totalPayablePaise` covers EVERY
 * due affiliate, not the visible page, so a browser-side sum of the rows would quietly
 * understate the liability the moment the list is truncated.
 */

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** How long the oldest commission in this balance has been sitting approved. */
const waitingDays = (iso: string | null) => {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
};

export default function AdminAffiliatePayoutQueuePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, refetch } = usePayoutQueue();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /*
    Building a batch is a real write against money. It refetches afterwards even on
    failure: a 409 means another admin claimed these rows first, so this screen is stale
    and refetching is the only honest response. Never optimistically remove a row.
  */
  const buildBatch = async (row: PayoutQueueRow) => {
    if (busyId) return;
    if (!confirm(
      `Build a payout batch for ${row.name} (${rupees(row.payableBalancePaise)} across `
      + `${row.commissionCount} commission${row.commissionCount === 1 ? '' : 's'})?\n\n`
      + 'This claims the rows. You still have to make the transfer and record the UTR.'
    )) return;

    setBusyId(row._id);
    setActionError(null);
    try {
      await apiClient.post(`${API_ENDPOINTS.AFFILIATES_ADMIN}/${row._id}/payouts`, {});
      // Invalidate the whole affiliate prefix: the batch changes this queue AND the
      // affiliate's own view of what they are owed.
      await queryClient.invalidateQueries({ queryKey: affiliateKeys.all });
      router.push('/admin/affiliates/payouts');
      return;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not build the batch');
      await refetch();
    } finally {
      setBusyId(null);
    }
  };

  const queue = data?.queue ?? [];
  const held = data?.suspendedHeld;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-gray-600">
          Affiliates whose confirmed commission has reached the{' '}
          {data ? rupees(data.minPayoutPaise) : '—'} minimum. Anyone who has actively
          requested a payout is listed first.
        </p>
        <Link
          href="/admin/affiliates/payouts"
          className="shrink-0 text-sm text-blue-600 hover:underline"
        >
          Batches already built →
        </Link>
      </div>

      {(isError || actionError) && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {actionError
            ?? (error instanceof Error ? error.message : 'Failed to load the payout queue')}
        </p>
      )}

      {!isPending && data && queue.length > 0 && (
        <p className="text-sm font-medium text-gray-900">
          {data.dueCount} affiliate{data.dueCount === 1 ? '' : 's'} due ·{' '}
          {rupees(data.totalPayablePaise)} total
          {/* Say so when the worklist is truncated, rather than implying it is everyone. */}
          {data.hasMore && (
            <span className="ml-2 font-normal text-gray-500">
              (showing the top {queue.length})
            </span>
          )}
        </p>
      )}

      {/*
        Money owed to affiliates who are not active. Deliberately NOT in the worklist —
        suspension does not void commission already earned, but an admin working down a
        list must not pay someone suspended for fraud by reflex. Shown so the liability
        is not invisible; acting on it means a deliberate reinstate first.
      */}
      {!isPending && held && held.count > 0 && (
        <p className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <PauseCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
          <span>
            {rupees(held.heldPaise)} is held against {held.count} suspended or pending
            affiliate{held.count === 1 ? '' : 's'} and is not payable from here. Reinstate
            them to pay what they earned, or void the commissions deliberately.
          </span>
        </p>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500 border-b border-gray-200">
            <tr>
              <th className="py-3 px-4 font-medium">Affiliate</th>
              <th className="py-3 px-4 font-medium text-right">Owed</th>
              <th className="py-3 px-4 font-medium text-right">Rows</th>
              <th className="py-3 px-4 font-medium">Waiting</th>
              <th className="py-3 px-4 font-medium">TDS</th>
              <th className="py-3 px-4 font-medium">Bank</th>
              <th className="py-3 px-4 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr><td colSpan={7} className="py-10 text-center text-gray-500">Loading…</td></tr>
            )}

            {!isPending && queue.length === 0 && (
              <tr><td colSpan={7} className="py-10 text-center text-gray-500">
                Nobody is due a payout right now.
              </td></tr>
            )}

            {queue.map((row) => {
              const days = waitingDays(row.oldestApprovedAt);
              return (
                <tr key={row._id} className="border-b border-gray-100 last:border-0">
                  <td className="py-3 px-4">
                    <Link href={`/admin/affiliates/${row._id}`} className="text-blue-600 hover:underline">
                      {row.name}
                    </Link>
                    <div className="text-xs text-gray-500 font-mono">{row.code ?? '—'}</div>
                    {row.payoutRequestedAt && (
                      <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">
                        <BellRing className="w-3 h-3" aria-hidden />
                        Requested {formatDateIST(row.payoutRequestedAt)}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-medium">{rupees(row.payableBalancePaise)}</td>
                  <td className="py-3 px-4 text-right text-gray-600">{row.commissionCount}</td>
                  <td className="py-3 px-4 text-gray-600">
                    {days === null ? '—' : `${days} day${days === 1 ? '' : 's'}`}
                  </td>
                  <td className="py-3 px-4 text-gray-600">{row.tdsPercent}%</td>
                  <td className="py-3 px-4">
                    {row.hasBankDetails ? (
                      <span className="text-gray-600">On file</span>
                    ) : (
                      /*
                        Surfaced here rather than discovered at transfer time: the batch
                        will build fine without bank details, and you would only find out
                        when you went to send the money.
                      */
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
                        <AlertTriangle className="w-3 h-3" aria-hidden /> Missing
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => buildBatch(row)}
                      disabled={busyId === row._id}
                      className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {busyId === row._id ? 'Building…' : 'Build batch'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        Building a batch claims the commission rows. It does not send money — make the
        transfer from your bank, then record the UTR on the batches screen.
      </p>
    </div>
  );
}

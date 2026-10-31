'use client';

/*
  Lives outside the route file because a Next.js `page.tsx` may only export a
  default plus the framework's own fields — a named export there fails the build.
*/

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Receipt, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { campaignKeys } from '@/hooks/queries/keys';
import { formatIsoDateTimeIST } from '@/lib/datetime';
import { usePanel } from '@/lib/usePanel';

const inr = (n: number | null | undefined) => `₹${(n ?? 0).toLocaleString('en-IN')}`;
const card = 'rounded-lg border border-gray-200 bg-white p-6';

/**
 * Who actually redeemed this campaign.
 *
 * The sibling MemberRosterPanel answers this for an ALLOWLIST campaign only. A public
 * campaign — which is what the printed QR card points at — writes no member rows at
 * all: `claimForUser` is skipped for that audience and `markRedeemed` does not upsert.
 * Its roster is therefore permanently empty no matter how many people buy, which reads
 * as "nobody redeemed" while the counters climb and money goes out.
 *
 * This panel reads the redemption rows instead, which are written on every use of the
 * campaign's managed coupon regardless of audience. It is the only view that is
 * complete for both kinds of campaign, so it is shown for both.
 *
 * Reads only, and paginated by cursor rather than page number: redemptions land while
 * an admin is scrolling, and an offset would duplicate or skip a row the moment one did.
 */

interface Redemption {
  _id: string;
  code: string;
  discountAmount: number;
  createdAt: string;
  user: { _id: string; name: string | null; email: string } | null;
  order: {
    _id: string;
    status: string;
    paymentStatus: string;
    totalAmount: number;
    createdAt: string;
  } | null;
}

/*
  Payment state is the whole point of this table, so it is never rendered as bare text.
  A redemption exists from the moment an order is CREATED — before any money moves — so
  an operator scanning this list has to be able to tell a completed sale from a
  checkout somebody walked away from, at a glance.
*/
const PAYMENT_TONE: Record<string, string> = {
  paid: 'bg-green-50 text-green-800 border-green-200',
  refunded: 'bg-amber-50 text-amber-800 border-amber-200',
  pending: 'bg-gray-100 text-gray-600 border-gray-300',
  failed: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
  expired: 'bg-gray-100 text-gray-500 border-gray-300',
};

function PaymentBadge({ status }: { status: string }) {
  const tone = PAYMENT_TONE[status] || PAYMENT_TONE.pending;
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-medium capitalize ${tone}`}>
      {status}
    </span>
  );
}

export default function RedemptionsPanel({ slug }: { slug: string }) {
  const { isAdmin } = usePanel();
  /*
    A cursor STACK, not a single cursor. Keyset pagination is forward-only — the cursor
    encodes "after this row", and there is no reverse form of it — so stepping back
    means remembering where each page started rather than trying to derive it.
  */
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1];

  const { data, isLoading, isError } = useQuery({
    queryKey: campaignKeys.redemptions(slug, cursor),
    queryFn: () =>
      apiClient.get<{ success: boolean; redemptions: Redemption[]; nextCursor: string | null }>(
        `${API_ENDPOINTS.CAMPAIGN_REDEMPTIONS(slug)}?limit=25${cursor ? `&cursor=${cursor}` : ''}`,
      ),
    // Named-customer data. Keep it out of any shared cache and re-ask on return, so a
    // stale page never shows a redemption that has since been released.
    staleTime: 0,
  });

  const rows = data?.redemptions ?? [];

  return (
    <div className={`${card} mb-6`}>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-600">
        <Receipt size={14} /> Redemptions
      </h2>
      <p className="mb-4 text-xs text-gray-500">
        Every use of this campaign&apos;s coupon, newest first. A row appears when the order is
        created — before payment — so check the payment column before counting a sale.
      </p>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {isError && <p className="text-sm text-red-700">Could not load redemptions.</p>}

      {!isLoading && !isError && rows.length === 0 && (
        <p className="text-sm text-gray-500">
          {cursors.length > 1 ? 'No further redemptions.' : 'Nobody has redeemed this campaign yet.'}
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <th className="pb-2 pr-4 font-medium">When</th>
                <th className="pb-2 pr-4 font-medium">Customer</th>
                <th className="pb-2 pr-4 font-medium">Order</th>
                <th className="pb-2 pr-4 font-medium">Payment</th>
                <th className="pb-2 pr-4 text-right font-medium">Order total</th>
                <th className="pb-2 text-right font-medium">Discount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className="border-b border-gray-200 last:border-0">
                  {/* Runtime TZ is UTC on Vercel/Railway — never format dates locally. */}
                  <td className="py-2.5 pr-4 whitespace-nowrap text-gray-600">
                    {formatIsoDateTimeIST(r.createdAt)}
                  </td>
                  <td className="py-2.5 pr-4">
                    {/* A deleted account leaves the redemption behind; it still cost money. */}
                    <span className="text-gray-900">{r.user?.name || '—'}</span>
                    <span className="block text-xs text-gray-500">{r.user?.email || 'account removed'}</span>
                  </td>
                  <td className="py-2.5 pr-4">
                    {r.order && !isAdmin ? (
                      // Orders are an admin screen; marketing sees the reference only.
                      <span className="text-gray-900">{r.order._id.slice(-8)}</span>
                    ) : r.order ? (
                      <Link
                        href={`/admin/orders/${r.order._id}`}
                        className="inline-flex items-center gap-1 text-gold hover:underline"
                      >
                        {r.order._id.slice(-8)}
                        <ChevronRight size={12} />
                      </Link>
                    ) : (
                      <span className="text-gray-400">order removed</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    <PaymentBadge status={r.order?.paymentStatus || 'pending'} />
                  </td>
                  <td className="py-2.5 pr-4 text-right text-gray-700">
                    {r.order ? inr(r.order.totalAmount) : '—'}
                  </td>
                  <td className="py-2.5 text-right text-gray-900">{inr(r.discountAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(cursors.length > 1 || data?.nextCursor) && (
        <div className="mt-4 flex items-center gap-3 border-t border-gray-200 pt-4">
          <button
            onClick={() => setCursors((c) => (c.length > 1 ? c.slice(0, -1) : c))}
            disabled={cursors.length === 1}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            onClick={() => data?.nextCursor && setCursors((c) => [...c, data.nextCursor])}
            disabled={!data?.nextCursor}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 disabled:opacity-40"
          >
            Next
          </button>
          <span className="text-xs text-gray-400">Page {cursors.length}</span>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useRequireAuth } from '@/lib/hooks/useRequireAuth';
import { useMyAffiliate, useMyCommissions } from '@/hooks/queries/useAffiliate';
import { formatDateIST } from '@/lib/datetime';

/**
 * The affiliate's own dashboard: their link, what they have earned, and when it lands.
 *
 * Every figure here is server-computed and arrives in PAISE — the page divides by 100
 * to display and does nothing else. It never sums the ledger itself: a browser-derived
 * earnings total would be a second answer to "what are we owed", and the two would
 * disagree the first time a clawback landed mid-page.
 */

/**
 * Mirrors the cookie lifetime set in middleware.ts, from the same variable — so the
 * promise made on this page cannot drift from the window actually enforced.
 */
const ATTRIBUTION_WINDOW_DAYS =
  Number(process.env.NEXT_PUBLIC_AFFILIATE_ATTRIBUTION_WINDOW_DAYS) || 30;

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_COPY: Record<string, { label: string; style: string; hint: string }> = {
  pending: {
    label: 'Pending',
    style: 'bg-amber-100 text-amber-800',
    hint: 'Confirmed once the order has been delivered and the return window has closed.',
  },
  approved: {
    label: 'Ready to pay',
    style: 'bg-blue-100 text-blue-800',
    hint: 'Included in your next payout.',
  },
  paid: { label: 'Paid', style: 'bg-green-100 text-green-800', hint: 'Transferred to your account.' },
  reversed: {
    label: 'Reversed',
    style: 'bg-gray-100 text-gray-600',
    hint: 'The order was cancelled or returned.',
  },
  void: { label: 'Void', style: 'bg-gray-100 text-gray-600', hint: 'Cancelled by our team.' },
};

const card = 'bg-white rounded-xl border border-gray-200 p-6';

export default function AffiliateDashboardPage() {
  useRequireAuth();
  const { isAuthenticated, user } = useAuth();

  const [cursor, setCursor] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const enabled = isAuthenticated && !!user;
  const { data, isLoading } = useMyAffiliate(enabled);
  const { data: ledger, isLoading: ledgerLoading } = useMyCommissions(cursor, enabled);

  const affiliate = data?.affiliate ?? null;

  // Built from the browser's own origin so it is correct in every environment without
  // an env var to forget — and it is only a display string; the server resolves the
  // code at order time regardless of what link was used.
  const link = affiliate?.code && typeof window !== 'undefined'
    ? `${window.location.origin}/?ref=${affiliate.code}`
    : '';

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return <main className="max-w-4xl mx-auto px-4 py-16"><p className="text-gray-500">Loading…</p></main>;
  }

  // Not an affiliate: a perfectly ordinary state for almost every customer, so this is
  // an invitation rather than an error page.
  if (!affiliate) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-20 text-center">
        <h1 className="text-3xl font-semibold text-gray-900">You&apos;re not an affiliate yet</h1>
        <p className="mt-3 text-gray-600">
          Earn commission by sharing Autobacs India with your audience.
        </p>
        <Link
          href="/affiliates"
          className="inline-flex items-center gap-2 mt-8 px-5 py-3 rounded-lg bg-gray-900 text-white font-medium hover:bg-gray-800"
        >
          Read about the programme <ExternalLink className="w-4 h-4" aria-hidden />
        </Link>
      </main>
    );
  }

  if (affiliate.status !== 'active') {
    return (
      <main className="max-w-2xl mx-auto px-4 py-20 text-center">
        <h1 className="text-3xl font-semibold text-gray-900">
          {affiliate.status === 'pending' ? 'Application under review' : 'Your account is paused'}
        </h1>
        <p className="mt-3 text-gray-600">
          {affiliate.status === 'pending'
            ? 'We review every application by hand. You will get an email once a decision is made.'
            : 'Your affiliate account is currently suspended. Please contact support if you think this is a mistake.'}
        </p>
        <Link href="/support" className="inline-block mt-8 text-blue-600 hover:underline">
          Contact support
        </Link>
      </main>
    );
  }

  const summary = data?.summary ?? {};

  /*
    Do the two rates actually differ? Used in BOTH directions, because each phrasing is
    misleading under the other condition:
      - equal rates + "on orders from new customers"  → implies repeats earn nothing
      - split rates + "on orders you bring in"        → overstates what repeats pay
    An affiliate who learns their real rate from a payout statement instead of here
    concludes they were short-changed. Mirrors utils/emailTemplates.js.
  */
  const hasSeparateRepeatRate = affiliate.repeatCommissionPercent != null
    && affiliate.repeatCommissionPercent !== affiliate.commissionPercent;

  return (
    <main className="max-w-4xl mx-auto px-4 py-12 space-y-6">
      <header>
        <h1 className="text-3xl font-semibold text-gray-900">Affiliate dashboard</h1>
        <p className="mt-2 text-gray-600">
          You earn {affiliate.commissionPercent}% of the goods value on orders you bring in
          {hasSeparateRepeatRate ? ' from customers who are new to us' : ''}.
          {affiliate.discountPercent > 0 && ` Your code gives them ${affiliate.discountPercent}% off.`}
        </p>
      </header>

      {/* ── Link + code ────────────────────────────────────────────────────── */}
      <section className={card} aria-label="Your link and code">
        <h2 className="font-semibold text-gray-900">Your link</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-64 border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm bg-gray-50"
            aria-label="Your affiliate link"
          />
          <button
            onClick={copy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800"
          >
            {copied ? <Check className="w-4 h-4" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="mt-3 text-sm text-gray-600">
          A click on this link is remembered for {ATTRIBUTION_WINDOW_DAYS} days. Your code{' '}
          <strong className="font-mono">{affiliate.code}</strong> also works on its own —
          anyone can type it at checkout.
          {affiliate.discountPercent > 0
            && ' Each customer gets the discount once; after that your code still credits you, it just stops discounting.'}
        </p>
        {/*
          State the repeat rate here, not only in the approval email. An affiliate who
          first learns of a lower rate from a payout statement concludes they were
          short-changed — and they are right to, because nobody showed them the terms.
        */}
        {hasSeparateRepeatRate && (
          <p className="mt-2 text-sm text-gray-600">
            You earn <strong>{affiliate.commissionPercent}%</strong> on orders from customers
            who are new to Autobacs India, and{' '}
            {affiliate.repeatCommissionPercent! > 0
              ? <><strong>{affiliate.repeatCommissionPercent}%</strong> when they have bought from us before.</>
              : <>nothing when they have bought from us before.</>}
          </p>
        )}
      </section>

      {/* ── Earnings ───────────────────────────────────────────────────────── */}
      <section className={card} aria-label="Earnings">
        <h2 className="font-semibold text-gray-900">Earnings</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <div>
            <p className="text-sm text-gray-500">Ready to pay</p>
            <p className="text-2xl font-semibold">{rupees(data?.payableBalancePaise ?? 0)}</p>
          </div>
          {(['pending', 'approved', 'paid'] as const).map((key) => (
            <div key={key}>
              <p className="text-sm text-gray-500">{STATUS_COPY[key].label}</p>
              <p className="text-lg">{rupees(summary[key]?.netPaise ?? 0)}</p>
              <p className="text-xs text-gray-400">{summary[key]?.count ?? 0} orders</p>
            </div>
          ))}
        </div>

        {(data?.payableBalancePaise ?? 0) < 0 && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            An order you referred was refunded after it had been paid out, so this amount
            is carried against your next earnings. Nothing is owed by you directly.
          </p>
        )}

        <p className="mt-4 text-xs text-gray-500">
          Commission is confirmed once an order has been delivered and its return window
          has closed, then paid by bank transfer.
          {!affiliate.payoutDetails?.accountLast4 && ' We will ask for your bank details before your first payout.'}
        </p>
      </section>

      {/* ── Ledger ─────────────────────────────────────────────────────────── */}
      <section className={card} aria-label="Referred orders">
        <h2 className="font-semibold text-gray-900">Referred orders</h2>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Order value</th>
                <th className="py-2 font-medium text-right">Your commission</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {ledgerLoading && (
                <tr><td colSpan={4} className="py-8 text-center text-gray-500">Loading…</td></tr>
              )}
              {!ledgerLoading && (ledger?.commissions?.length ?? 0) === 0 && (
                <tr><td colSpan={4} className="py-8 text-center text-gray-500">
                  No referred orders yet. Share your link to get started.
                </td></tr>
              )}
              {ledger?.commissions?.map((c) => {
                const copy = STATUS_COPY[c.status] ?? STATUS_COPY.pending;
                return (
                  <tr key={c._id} className="border-t">
                    <td className="py-3">{formatDateIST(c.createdAt)}</td>
                    <td className="py-3 text-gray-600">
                      {c.order ? `₹${c.order.totalAmount.toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className={`py-3 text-right font-medium ${c.amountPaise < 0 ? 'text-red-600' : ''}`}>
                      {rupees(c.amountPaise)}
                    </td>
                    <td className="py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${copy.style}`}>
                        {copy.label}
                      </span>
                      {c.status === 'pending' && c.maturesAt && (
                        <div className="mt-1 text-xs text-gray-500">
                          Confirms {formatDateIST(c.maturesAt)}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          {cursor && (
            <button
              onClick={() => setCursor(null)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm"
            >
              Back to start
            </button>
          )}
          <button
            onClick={() => setCursor(ledger?.nextCursor ?? null)}
            disabled={!ledger?.nextCursor}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Older
          </button>
        </div>
      </section>
    </main>
  );
}

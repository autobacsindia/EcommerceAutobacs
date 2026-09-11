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
 *
 * ── STYLING ──────────────────────────────────────────────────────────────────────
 * Storefront tokens (obsidian + gold, globals.css @theme), NOT the admin light palette.
 * This page shipped with `bg-white` cards and `text-gray-900` headings over a body hard
 * -set to #080808. The two states with no card behind them — "not an affiliate yet" and
 * "under review" — were dark grey text on near-black, i.e. unreadable. Any new surface
 * here uses the same tokens; the admin screens under `.admin-panel` are a separate,
 * deliberately light world.
 */

/**
 * Mirrors the cookie lifetime set in middleware.ts, from the same variable — so the
 * promise made on this page cannot drift from the window actually enforced.
 */
const ATTRIBUTION_WINDOW_DAYS =
  Number(process.env.NEXT_PUBLIC_AFFILIATE_ATTRIBUTION_WINDOW_DAYS) || 30;

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/*
  Dark-surface badges: a low-alpha tint of the hue plus a light foreground. The original
  light-mode pairs (`bg-amber-100 text-amber-800`) invert the contrast on this page —
  a near-white chip with dark text, which reads as the loudest thing on screen for what
  is only a status label.
*/
const STATUS_COPY: Record<string, { label: string; style: string; hint: string }> = {
  pending: {
    label: 'Pending',
    style: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    hint: 'Confirmed once the order has been delivered and the return window has closed.',
  },
  approved: {
    label: 'Ready to pay',
    style: 'bg-sky-500/15 text-sky-300 border border-sky-500/30',
    hint: 'Included in your next payout.',
  },
  paid: {
    label: 'Paid',
    style: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    hint: 'Transferred to your account.',
  },
  reversed: {
    label: 'Reversed',
    style: 'bg-white/5 text-ink-muted border border-hairline',
    hint: 'The order was cancelled or returned.',
  },
  void: {
    label: 'Void',
    style: 'bg-white/5 text-ink-muted border border-hairline',
    hint: 'Cancelled by our team.',
  },
};

const card = 'bg-obsidian border border-hairline rounded-lg p-6';
const cardTitle = 'text-xs font-display font-bold text-ink-muted uppercase tracking-widest';
const primaryBtn =
  'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-sm bg-gold text-obsidian font-display font-bold uppercase tracking-widest text-sm hover:opacity-90 transition';

/** Full-page states (loading, not-an-affiliate, not-active) share this shell. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-obsidian-deep px-4 py-20">
      <div className="max-w-2xl mx-auto text-center">{children}</div>
    </main>
  );
}

export default function AffiliateDashboardPage() {
  useRequireAuth();
  const { isAuthenticated, user, isLoading: authLoading } = useAuth();

  const [cursor, setCursor] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const enabled = isAuthenticated && !!user;
  const { data, isPending, isError } = useMyAffiliate(enabled);
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

  /*
    ⚠️ GATE ON `isPending`, NOT `isLoading`, AND ON AUTH RESOLVING FIRST.

    TanStack v5 reports `isLoading: false` for a DISABLED query, and `enabled` is false
    until AuthContext resolves the user in an effect. So an `isLoading`-only gate is
    false on the very first paint, and the component falls through to `!affiliate` —
    flashing "You're not an affiliate yet" at an actual affiliate on every cold load.
    Worst on the approval-email link, which is this page's main entry point.

    `isPending` is true while disabled AND while first-fetching, which is exactly the
    window we must not render a verdict in.
  */
  if (authLoading || !enabled || isPending) {
    return (
      <Shell>
        <div className="animate-spin rounded-full h-12 w-12 mx-auto border-b-2 border-gold" />
        <span className="sr-only">Loading your affiliate dashboard</span>
      </Shell>
    );
  }

  /*
    A failed fetch is NOT "you are not an affiliate". Falling through to that branch
    tells someone their programme membership has vanished because a request timed out.
  */
  if (isError) {
    return (
      <Shell>
        <h1 className="text-3xl font-display font-light text-ink tracking-[-0.01em]">
          We couldn&apos;t load your dashboard
        </h1>
        <p className="mt-3 text-ink-muted font-display">
          Something went wrong on our side. Please try again in a moment.
        </p>
        <button onClick={() => window.location.reload()} className={`mt-8 ${primaryBtn}`}>
          Retry
        </button>
      </Shell>
    );
  }

  // Not an affiliate: a perfectly ordinary state for almost every customer, so this is
  // an invitation rather than an error page.
  if (!affiliate) {
    return (
      <Shell>
        <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold">
          Affiliate Programme
        </p>
        <h1 className="mt-4 text-3xl font-display font-light text-ink tracking-[-0.01em]">
          You&apos;re not an affiliate yet
        </h1>
        <p className="mt-3 text-ink-muted font-display">
          Earn commission by sharing Autobacs India with your audience.
        </p>
        <Link href="/affiliates" className={`mt-8 ${primaryBtn}`}>
          Read about the programme <ExternalLink className="w-4 h-4" aria-hidden />
        </Link>
      </Shell>
    );
  }

  if (affiliate.status !== 'active') {
    return (
      <Shell>
        <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold">
          Affiliate Programme
        </p>
        <h1 className="mt-4 text-3xl font-display font-light text-ink tracking-[-0.01em]">
          {affiliate.status === 'pending' ? 'Application under review' : 'Your account is paused'}
        </h1>
        <p className="mt-3 text-ink-muted font-display">
          {affiliate.status === 'pending'
            ? 'We review every application by hand. You will get an email once a decision is made.'
            : 'Your affiliate account is currently suspended. Please contact support if you think this is a mistake.'}
        </p>
        <Link
          href="/support"
          className="inline-block mt-8 font-display text-sm text-gold hover:text-gold/80"
        >
          Contact support
        </Link>
      </Shell>
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
    <main className="min-h-screen bg-obsidian-deep py-8">
      <div className="max-w-4xl mx-auto px-4 space-y-6">
        <header className="mb-10">
          <p className="font-display text-[10px] uppercase tracking-[0.28em] text-gold">Account</p>
          <h1 className="mt-4 text-[clamp(34px,5vw,60px)] font-display font-light leading-[0.95] tracking-[-0.01em] text-ink">
            Affiliate Dashboard
          </h1>
          <p className="mt-4 text-ink-muted font-display">
            You earn {affiliate.commissionPercent}% of the goods value on orders you bring in
            {hasSeparateRepeatRate ? ' from customers who are new to us' : ''}.
            {affiliate.discountPercent > 0 && ` Your code gives them ${affiliate.discountPercent}% off.`}
          </p>
        </header>

        {/* ── Link + code ──────────────────────────────────────────────────── */}
        <section className={card} aria-label="Your link and code">
          <h2 className={cardTitle}>Your link</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-64 bg-obsidian-raised border border-hairline text-ink rounded-sm px-3 py-2 font-mono text-sm focus:outline-none focus:border-gold"
              aria-label="Your affiliate link"
            />
            <button
              onClick={copy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-sm bg-gold text-obsidian font-display font-bold uppercase tracking-widest text-xs hover:opacity-90 transition"
            >
              {copied ? <Check className="w-4 h-4" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-3 text-sm text-ink-muted font-display">
            A click on this link is remembered for {ATTRIBUTION_WINDOW_DAYS} days. Your code{' '}
            <strong className="font-mono text-ink">{affiliate.code}</strong> also works on its own —
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
            <p className="mt-2 text-sm text-ink-muted font-display">
              You earn <strong className="text-ink">{affiliate.commissionPercent}%</strong> on orders
              from customers who are new to Autobacs India, and{' '}
              {affiliate.repeatCommissionPercent! > 0
                ? <><strong className="text-ink">{affiliate.repeatCommissionPercent}%</strong> when they have bought from us before.</>
                : <>nothing when they have bought from us before.</>}
            </p>
          )}
        </section>

        {/* ── Earnings ─────────────────────────────────────────────────────── */}
        <section className={card} aria-label="Earnings">
          <h2 className={cardTitle}>Earnings</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs font-display text-ink-muted uppercase tracking-widest">Ready to pay</p>
              <p className="mt-1 text-2xl font-display font-light text-gold tracking-[-0.01em]">
                {rupees(data?.payableBalancePaise ?? 0)}
              </p>
            </div>
            {(['pending', 'approved', 'paid'] as const).map((key) => (
              <div key={key}>
                <p className="text-xs font-display text-ink-muted uppercase tracking-widest">
                  {STATUS_COPY[key].label}
                </p>
                <p className="mt-1 text-lg font-display text-ink">{rupees(summary[key]?.netPaise ?? 0)}</p>
                <p className="text-xs text-ink-muted font-display">{summary[key]?.count ?? 0} orders</p>
              </div>
            ))}
          </div>

          {(data?.payableBalancePaise ?? 0) < 0 && (
            <p className="mt-4 rounded-sm border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 font-display">
              An order you referred was refunded after it had been paid out, so this amount
              is carried against your next earnings. Nothing is owed by you directly.
            </p>
          )}

          <p className="mt-4 text-xs text-ink-muted font-display">
            Commission is confirmed once an order has been delivered and its return window
            has closed, then paid by bank transfer.
            {!affiliate.payoutDetails?.accountLast4 && ' We will ask for your bank details before your first payout.'}
          </p>
        </section>

        {/* ── Ledger ───────────────────────────────────────────────────────── */}
        <section className={card} aria-label="Referred orders">
          <h2 className={cardTitle}>Referred orders</h2>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm font-display">
              <thead className="text-left">
                <tr className="text-[10px] uppercase tracking-widest text-ink-muted">
                  <th className="py-2 font-bold">Date</th>
                  <th className="py-2 font-bold">Order value</th>
                  <th className="py-2 font-bold text-right">Your commission</th>
                  <th className="py-2 font-bold">Status</th>
                </tr>
              </thead>
              <tbody>
                {ledgerLoading && (
                  <tr><td colSpan={4} className="py-8 text-center text-ink-muted">Loading…</td></tr>
                )}
                {!ledgerLoading && (ledger?.commissions?.length ?? 0) === 0 && (
                  <tr><td colSpan={4} className="py-8 text-center text-ink-muted">
                    No referred orders yet. Share your link to get started.
                  </td></tr>
                )}
                {ledger?.commissions?.map((c) => {
                  const copyFor = STATUS_COPY[c.status] ?? STATUS_COPY.pending;
                  return (
                    <tr key={c._id} className="border-t border-hairline">
                      <td className="py-3 text-ink">{formatDateIST(c.createdAt)}</td>
                      <td className="py-3 text-ink-muted">
                        {c.order ? `₹${c.order.totalAmount.toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className={`py-3 text-right font-medium ${c.amountPaise < 0 ? 'text-red-400' : 'text-ink'}`}>
                        {rupees(c.amountPaise)}
                      </td>
                      <td className="py-3">
                        <span
                          className={`inline-block px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${copyFor.style}`}
                          title={copyFor.hint}
                        >
                          {copyFor.label}
                        </span>
                        {c.status === 'pending' && c.maturesAt && (
                          <div className="mt-1 text-xs text-ink-muted">
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
                className="px-4 py-2 border border-hairline text-ink-muted hover:text-ink hover:border-gold rounded-sm text-xs font-display font-bold uppercase tracking-widest transition"
              >
                Back to start
              </button>
            )}
            <button
              onClick={() => setCursor(ledger?.nextCursor ?? null)}
              disabled={!ledger?.nextCursor}
              className="px-4 py-2 border border-hairline text-ink-muted hover:text-ink hover:border-gold rounded-sm text-xs font-display font-bold uppercase tracking-widest transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-ink-muted disabled:hover:border-hairline"
            >
              Older
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

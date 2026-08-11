'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { Gift, Mail, CheckCircle2, ArrowRight, Clock, ShieldCheck } from 'lucide-react';
import apiClient from '@/lib/api';
import { API_ENDPOINTS, ACTIVE_CAMPAIGN_SLUG } from '@/lib/constants';
import { useCampaign } from '@/hooks/queries/useCampaign';

/**
 * /festive — where the printed QR code lands.
 *
 * The QR is on ~200 identical cards, so it is a doorway, not a secret: it will be
 * photographed and shared. Authorisation is the email allowlist, enforced server-side.
 * A stranger who scans a leaked card reaches this page and gets nothing, which is the
 * correct outcome and why this page can be friendly rather than defensive.
 *
 * The primary action is deliberately "claim", not "log in". Of the invited customers,
 * 187 of 191 have an account created by the WooCommerce/Order-Manager import with a
 * confirmed email but no password they have ever set — telling them to log in would
 * strand almost everyone. Nobody on the list needs to register or verify anything.
 */

type CheckResult = {
  onList: boolean;
  action: 'not_invited' | 'register' | 'set_password' | 'verify_email' | 'login';
  campaignLive: boolean;
  name?: string | null;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** Days/hours/minutes until the offer closes — real urgency, from the real end date. */
function useCountdown(endsAt: string | null | undefined) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // Starts null so the server-rendered markup and the first client render agree;
    // hydration mismatches are a recurring bug source in this app.
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!endsAt || now == null) return null;
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return null;
  return {
    days: Math.floor(ms / 864e5),
    hours: Math.floor((ms % 864e5) / 36e5),
    minutes: Math.floor((ms % 36e5) / 6e4),
  };
}

export default function FestivePage() {
  const { data: campaign, isLoading } = useCampaign(0);
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [linkSent, setLinkSent] = useState(false);
  const countdown = useCountdown(campaign?.endsAt);

  const check = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ success: boolean } & CheckResult>(
        API_ENDPOINTS.CAMPAIGN_CHECK_EMAIL(ACTIVE_CAMPAIGN_SLUG),
        { email: email.trim() },
      );
      return res;
    },
    onSuccess: (res) => { setResult(res); setLinkSent(false); },
  });

  // Reuses the existing magic-link endpoint rather than adding a second
  // set-a-password flow. The emailed link lands on /claim-order, which already
  // handles choosing a password and signing the customer in.
  const sendLink = useMutation({
    mutationFn: () => apiClient.post(API_ENDPOINTS.MAGIC_LINK_REQUEST, { email: email.trim() }),
    onSuccess: () => setLinkSent(true),
  });

  const topTier = campaign?.tiers?.length
    ? campaign.tiers.reduce((a, b) => (b.percent > a.percent ? b : a))
    : null;

  return (
    <main className="min-h-screen bg-[#0B0B0B] text-white">
      <div className="mx-auto max-w-2xl px-6 py-16">

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-gold">
            <Gift size={13} /> By invitation only
          </span>

          <h1 className="mt-6 font-display text-4xl font-bold leading-tight sm:text-5xl">
            Thank you for driving with us.
          </h1>
          <p className="mt-4 text-lg text-zinc-400">
            {topTier
              ? <>Your reward is waiting — <span className="text-gold">up to {topTier.percent}% off</span>, and it grows with your cart.</>
              : <>Your reward is waiting.</>}
          </p>

          {countdown && (
            <p className="mt-5 inline-flex items-center gap-2 text-sm text-zinc-500">
              <Clock size={14} />
              Closes in <span className="text-white">{countdown.days}d {countdown.hours}h {countdown.minutes}m</span>
            </p>
          )}
        </div>

        {/* ── Already eligible ─────────────────────────────────────────────── */}
        {campaign?.eligible && (
          <div className="mt-12 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center">
            <CheckCircle2 className="mx-auto text-emerald-400" size={32} />
            <h2 className="mt-4 text-2xl font-semibold">You&apos;re in.</h2>
            <p className="mt-2 text-zinc-300">
              Your reward is active. Add items to your cart and watch your saving grow —
              it applies automatically at checkout.
            </p>
            <Link
              href="/products"
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-3 font-semibold text-black transition hover:brightness-110"
            >
              Start shopping <ArrowRight size={16} />
            </Link>
          </div>
        )}

        {/* ── Not yet identified ───────────────────────────────────────────── */}
        {!isLoading && !campaign?.eligible && (
          <div className="mt-12 rounded-xl border border-zinc-800 bg-zinc-900/50 p-8">
            <Steps />

            <div className="mt-8">
              <label htmlFor="festive-email" className="mb-2 block text-sm font-medium text-zinc-300">
                The email address on your last order
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  id="festive-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setResult(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && email.trim()) check.mutate(); }}
                  placeholder="you@example.com"
                  className="flex-1 rounded-lg border border-zinc-700 bg-black px-4 py-3 text-white placeholder-zinc-600 focus:border-gold focus:outline-none"
                />
                <button
                  onClick={() => check.mutate()}
                  disabled={!email.trim() || check.isPending}
                  className="rounded-lg bg-gold px-6 py-3 font-semibold text-black transition hover:brightness-110 disabled:opacity-40"
                >
                  {check.isPending ? 'Checking…' : 'Claim my reward'}
                </button>
              </div>

              {check.isError && (
                <p className="mt-3 text-sm text-red-400">{(check.error as Error).message}</p>
              )}

              {result && (
                <Outcome
                  result={result}
                  email={email.trim()}
                  linkSent={linkSent}
                  sending={sendLink.isPending}
                  onSendLink={() => sendLink.mutate()}
                  sendError={sendLink.isError ? (sendLink.error as Error).message : null}
                />
              )}
            </div>
          </div>
        )}

        {/* ── The ladder ───────────────────────────────────────────────────── */}
        {campaign?.tiers?.length ? (
          <div className="mt-12">
            <h3 className="mb-4 text-center text-sm font-medium uppercase tracking-widest text-zinc-500">
              How your reward grows
            </h3>
            <div className="space-y-2">
              {[...campaign.tiers]
                .sort((a, b) => a.minCartValue - b.minCartValue)
                .map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/30 px-5 py-3">
                    <span className="text-zinc-400">
                      {t.minCartValue > 0 ? <>Carts over {inr(t.minCartValue)}</> : <>Any order</>}
                    </span>
                    <span className="font-semibold text-gold">
                      {t.percent}% off{t.maxDiscount ? <span className="ml-1 text-xs font-normal text-zinc-500">up to {inr(t.maxDiscount)}</span> : null}
                    </span>
                  </div>
                ))}
            </div>
            <p className="mt-4 text-center text-xs text-zinc-600">
              We always apply whichever tier saves you the most, so your discount never goes
              down as you add more. One reward per customer.
            </p>
          </div>
        ) : null}

        <p className="mt-12 flex items-center justify-center gap-2 text-center text-xs text-zinc-600">
          <ShieldCheck size={13} />
          This offer is tied to your email address and can&apos;t be transferred.
        </p>
      </div>
    </main>
  );
}

function Steps() {
  const steps = ['Confirm it’s you', 'Fill your cart', 'Watch your reward grow'];
  return (
    <ol className="flex flex-col gap-4 sm:flex-row sm:gap-6">
      {steps.map((s, i) => (
        <li key={s} className="flex flex-1 items-center gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold/40 text-xs font-semibold text-gold">
            {i + 1}
          </span>
          <span className="text-sm text-zinc-400">{s}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * What we tell someone after they type their address. Every branch ends in a concrete
 * next step — a dead end here is a lost customer holding a printed card.
 */
function Outcome({
  result, email, linkSent, sending, onSendLink, sendError,
}: {
  result: CheckResult;
  email: string;
  linkSent: boolean;
  sending: boolean;
  onSendLink: () => void;
  sendError: string | null;
}) {
  const box = 'mt-6 rounded-lg border p-5';

  if (!result.onList) {
    return (
      <div className={`${box} border-zinc-700 bg-zinc-900`}>
        <p className="text-zinc-300">
          We can&apos;t find this reward against <span className="text-white">{email}</span>.
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          Try the address you used on your last order — it may be a different one. If you
          think this is a mistake, reply to the message your card came with and we&apos;ll sort it out.
        </p>
      </div>
    );
  }

  if (!result.campaignLive) {
    return (
      <div className={`${box} border-zinc-700 bg-zinc-900`}>
        <p className="text-zinc-300">
          Good news — you&apos;re on the list{result.name ? `, ${result.name}` : ''}.
        </p>
        <p className="mt-2 text-sm text-zinc-500">This offer hasn&apos;t opened yet. Check back shortly.</p>
      </div>
    );
  }

  // The overwhelming majority: account exists, email already confirmed, no password set.
  if (result.action === 'set_password' || result.action === 'verify_email') {
    return (
      <div className={`${box} border-emerald-500/30 bg-emerald-500/10`}>
        <p className="flex items-center gap-2 font-semibold text-emerald-300">
          <CheckCircle2 size={18} /> You&apos;re on the list{result.name ? `, ${result.name}` : ''}!
        </p>
        {linkSent ? (
          <p className="mt-3 flex items-start gap-2 text-sm text-zinc-300">
            <Mail size={16} className="mt-0.5 shrink-0 text-emerald-400" />
            Check <span className="text-white">{email}</span> — we&apos;ve sent you a link.
            Click it, choose a password, and your reward is live.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-zinc-300">
              Your account is already set up — you just need a password. We&apos;ll email you a
              link to choose one. No registration, nothing to verify.
            </p>
            <button
              onClick={onSendLink}
              disabled={sending}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 font-semibold text-black transition hover:brightness-110 disabled:opacity-40"
            >
              {sending ? 'Sending…' : <>Email me the link <ArrowRight size={15} /></>}
            </button>
          </>
        )}
        {sendError && <p className="mt-3 text-sm text-red-400">{sendError}</p>}
      </div>
    );
  }

  if (result.action === 'login') {
    return (
      <div className={`${box} border-emerald-500/30 bg-emerald-500/10`}>
        <p className="flex items-center gap-2 font-semibold text-emerald-300">
          <CheckCircle2 size={18} /> You&apos;re on the list{result.name ? `, ${result.name}` : ''}!
        </p>
        <p className="mt-2 text-sm text-zinc-300">Sign in and your reward is applied automatically.</p>
        <Link
          href={`/login?redirect=${encodeURIComponent('/festive')}`}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 font-semibold text-black transition hover:brightness-110"
        >
          Sign in <ArrowRight size={15} />
        </Link>
      </div>
    );
  }

  // 'register' — nobody on the current list should hit this, but a later campaign might.
  return (
    <div className={`${box} border-emerald-500/30 bg-emerald-500/10`}>
      <p className="flex items-center gap-2 font-semibold text-emerald-300">
        <CheckCircle2 size={18} /> You&apos;re on the list{result.name ? `, ${result.name}` : ''}!
      </p>
      <p className="mt-2 text-sm text-zinc-300">Create your account with this address and your reward is applied automatically.</p>
      <Link
        href={`/register?email=${encodeURIComponent(email)}&redirect=${encodeURIComponent('/festive')}`}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 font-semibold text-black transition hover:brightness-110"
      >
        Create my account <ArrowRight size={15} />
      </Link>
    </div>
  );
}

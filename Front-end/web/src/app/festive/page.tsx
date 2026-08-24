'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Gift, CheckCircle2, ArrowRight, Clock, ShieldCheck, MailWarning } from 'lucide-react';
import { useCampaign } from '@/hooks/queries/useCampaign';
import { useAuth } from '@/context/AuthContext';
import { trackCampaignOfferViewed } from '@/lib/analytics';
import { ACTIVE_CAMPAIGN_SLUG } from '@/lib/constants';

/**
 * /festive — where the printed QR code lands.
 *
 * PUBLIC. This page used to check the visitor's email against a campaign allowlist,
 * because the card went to 191 named customers. It is now an open offer: the campaign's
 * audience is 'everyone', so anyone holding the card — or a photo of it — can redeem.
 * The QR is printed and cannot be reissued, so the route stayed while its meaning
 * changed, and the email step went with the allowlist that justified it.
 *
 * What stops it being abused is not secrecy. It is the campaign's redemption cap, the
 * verified-email requirement, and `usageLimitPerUser: 1` on the managed coupon —
 * enforced atomically at checkout by CouponUserUsage's guarded upsert. Sharing the card
 * is expected behaviour, not the threat model.
 *
 * The discount itself is the campaign's PER-PRODUCT ladder: each cart line earns a rate
 * according to the tier its product belongs to, so one cart can hold several rates at
 * once. This page therefore advertises a range and a floor, never a single number — the
 * per-line detail belongs in the cart, where the server has priced the actual goods.
 *
 * Every figure comes from the live campaign. Nothing about the offer is hardcoded here,
 * so an admin editing the ladder can never leave this page promising a rate checkout
 * would refuse.
 */

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
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const countdown = useCountdown(campaign?.endsAt);

  /*
    The scan signal.

    A `$pageview` already records that someone reached this route, but it is keyed on the
    PATH. The QR is printed and can never be reissued, so this route will be pointed at
    the next campaign too, and a funnel built on the path would silently merge the two.
    This event carries the SLUG, so each campaign's scans stay separable for ever.

    Fired once the eligibility lookup settles rather than on mount, so `offerLive` and
    `eligible` are real answers instead of "still loading". It fires even when the
    campaign has ended — a scan of a dead card is exactly the thing worth knowing about,
    and it is the one case the campaign response cannot name itself, hence the fallback
    to the configured slug.
  */
  const reportedRef = useRef(false);
  useEffect(() => {
    if (isLoading || reportedRef.current) return;
    reportedRef.current = true;
    trackCampaignOfferViewed({
      slug: campaign?.slug ?? ACTIVE_CAMPAIGN_SLUG,
      offerLive: !!campaign,
      eligible: campaign ? campaign.eligible : null,
    });
  }, [isLoading, campaign?.slug, campaign?.eligible]);

  const ladder = campaign?.productLadder ?? null;
  // The cart-value ladder's best rung, for a campaign configured the older way. Keeps
  // this page correct for either kind of campaign rather than silently blank for one.
  const topCartTier = campaign?.tiers?.length
    ? campaign.tiers.reduce((a, b) => (b.percent > a.percent ? b : a))
    : null;
  const headlinePercent = ladder?.maxPercent ?? topCartTier?.percent ?? null;

  // An offer nobody can reach yet, or one that has closed, must not show a claim button.
  const offerOver = !isLoading && !campaign;

  return (
    <main className="min-h-screen bg-[#0B0B0B] text-white">
      <div className="mx-auto max-w-2xl px-6 py-16">

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-gold">
            <Gift size={13} /> Scan &amp; save
          </span>

          <h1 className="mt-6 font-display text-4xl font-bold leading-tight sm:text-5xl">
            Thank you for driving with us.
          </h1>

          <p className="mt-4 text-lg text-zinc-400">
            {headlinePercent
              ? <>Your reward is waiting — <span className="text-gold">up to {headlinePercent}% off</span>, applied automatically at checkout.</>
              : <>Your reward is waiting.</>}
          </p>

          {countdown && (
            <p className="mt-5 inline-flex items-center gap-2 text-sm text-zinc-500">
              <Clock size={14} />
              Closes in <span className="text-white">{countdown.days}d {countdown.hours}h {countdown.minutes}m</span>
            </p>
          )}
        </div>

        {/* ── The claim ────────────────────────────────────────────────────── */}
        {isLoading || authLoading ? (
          <div className="mt-12 h-44 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
        ) : offerOver ? (
          /* The campaign 404s when it is off, unconfigured, or past its end date. All
             the same to a cardholder, and there is nothing they could do differently —
             what they need is a way onward, not a diagnosis. */
          <div className="mt-12 rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
            <h2 className="text-xl font-semibold">This offer has ended.</h2>
            <p className="mt-2 text-zinc-400">
              Thank you for scanning — this reward is no longer available, but there is
              plenty worth looking at.
            </p>
            <Link
              href="/products"
              className="mt-6 inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-6 py-3 font-semibold transition hover:border-gold hover:text-gold"
            >
              Browse the catalogue <ArrowRight size={16} />
            </Link>
          </div>
        ) : campaign?.eligible ? (
          <div className="mt-12 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center">
            <CheckCircle2 className="mx-auto text-emerald-400" size={32} />
            <h2 className="mt-4 text-2xl font-semibold">You&apos;re in.</h2>
            <p className="mt-2 text-zinc-300">
              Your reward is active. Add items to your cart and the discount is applied
              for you — no code to enter.
            </p>
            <Link
              href="/products"
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-3 font-semibold text-black transition hover:brightness-110"
            >
              Start shopping <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <Blocked reasonCode={campaign?.reasonCode ?? null} signedIn={isAuthenticated} />
        )}

        {/* ── How the rate is decided ──────────────────────────────────────── */}
        {/* Stated up front rather than discovered at checkout. A buyer who expects the
            headline rate on a product that earns the default one — or on something
            already discounted — reads the difference as the site short-changing them. */}
        {ladder && (
          <div className="mt-12">
            <h3 className="mb-4 text-center text-sm font-medium uppercase tracking-widest text-zinc-500">
              How your reward is worked out
            </h3>
            <dl className="space-y-2">
              <Row term="Selected products" value={`up to ${ladder.maxPercent}% off`} highlight />
              <Row term="Everything else" value={`${ladder.defaultPercent}% off`} />
              <Row
                term="Items already on offer"
                value={`${ladder.onSaleMaxPercent}% off`}
                note="on top of the sale price"
              />
            </dl>
            <p className="mt-4 text-center text-xs text-zinc-600">
              Your exact saving is shown in your cart before you pay.
            </p>
          </div>
        )}

        <p className="mt-12 flex items-center justify-center gap-2 text-center text-xs text-zinc-600">
          <ShieldCheck size={13} />
          One reward per customer. Applied at checkout once you&apos;re signed in.
        </p>
      </div>
    </main>
  );
}

function Row({ term, value, note, highlight }: {
  term: string; value: string; note?: string; highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/30 px-5 py-3">
      <dt className="text-zinc-400">
        {term}
        {note && <span className="ml-2 text-xs text-zinc-600">{note}</span>}
      </dt>
      <dd className={`font-semibold ${highlight ? 'text-gold' : 'text-zinc-300'}`}>{value}</dd>
    </div>
  );
}

/**
 * Why this visitor cannot claim yet, and the one thing that fixes it.
 *
 * The campaign refuses for several reasons and they need different answers — sending
 * an unverified customer to a login screen they can already pass would loop them
 * forever. A dead end here is a lost customer holding a printed card.
 */
function Blocked({ reasonCode, signedIn }: { reasonCode: string | null; signedIn: boolean }) {
  const box = 'mt-12 rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center';

  // The commonest case by far: a public offer, and the visitor simply is not signed in.
  if (!signedIn) {
    return (
      <div className={box}>
        <h2 className="text-xl font-semibold">Sign in to claim it.</h2>
        <p className="mt-2 text-zinc-400">
          Your reward is tied to your account, so we can honour it once per customer.
          New here? Creating an account takes a moment.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={`/login?redirect=${encodeURIComponent('/festive')}`}
            className="inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-3 font-semibold text-black transition hover:brightness-110"
          >
            Sign in <ArrowRight size={15} />
          </Link>
          <Link
            href={`/register?redirect=${encodeURIComponent('/festive')}`}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-6 py-3 font-semibold transition hover:border-gold hover:text-gold"
          >
            Create an account
          </Link>
        </div>
      </div>
    );
  }

  // Signed in but the address was never confirmed. Sending them to /login would loop.
  if (reasonCode === 'unverified') {
    return (
      <div className={box}>
        <MailWarning className="mx-auto text-amber-400" size={28} />
        <h2 className="mt-4 text-xl font-semibold">Confirm your email to unlock it.</h2>
        <p className="mt-2 text-zinc-400">
          We sent a confirmation link when you registered. Open it and your reward goes
          live — this is how we keep the offer to one per customer.
        </p>
        <Link
          href="/verify-email"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-3 font-semibold text-black transition hover:brightness-110"
        >
          Resend the link <ArrowRight size={15} />
        </Link>
      </div>
    );
  }

  if (reasonCode === 'exhausted') {
    return (
      <div className={box}>
        <h2 className="text-xl font-semibold">This offer has been fully claimed.</h2>
        <p className="mt-2 text-zinc-400">
          Every reward has been taken. Thank you for scanning — do have a look at what
          else is on.
        </p>
        <Link
          href="/products"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-6 py-3 font-semibold transition hover:border-gold hover:text-gold"
        >
          Browse the catalogue <ArrowRight size={16} />
        </Link>
      </div>
    );
  }

  if (reasonCode === 'already_used') {
    return (
      <div className={box}>
        <CheckCircle2 className="mx-auto text-emerald-400" size={28} />
        <h2 className="mt-4 text-xl font-semibold">You&apos;ve already used this one.</h2>
        <p className="mt-2 text-zinc-400">
          The reward is one per customer, and yours has been redeemed. Thank you.
        </p>
      </div>
    );
  }

  // Not started, ended, or anything the engine adds later. Never guess at a reason.
  return (
    <div className={box}>
      <h2 className="text-xl font-semibold">This reward isn&apos;t available just yet.</h2>
      <p className="mt-2 text-zinc-400">
        Check back shortly — and in the meantime, the catalogue is open.
      </p>
      <Link
        href="/products"
        className="mt-6 inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-6 py-3 font-semibold transition hover:border-gold hover:text-gold"
      >
        Browse the catalogue <ArrowRight size={16} />
      </Link>
    </div>
  );
}

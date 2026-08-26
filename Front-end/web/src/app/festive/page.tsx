'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Gift, CheckCircle2, ArrowRight, Clock, ShieldCheck, MailWarning } from 'lucide-react';
import { useCampaign, useActivateCampaign, campaignCeilingLabel } from '@/hooks/queries/useCampaign';
import { useCurrency } from '@/context/CurrencyContext';
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
  const { formatPrice } = useCurrency();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const countdown = useCountdown(campaign?.endsAt);

  /*
    ── Activation: the thing this page is actually for ────────────────────────

    On a campaign that requires it, the offer reaches ONLY customers who have been
    here. That is a real boundary rather than a formality because this route has no
    link anywhere on the site, is `noindex`, and is absent from the sitemap — so
    arriving means arriving from the printed card. A shopper who signs up through the
    ordinary registration form never reaches this line and never gets the offer.

    Fired from `requiresActivation && !activated` rather than from the refusal code.
    The refusal code is the wrong signal: an unverified customer is refused for their
    email BEFORE activation is ever considered, so keying on `not_activated` would skip
    the exact person who most needs recording — someone who scans, registers, and is
    sent off to their inbox. Activation and verification are independent, and the
    server keeps enforcing verification at pricing time regardless.

    A failure is deliberately swallowed to a retry rather than surfaced: the mutation's
    own error state drives the panel below, and the customer's next move is the same
    either way.
  */
  const activate = useActivateCampaign();
  const needsActivation = !!campaign?.requiresActivation && !campaign.activated;
  const activateRef = useRef(false);
  /*
    Covers the gap between "we know they need activating" and the response landing,
    INCLUDING the render before the effect has run — `isPending` alone is false then, and
    the panel would flash a refusal at someone who is about to be told they are in.

    Ends the moment the mutation SETTLES, either way, and that second clause is
    load-bearing rather than tidiness. `needsActivation` is derived from the server's
    `activated`, which evaluate() cannot report on its lifecycle refusals — they return
    before the member row is ever read. So a campaign that ends while a tab is open
    reports `activated: false` for a customer who really did activate, `needsActivation`
    stays true for ever, and without this the page would sit on a pulsing skeleton
    instead of saying "this offer has ended". Once we have asked once, the answer we got
    back is what gets rendered.
  */
  const activating =
    isAuthenticated && needsActivation && !activate.isError && !activate.isSuccess;
  useEffect(() => {
    if (!isAuthenticated || !needsActivation || activateRef.current) return;
    activateRef.current = true;
    activate.mutate();
  }, [isAuthenticated, needsActivation, activate]);

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

  /*
    The headline, as MONEY rather than as a rate.

    Both ladder shapes used to resolve to a top PERCENTAGE here, which on a landing page
    is the least actionable figure available: the visitor has scanned a printed card and
    has no product in front of them to apply a rate to. `campaignCeilingLabel` reads the
    ceiling pricingService enforces, so "up to ₹1,87,000 off" holds for either shape and
    needs no ladder-specific branch at all.

    Null when the campaign has no ceiling, and then the hero says the reward is waiting
    without quantifying it — an uncapped campaign has no honest rupee maximum.
  */
  const ladder = campaign?.productLadder ?? null;
  const ceiling = campaignCeilingLabel(campaign, formatPrice);

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
            {ceiling
              ? <>Your reward is waiting — <span className="text-gold">{ceiling}</span>, applied automatically at checkout.</>
              /*
                No ceiling configured, so there is no honest rupee maximum to print. The
                hero must still say something a scanner can act on — this page is reached
                from a printed card that cannot be reissued, and an unquantified promise
                with no next step is what makes someone put the card down. So it names
                where the number IS, rather than leaving a sentence with nothing in it.
              */
              : <>Your reward is waiting — the saving is shown in rupees on every product, applied automatically at checkout.</>}
          </p>

          {countdown && (
            <p className="mt-5 inline-flex items-center gap-2 text-sm text-zinc-500">
              <Clock size={14} />
              Closes in <span className="text-white">{countdown.days}d {countdown.hours}h {countdown.minutes}m</span>
            </p>
          )}
        </div>

        {/* ── The claim ────────────────────────────────────────────────────── */}
        {/* The activation round-trip is folded into the SAME skeleton as the initial
            load, deliberately. A cardholder who has just signed in should see one
            settling moment and then their reward — not "you cannot have this" for half
            a second while the write lands, which is the version they would screenshot. */}
        {isLoading || authLoading || activating ? (
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
          <Blocked
            reasonCode={campaign?.reasonCode ?? null}
            signedIn={isAuthenticated}
            onRetry={needsActivation ? () => activate.mutate() : undefined}
          />
        )}

        {/* ── Where the saving shows up ────────────────────────────────────── */}
        {/*
          This was a table of the ladder — 8% on selected products, 4% on everything
          else, 2% on things already discounted. It existed so a smaller-than-expected
          saving read as the published rule rather than as a short-change, and that job
          is now done better and earlier: every card in the catalogue names the saving on
          that product in rupees, the buy box repeats it, and the bag itemises it per
          line. A visitor who can see the actual figure on the actual product has no use
          for three rates they would have to apply themselves.
        */}
        {ladder && (
          <p className="mt-12 text-center text-sm text-zinc-500">
            The saving is shown in rupees on every product, and again on each item in your
            bag before you pay. Nothing to enter — it is applied for you.
          </p>
        )}

        <p className="mt-12 flex items-center justify-center gap-2 text-center text-xs text-zinc-600">
          <ShieldCheck size={13} />
          One reward per customer. Applied at checkout once you&apos;re signed in.
        </p>
      </div>
    </main>
  );
}

/**
 * Why this visitor cannot claim yet, and the one thing that fixes it.
 *
 * The campaign refuses for several reasons and they need different answers — sending
 * an unverified customer to a login screen they can already pass would loop them
 * forever. A dead end here is a lost customer holding a printed card.
 */
function Blocked({ reasonCode, signedIn, onRetry }: {
  reasonCode: string | null;
  signedIn: boolean;
  /** Present only when the refusal is a failed activation, which is the one a retry fixes. */
  onRetry?: () => void;
}) {
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

  /*
    Signed in, on the right page, and STILL not activated — so the activation write
    failed. The only refusal on this page the customer did nothing to cause, and the only
    one where the fix is simply to try again.

    Worth its own branch rather than falling through to the generic message: they are
    holding a card, they did everything asked of them, and "this offer has not been
    activated on your account" with no button would read as the card being worthless.
  */
  if (reasonCode === 'not_activated') {
    return (
      <div className={box}>
        <h2 className="text-xl font-semibold">Almost there.</h2>
        <p className="mt-2 text-zinc-400">
          We could not activate your reward just now. It is still yours — try once more.
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-3 font-semibold text-black transition hover:brightness-110"
          >
            Activate my reward <ArrowRight size={15} />
          </button>
        )}
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

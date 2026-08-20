'use client';

import Link from 'next/link';
import { CheckCircle2, Gift, Loader2, ArrowRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { OFFERS } from '@/lib/offers';

/**
 * /onam — where the printed counter QR lands.
 *
 * The sale this belongs to is settled entirely in the shop: cash at the counter, on
 * goods that are not in the catalogue, at a price our team applies by hand. So this
 * page moves no money and deliberately touches no backend of its own. Its single job
 * is to get the customer signed in, which is why the only real state it reads is
 * "authenticated or not".
 *
 * Consequently there is nothing here to gate. The QR is printed on cards that will be
 * photographed and shared, so treating it as a secret would be theatre; a stranger who
 * opens this URL sees a promotion and can sign up, which costs us nothing because no
 * discount is attached to the account. The discount lives with the person standing at
 * the counter, not with the login.
 *
 * Kept out of the index (sibling layout + robots.ts) all the same: a search result for
 * "autobacs onam offer" would put a counter-only promotion in front of the whole
 * internet, and the goodwill problem that creates is real even though the security one
 * is not.
 */
const offer = OFFERS.onam;

/** `/login?offer=onam&redirect=/onam`, built from the offer so the two cannot drift. */
const authHref = (screen: 'login' | 'register') =>
  `/${screen}?offer=${offer.key}&redirect=${encodeURIComponent(offer.landingPath)}`;

export default function OnamOfferPage() {
  const { isAuthenticated, isLoading, user } = useAuth();

  return (
    <main className="min-h-screen bg-obsidian-deep text-ink">
      <div className="mx-auto max-w-2xl px-6 py-16">

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold-soft px-4 py-1.5 text-xs font-display font-bold uppercase tracking-widest text-gold">
            <Gift size={13} aria-hidden="true" /> {offer.eyebrow}
          </span>

          <h1 className="mt-6 font-display text-4xl font-light leading-tight tracking-[-0.01em] sm:text-5xl">
            {isAuthenticated ? 'Your coupon is activated' : offer.title}
          </h1>
        </div>

        {/*
          Three states, and the loading one matters as much as the other two. Auth
          resolves from a cached check that can miss, so rendering the signed-out
          branch while it settles flashes "sign in to activate" at a customer who is
          already signed in — on a phone, at a counter, with a member of staff
          watching. Hold the fold instead; it is brief.
        */}
        {isLoading ? (
          <div
            data-testid="onam-loading"
            className="mt-12 flex items-center justify-center rounded-lg border border-hairline bg-obsidian p-12"
          >
            <Loader2 className="h-6 w-6 animate-spin text-gold" aria-hidden="true" />
            <span className="sr-only">Checking your account…</span>
          </div>
        ) : isAuthenticated ? (

          /* ── Activated ──────────────────────────────────────────────────── */
          <div
            data-testid="onam-activated"
            className="mt-12 rounded-lg border border-gold/40 bg-gold-soft p-8 text-center"
          >
            <CheckCircle2 className="mx-auto text-gold" size={32} aria-hidden="true" />
            <h2 className="mt-4 font-display text-2xl font-light">
              {/* Greets by name when we have one, and reads correctly when we don't —
                  a social sign-in can leave the name blank. */}
              {user?.name ? `You're all set, ${user.name}.` : "You're all set."}
            </h2>
            <p className="mt-3 font-display text-ink-muted">
              Show this screen at the counter and our team will apply your Onam price
              to your purchase.
            </p>
            <Link
              href="/products"
              className="mt-6 inline-flex items-center gap-2 rounded-sm bg-gold px-6 py-3 font-display font-bold uppercase tracking-widest text-obsidian transition-opacity hover:opacity-90"
            >
              Browse the store <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        ) : (

          /* ── Sign in to activate ────────────────────────────────────────── */
          <div
            data-testid="onam-signin"
            className="mt-12 rounded-lg border border-hairline bg-obsidian p-8 text-center"
          >
            <p className="font-display text-lg text-ink-muted">{offer.tagline}</p>

            {/*
              Registration is offered as prominently as sign-in, not tucked into the
              footnote the way an account-holder-first screen would put it. Whoever is
              holding this card is standing in the shop and has most likely never
              bought from us online, so "create an account" is the main path here, not
              the edge case.
            */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Link
                href={authHref('login')}
                className="inline-flex items-center justify-center gap-2 rounded-sm bg-gold px-6 py-3 font-display font-bold uppercase tracking-widest text-obsidian transition-opacity hover:opacity-90"
              >
                Activate my coupon
              </Link>
              <Link
                href={authHref('register')}
                className="inline-flex items-center justify-center gap-2 rounded-sm border border-hairline px-6 py-3 font-display font-bold uppercase tracking-widest text-ink transition-colors hover:border-gold"
              >
                I&apos;m new here
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

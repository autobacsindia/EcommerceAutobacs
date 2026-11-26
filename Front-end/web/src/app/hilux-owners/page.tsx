'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Copy, Gift, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { HILUX_OFFER } from '@/lib/hiluxOffer';
import { savePendingCoupon } from '@/lib/pendingCoupon';

/**
 * /hilux-owners — where the thank-you card QR lands.
 *
 * Its job: tell the cardholder what they get, keep the code for them so the cart applies
 * it on its own, and send them to the Hilux parts. It decides nothing about money — the
 * server checks the code (Hilux/Revo/Travo parts, ₹25,000 minimum, once per customer)
 * when it is applied and again at checkout. The code is also shown in full, because
 * saving it on the device is best effort and the card may be scanned on a different
 * phone from the one used to buy.
 *
 * Signing in is asked for up front: "once per customer" is counted per account, so a
 * guest cart is refused with "please log in" — better said here than at the till.
 */
const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

const authHref = (screen: 'login' | 'register') =>
  `/${screen}?redirect=${encodeURIComponent(HILUX_OFFER.landingPath)}`;

export default function HiluxOwnersPage() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [copied, setCopied] = useState(false);

  // Keep the code for the cart. Once per visit is enough; re-saving only refreshes its age.
  useEffect(() => {
    savePendingCoupon(HILUX_OFFER.code);
  }, []);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(HILUX_OFFER.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the code is on screen to type */
    }
  };

  return (
    <main className="min-h-screen bg-obsidian-deep text-ink">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-xs font-display font-bold uppercase tracking-widest text-gold">
            <Gift size={13} aria-hidden="true" /> For Hilux owners
          </span>
          <h1 className="mt-6 font-display text-3xl font-light leading-tight sm:text-5xl">
            Thank you. Here&apos;s {rupees(HILUX_OFFER.amountOff)} off your next build.
          </h1>
          <p className="mt-4 text-ink-muted">
            On parts for the Toyota Hilux Revo and Travo, when those parts come to{' '}
            {rupees(HILUX_OFFER.minOrder)} or more. One use per customer.
          </p>
        </div>

        {/* The code itself, always visible. */}
        <div className="mt-10 rounded-lg border border-gold/40 bg-obsidian-raised p-6 text-center">
          <p className="text-xs uppercase tracking-widest text-ink-muted">Your code</p>
          <div className="mt-3 flex items-center justify-center gap-3">
            <span data-testid="hilux-code" className="font-mono text-2xl font-bold tracking-wider text-gold sm:text-3xl">
              {HILUX_OFFER.code}
            </span>
            <button
              type="button"
              onClick={copyCode}
              className="inline-flex items-center gap-1 rounded border border-hairline px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
              aria-label="Copy code"
            >
              {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-3 text-sm text-ink-muted">
            We&apos;ll add it to your cart for you. If it isn&apos;t there, type it in the coupon box.
          </p>
        </div>

        {isLoading ? (
          <div data-testid="hilux-loading" className="mt-8 flex justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-gold" aria-hidden="true" />
            <span className="sr-only">Checking your account…</span>
          </div>
        ) : isAuthenticated ? (
          <div data-testid="hilux-signed-in" className="mt-8">
            <p className="text-center text-ink-muted">
              {user?.name ? `You're signed in, ${user.name}. Pick your parts:` : "You're signed in. Pick your parts:"}
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {HILUX_OFFER.shopLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="inline-flex items-center justify-center gap-2 rounded bg-gold px-4 py-3 text-center font-display text-sm font-bold text-white hover:brightness-110"
                >
                  {l.label} <ArrowRight size={14} aria-hidden="true" />
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div data-testid="hilux-signed-out" className="mt-8 text-center">
            <p className="text-ink-muted">Sign in first, so the offer is saved to your account.</p>
            <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href={authHref('login')}
                className="rounded bg-gold px-6 py-3 font-display text-sm font-bold text-white hover:brightness-110"
              >
                Sign in
              </Link>
              <Link
                href={authHref('register')}
                className="rounded border border-gold px-6 py-3 font-display text-sm font-bold text-gold hover:bg-gold/10"
              >
                Create an account
              </Link>
            </div>
          </div>
        )}

        <p className="mt-10 text-center text-xs text-ink-muted">
          Valid on Toyota Hilux, Hilux Revo and Hilux Travo parts only. The minimum counts those
          parts alone. Cannot be combined with another coupon. One use per customer account.
        </p>
      </div>
    </main>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { X, PartyPopper } from 'lucide-react';
import { useCurrency } from '@/context/CurrencyContext';
import type { CheckoutQuote } from '@/hooks/useCheckoutQuote';

/**
 * The "congrats, here's what you saved" moment, shown once when a coupon lands.
 *
 * Every number arrives resolved from the server (`quote.savings`, `quote.discountLines`).
 * Nothing here adds anything up: money is server-confirmed before the UI commits to it,
 * and a browser-side total that disagreed with the amount actually charged is exactly
 * the sort of discrepancy a customer screenshots.
 *
 * ── Three ways this could be obnoxious, and what stops each ────────────────────
 *
 * 1. FIRING REPEATEDLY. useCheckoutQuote re-runs on every quantity change and every
 *    keystroke in the coupon box, and each response carries the same applied coupon. So
 *    this triggers on the TRANSITION into an applied code — tracked by the code itself,
 *    not by a boolean — and a cart edit that re-quotes the same coupon says nothing.
 *    A modal reappearing every time you changed a quantity would be a reason to leave.
 *
 * 2. BLOCKING CHECKOUT. Dismissible by Escape, backdrop, or the close control, and
 *    nothing is gated behind dismissing it — the cart underneath stays usable.
 *
 * 3. ANIMATING AT SOMEONE WHO ASKED IT NOT TO. All motion sits behind
 *    `prefers-reduced-motion`, which is a genuine accessibility need (vestibular
 *    disorders), not a styling preference.
 */

interface Props {
  quote: CheckoutQuote | null;
  /** Test seam — forces the no-motion rendering without a matchMedia stub. */
  reducedMotionOverride?: boolean;
}

export default function SavingsCelebration({ quote, reducedMotionOverride }: Props) {
  // The cart's own formatter, so a saving is written the same way as every other figure
  // on the page — a celebration that formatted money differently would read as a mock-up.
  const { formatPrice } = useCurrency();
  const [shown, setShown] = useState(false);
  /**
   * The applied code already celebrated; `null` means "none yet". A ref rather than
   * state because writing it must not itself cause a render, or the effect below would
   * re-run against the value it just wrote.
   */
  const celebrated = useRef<string | null>(null);
  const [frozen, setFrozen] = useState<CheckoutQuote | null>(null);

  const appliedCode = quote?.appliedCoupon?.code ?? null;
  const total = quote?.savings?.total ?? 0;

  useEffect(() => {
    // Nothing applied — reset, so removing and re-applying a code celebrates again.
    if (!appliedCode) { celebrated.current = null; return; }
    // Applied but worth nothing: say nothing rather than congratulate someone on ₹0.
    if (total <= 0) return;
    if (celebrated.current === appliedCode) return;
    celebrated.current = appliedCode;
    /*
      Freeze the quote at the moment of celebration. The panel reads this snapshot rather
      than the live quote, so a background re-quote — the debounce firing again, or the
      shopper nudging a quantity underneath — cannot rewrite figures mid-read.
    */
    setFrozen(quote);
    setShown(true);
  }, [appliedCode, total, quote]);

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShown(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown]);

  if (!shown || !frozen) return null;

  const reduced = reducedMotionOverride
    ?? (typeof window !== 'undefined'
      && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches));

  const { savings, discountLines } = frozen;
  const capped = (discountLines || []).filter((l) => l.onSaleCapped);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="savings-title"
    >
      {/* Plain <style>, not styled-jsx: styled-jsx hashes the keyframe name, which would
          silently stop the `animate-[celebrate…]` utility from ever matching it. */}
      <style>{`
        @keyframes abSavingsPop {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      <button
        type="button"
        aria-label="Dismiss"
        className="absolute inset-0 bg-black/70"
        onClick={() => setShown(false)}
      />

      <div
        className="relative w-full max-w-md rounded-xl border border-gold/30 bg-zinc-900 p-6 shadow-2xl"
        style={reduced ? undefined : { animation: 'abSavingsPop 320ms cubic-bezier(0.16,1,0.3,1)' }}
      >
        <button
          type="button"
          onClick={() => setShown(false)}
          aria-label="Close"
          className="absolute right-3 top-3 text-zinc-500 hover:text-white"
        >
          <X size={18} />
        </button>

        <div className="text-center">
          <PartyPopper size={30} className={`mx-auto mb-3 text-gold ${reduced ? '' : 'animate-bounce'}`} />
          <h2 id="savings-title" className="text-lg font-semibold text-white">
            Nice one — you&apos;re saving {formatPrice(savings.total)}
          </h2>
        </div>

        <dl className="mt-5 space-y-2 text-sm">
          {savings.catalog > 0 && (
            // Named separately so the coupon is never credited with a saving the
            // catalogue was already giving them.
            <div className="flex justify-between text-zinc-300">
              <dt>Already off list price</dt>
              <dd>{formatPrice(savings.catalog)}</dd>
            </div>
          )}
          {savings.coupon > 0 && (
            <div className="flex justify-between text-emerald-300">
              <dt>Coupon {frozen.appliedCoupon?.code}</dt>
              <dd>{formatPrice(savings.coupon)}</dd>
            </div>
          )}
          {savings.karma > 0 && (
            <div className="flex justify-between text-zinc-300">
              <dt>Karma points</dt>
              <dd>{formatPrice(savings.karma)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-zinc-800 pt-2 font-semibold text-white">
            <dt>Total saved</dt>
            <dd>{formatPrice(savings.total)}</dd>
          </div>
        </dl>

        {capped.length > 0 && (
          /* Said plainly rather than left to be inferred from a smaller-than-expected
             number. These items were already discounted, so the coupon adds a reduced
             rate on top — stating it is the difference between a good deal and a
             suspected short-change. */
          <p className="mt-4 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {capped.length === 1
              ? `${capped[0].name} is already on offer, so the coupon adds ${capped[0].percent}% on top rather than its full rate.`
              : `${capped.length} items in your cart are already on offer, so the coupon adds ${capped[0].percent}% on top of those rather than its full rate.`}
          </p>
        )}

        <button
          type="button"
          onClick={() => setShown(false)}
          className="mt-5 w-full rounded bg-gold py-2.5 text-sm font-medium text-black hover:bg-gold/90"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

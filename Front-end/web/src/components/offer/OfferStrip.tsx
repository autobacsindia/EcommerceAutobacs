'use client';

import { Gift } from 'lucide-react';
import { getOffer } from '@/lib/offers';

/**
 * The offer header on the sign-in and registration screens.
 *
 * A customer who scans the counter QR is sent to /login to activate a coupon. Landing
 * on a bare "Sign In" card loses the thread — it reads like the site asking for a
 * password for its own reasons, which is exactly when someone puts the phone down. The
 * strip carries the reason across the hop.
 *
 * Renders nothing at all for a missing or unknown `offer`, so it is inert on the ~all
 * of sign-ins that have nothing to do with a promotion.
 */
export default function OfferStrip({ offer }: { offer: string | null | undefined }) {
  const resolved = getOffer(offer);
  if (!resolved) return null;

  return (
    <div
      data-testid="offer-strip"
      className="mb-6 flex items-center gap-3 rounded-sm border border-gold/40 bg-gold-soft px-4 py-3"
    >
      <Gift className="w-5 h-5 shrink-0 text-gold" aria-hidden="true" />
      <p className="text-sm font-display text-ink">{resolved.stripText}</p>
    </div>
  );
}

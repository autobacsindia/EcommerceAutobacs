'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  applyFestivalOffer,
  isOfferLive,
  msUntilOfferBoundary,
  type FestivalOfferResult,
  type PublicFestivalOffer,
} from '@/lib/festival/festivalOffer';

interface OfferState { offer: PublicFestivalOffer | null; live: boolean }

const OfferContext = createContext<OfferState>({ offer: null, live: false });

/** setTimeout's ceiling (~24.8 days); longer waits just re-arm. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Holds the festival price-offer switch for the storefront (display only).
 *
 * `initialLive` comes from the server render so the first client render matches the
 * HTML. After mount it is re-checked on the visitor's clock and a timer flips it at the
 * start/end time, so a cached page stops showing the offer price exactly when the
 * checkout stops charging it.
 */
export function FestivalOfferProvider({
  offer,
  initialLive,
  children,
}: {
  offer: PublicFestivalOffer | null;
  initialLive: boolean;
  children: ReactNode;
}) {
  const [live, setLive] = useState(initialLive);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      setLive(isOfferLive(offer));
      const wait = msUntilOfferBoundary(offer);
      if (wait !== null) timer = setTimeout(tick, Math.min(wait + 50, MAX_TIMER_MS));
    };
    tick();
    return () => clearTimeout(timer);
  }, [offer]);

  return <OfferContext.Provider value={{ offer, live }}>{children}</OfferContext.Provider>;
}

/** The live offer, or null. */
export function useFestivalOffer(): PublicFestivalOffer | null {
  const { offer, live } = useContext(OfferContext);
  return live && offer ? offer : null;
}

/**
 * The Diwali offer for ONE unit at this selling price, or null (offer off). Display
 * only — cart/checkout show the server quote instead. The M.R.P. plays no part: the
 * offer stacks on top of whatever the product currently sells for.
 */
export function useFestivalOfferPrice(price: number | null | undefined): FestivalOfferResult | null {
  const offer = useFestivalOffer();
  if (!offer || typeof price !== 'number') return null;
  return applyFestivalOffer({ unitPrice: price }, offer.tiers, offer.code);
}

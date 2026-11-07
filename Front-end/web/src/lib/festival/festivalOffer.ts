import { serverFetch } from '@/lib/server-api';
import { API_ENDPOINTS } from '@/lib/constants';

/**
 * Festival (Diwali) tiered price offer — storefront DISPLAY mirror.
 *
 * ⚠️ Display only. The server is the pricing authority: cart and checkout totals, and
 * the Razorpay amount, come from POST /checkout/quote and order creation
 * (Back-end/server/utils/festivalOffer.js). This mirror exists so product cards and the
 * product page can show the offer price without a quote per tile. Both sides run the
 * same case table (Back-end/server/tests/fixtures/festivalOfferCases.json) so they
 * cannot drift, and the tier ladder itself arrives from the server — never hard-coded.
 */

export interface FestivalOfferTier { minPaise: number; percent: number }

/** GET /festival-offer/active. Null = off or ended. */
export interface PublicFestivalOffer {
  code: string;
  startsAt: string | null;
  endsAt: string | null;
  live: boolean;
  tiers: FestivalOfferTier[];
}

export interface FestivalOfferResult {
  code: string;
  percent: number;
  /** The price before Diwali — the current selling price the % was taken from. */
  basePrice: number;
  /** What one unit costs with the offer — whole rupees. */
  finalPrice: number;
  /** basePrice − finalPrice. */
  discount: number;
}

const REVALIDATE_SECONDS = 300;

const toPaise = (rupees: number) => Math.round((Number(rupees) || 0) * 100);
const fromPaise = (paise: number) => Math.round(Number(paise) || 0) / 100;

/** The % a base price (paise) earns: the LAST tier whose minPaise it reaches. */
export function tierPercentForPaise(basePaise: number, tiers: FestivalOfferTier[]): number {
  if (!Number.isFinite(basePaise) || basePaise <= 0) return 0;
  let percent = 0;
  for (const t of [...tiers].sort((a, b) => a.minPaise - b.minPaise)) {
    if (basePaise >= t.minPaise) percent = t.percent;
  }
  return percent;
}

/**
 * Mirror of the server's applyFestivalOffer: an EXTRA % on top of the current selling
 * price, tiered by that selling price, rounded down to whole rupees. The M.R.P. plays
 * no part. Monotonic in price (a higher price never yields a lower Diwali price), so
 * applying it to a variable product's cheapest price gives its true "From" price.
 */
export function applyFestivalOffer(
  { unitPrice }: { unitPrice: number },
  tiers: FestivalOfferTier[],
  code = 'diwali',
): FestivalOfferResult | null {
  const basePaise = toPaise(unitPrice);
  if (!Number.isFinite(basePaise) || basePaise <= 0) return null;

  const percent = tierPercentForPaise(basePaise, tiers);
  if (percent <= 0) return null;

  const rawPaise = Math.floor((basePaise * (100 - percent)) / 100);
  const finalPaise = Math.floor(rawPaise / 100) * 100;
  if (finalPaise <= 0 || finalPaise >= basePaise) return null;

  return {
    code,
    percent,
    basePrice: fromPaise(basePaise),
    finalPrice: fromPaise(finalPaise),
    discount: fromPaise(basePaise - finalPaise),
  };
}

/** Live at `now`? Start inclusive, end exclusive — the same rule as the backend. */
export function isOfferLive(offer: PublicFestivalOffer | null, now: number = Date.now()): boolean {
  if (!offer) return false;
  const start = offer.startsAt ? Date.parse(offer.startsAt) : NaN;
  const end = offer.endsAt ? Date.parse(offer.endsAt) : NaN;
  if (!Number.isNaN(start) && start > now) return false;
  if (!Number.isNaN(end) && end <= now) return false;
  return true;
}

/** Milliseconds until the offer next flips (start or end), or null if never. */
export function msUntilOfferBoundary(offer: PublicFestivalOffer | null, now: number = Date.now()): number | null {
  if (!offer) return null;
  const times = [offer.startsAt, offer.endsAt]
    .map((t) => (t ? Date.parse(t) : NaN))
    .filter((t) => !Number.isNaN(t) && t > now);
  return times.length ? Math.min(...times) - now : null;
}

/** Server-side read for the root layout. Never throws — degrades to "no offer". */
export async function getFestivalOffer(): Promise<PublicFestivalOffer | null> {
  try {
    const res = await serverFetch<{ success: boolean; offer: PublicFestivalOffer | null }>(
      API_ENDPOINTS.FESTIVAL_OFFER_ACTIVE,
      { next: { tags: ['promo:festival-offer'], revalidate: REVALIDATE_SECONDS } },
    );
    return res?.offer ?? null;
  } catch {
    return null;
  }
}

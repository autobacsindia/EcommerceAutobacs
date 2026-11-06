import type { StoreProduct } from './storeData';

/**
 * Budget bands for the festive "Gift for your car" section, in rupees.
 * A product priced exactly at a limit belongs to the band ABOVE it, so
 * "Under ₹5,000" never shows a ₹5,000 product.
 */
export const GIFT_BAND_LIMITS = [5000, 15000] as const;

export interface GiftTier {
  /** 0 = under the first limit, 1 = between, 2 = at or above the second. */
  band: 0 | 1 | 2;
  products: StoreProduct[];
}

/** Fewer than this many products and a band is left out rather than shown half-empty. */
const MIN_PER_TIER = 2;
/** Fewer than this many bands and the whole section is left out. */
const MIN_TIERS = 2;

export function giftBand(price: number): 0 | 1 | 2 {
  if (price < GIFT_BAND_LIMITS[0]) return 0;
  if (price < GIFT_BAND_LIMITS[1]) return 1;
  return 2;
}

/**
 * Sorts products from the home page's existing shelves into budget bands.
 *
 * Pure display grouping: it reads the catalogue's own `price` (already fetched
 * for the shelves) and never computes or changes one. Pools are taken in the
 * order given, so earlier pools (deals) win a place over later ones, and a
 * product that sits in two pools appears once.
 *
 * Returns [] when there is not enough to fill at least two bands — an empty or
 * one-band "gift guide" looks broken, so the section simply does not render.
 */
export function buildGiftTiers(pools: StoreProduct[][], perTier = 4): GiftTier[] {
  const seen = new Set<string>();
  const bands: StoreProduct[][] = [[], [], []];
  for (const pool of pools) {
    for (const p of pool) {
      if (seen.has(p.id)) continue;
      if (!(typeof p.price === 'number' && Number.isFinite(p.price) && p.price > 0)) continue;
      seen.add(p.id);
      const b = bands[giftBand(p.price)];
      if (b.length < perTier) b.push(p);
    }
  }
  const tiers = bands
    .map((products, band) => ({ band: band as 0 | 1 | 2, products }))
    .filter((t) => t.products.length >= MIN_PER_TIER);
  return tiers.length >= MIN_TIERS ? tiers : [];
}

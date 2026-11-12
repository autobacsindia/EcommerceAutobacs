import type { StoreProduct } from './storeData';

/**
 * How each home-page shelf orders the products it was given.
 *
 * Membership is decided upstream (a shelf of best sellers still holds only best
 * sellers, a deals shelf only real deals); this only decides the ORDER they are
 * shown in. Kept as a config map so a shelf can be switched back to its source
 * order (`'source'`) in one line, without touching the fetching code.
 *
 *   'premium' — buyable first, then dearest first. Ties keep the source order
 *               (sales rank, % off, newest…), so the result is deterministic.
 *   'source'  — keep the upstream ranking, but still sink unbuyable products.
 *
 * "Price" is the catalogue `price` the tile prints: for a multi-model product that
 * is the cheapest model (the backend keeps parent price = priceMin). It is the price
 * BEFORE the Diwali offer. The automatic offer ladder (10 / 5 / 3 / 2 %) gives a
 * SMALLER percentage to a dearer product, so it can never swap two products'
 * order; only a hand-set custom percentage could, and only between near-equal prices.
 */
export type ShelfOrder = 'premium' | 'source';

export const HOME_SHELF_ORDER = {
  deals: 'premium',
  bestSellers: 'premium',
  categoryRows: 'premium',
  newArrivals: 'premium',
  premiumPicks: 'premium',
} as const satisfies Record<string, ShelfOrder>;

export const PREMIUM_PICKS = {
  /** Tiles in the row. */
  size: 12,
  /** At most this many tiles from one brand, so the row is not five conversion kits of one maker. */
  perBrand: 2,
  /** Below this many tiles the row is not rendered (a half-empty shelf looks broken). */
  minSize: 4,
} as const;

/**
 * Purchasable = 'in' or 'low'. 'out' and 'backorder' go last on every shelf:
 * the same split as the backend's isPurchasable()/stockRank.
 */
export const isBuyable = (p: Pick<StoreProduct, 'stock'>) => p.stock !== 'out' && p.stock !== 'backorder';

/** Stable ordering for one shelf. Never mutates its input. */
export function orderShelf(products: StoreProduct[], order: ShelfOrder): StoreProduct[] {
  const indexed = products.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => {
    const buy = Number(isBuyable(b.p)) - Number(isBuyable(a.p));
    if (buy !== 0) return buy;
    if (order === 'premium') {
      const price = b.p.price - a.p.price;
      if (price !== 0) return price;
    }
    return a.i - b.i;
  });
  return spreadBrands(indexed.map((x) => x.p));
}

const brandKey = (p: StoreProduct) => p.brand.trim().toLowerCase();

/**
 * Avoid two neighbouring tiles from the same brand, where it can be done without
 * breaking the buyable/unbuyable split. Greedy: when the next tile repeats the
 * previous brand, pull forward the nearest later tile of another brand from the
 * same availability group. Products with no brand never count as a repeat.
 * At most a small, local reshuffle — the price order is otherwise kept.
 */
export function spreadBrands(products: StoreProduct[]): StoreProduct[] {
  const rest = [...products];
  const out: StoreProduct[] = [];
  while (rest.length) {
    const prev = out[out.length - 1];
    let pick = 0;
    if (prev && brandKey(prev) && brandKey(rest[0]) === brandKey(prev)) {
      const j = rest.findIndex((p) => brandKey(p) !== brandKey(prev) && isBuyable(p) === isBuyable(rest[0]));
      if (j > 0) pick = j;
    }
    out.push(rest.splice(pick, 1)[0]);
  }
  return out;
}

/**
 * The "Premium Picks" row: the admin's Featured products first, then the dearest
 * buyable products in the catalogue — at most `perBrand` per brand, no duplicates.
 * Featured products are ordered by the same rule (so a featured item on backorder
 * sits at the end, not at the front).
 */
export function buildPremiumPicks(
  featured: StoreProduct[],
  dearest: StoreProduct[],
  cfg: { size: number; perBrand: number; minSize: number } = PREMIUM_PICKS,
): StoreProduct[] {
  const seen = new Set<string>();
  const perBrand = new Map<string, number>();
  const take = (p: StoreProduct, capBrand: boolean) => {
    if (seen.has(p.id)) return false;
    const key = brandKey(p);
    if (capBrand && key && (perBrand.get(key) ?? 0) >= cfg.perBrand) return false;
    seen.add(p.id);
    if (key) perBrand.set(key, (perBrand.get(key) ?? 0) + 1);
    return true;
  };
  // Featured picks are the admin's explicit choice: never dropped by the brand cap.
  const picked = featured.filter((p) => take(p, false));
  for (const p of dearest) {
    if (picked.length >= cfg.size) break;
    if (isBuyable(p) && take(p, true)) picked.push(p);
  }
  // Brand spreading runs once more across the joined groups, so a featured kit and
  // a top-up of the same maker are not left side by side at the seam.
  const ordered = spreadBrands([
    ...orderShelf(picked.filter((p) => featured.includes(p) && isBuyable(p)), HOME_SHELF_ORDER.premiumPicks),
    ...orderShelf(picked.filter((p) => !featured.includes(p)), HOME_SHELF_ORDER.premiumPicks),
    ...orderShelf(picked.filter((p) => featured.includes(p) && !isBuyable(p)), HOME_SHELF_ORDER.premiumPicks),
  ]).slice(0, cfg.size);
  return ordered.length >= cfg.minSize ? ordered : [];
}

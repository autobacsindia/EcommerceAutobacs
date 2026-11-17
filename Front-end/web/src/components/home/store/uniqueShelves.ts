import type { StoreProduct } from './storeData';

/**
 * One product, one shelf.
 *
 * The home page's rows come from independent lists (offers, best sellers, the
 * dearest buyable products, each category's top sellers, the newest), and on a
 * catalogue of ~1,000 products those lists overlap heavily: on 2026-11-17 the
 * live "Best Sellers" and "Top in Exterior" shared 10 of 12 products. The page
 * then shows the same photos row after row.
 *
 * `claimShelves` walks the rows in the order they appear on the page and lets
 * each one keep only products no earlier row has shown, so a customer scrolling
 * down always meets something new. What a row may do when de-duplication leaves
 * it too short is the row's own call:
 *   - 'hide'   — skip the row (category rows: the next candidate takes its place);
 *   - 'repeat' — keep the original list (a main shelf is never left empty on a
 *                small catalogue; a repeat looks unlucky, a hole looks broken).
 *
 * Pure display selection: products, prices and order inside a row are untouched.
 */
export interface ShelfRequest {
  products: StoreProduct[];
  /** Fewer unique products than this and `whenShort` decides. */
  min: number;
  whenShort: 'hide' | 'repeat';
  /** Show at most this many (only the shown ones are claimed). */
  max?: number;
}

/**
 * `seen` is shared and updated, so a page can claim in stages (a section built
 * between two rows claims its own products too).
 */
export function claimShelves(rows: ShelfRequest[], seen: Set<string> = new Set()): StoreProduct[][] {
  return rows.map(({ products, min, whenShort, max = Infinity }) => {
    const fresh = products.filter((p) => !seen.has(p.id));
    const chosen = (fresh.length >= min ? fresh : whenShort === 'repeat' ? products : []).slice(0, max);
    for (const p of chosen) seen.add(p.id);
    return chosen;
  });
}

import { claimShelves } from './uniqueShelves';
import { buildShelves } from './StoreHome';
import type { StoreHomeData, StoreProduct } from './storeData';

const prod = (id: string, price = 1000, originalPrice?: number): StoreProduct => ({
  id, name: `P ${id}`, href: `/products/${id}`, image: `/${id}.jpg`, brand: `B${id}`, price, originalPrice, rating: 0, reviews: 0, stock: 'in',
});
const ids = (l: StoreProduct[]) => l.map((p) => p.id);
const range = (prefix: string, n: number, price = 1000) => Array.from({ length: n }, (_, i) => prod(`${prefix}${i}`, price));

describe('claimShelves', () => {
  it('each row keeps only products no earlier row showed', () => {
    const [a, b] = claimShelves([
      { products: range('x', 6), min: 4, whenShort: 'repeat' },
      { products: [...range('x', 3), ...range('y', 5)], min: 4, whenShort: 'repeat' },
    ]);
    expect(ids(a)).toEqual(['x0', 'x1', 'x2', 'x3', 'x4', 'x5']);
    expect(ids(b)).toEqual(['y0', 'y1', 'y2', 'y3', 'y4']);
  });

  it('too short after removing repeats: "hide" drops the row, "repeat" keeps the original', () => {
    const seen = new Set(['x0', 'x1', 'x2']);
    const [hidden, kept] = claimShelves([
      { products: range('x', 5), min: 4, whenShort: 'hide' },
      { products: range('x', 5), min: 4, whenShort: 'repeat' },
    ], seen);
    expect(hidden).toEqual([]);
    expect(ids(kept)).toHaveLength(5);
  });

  it('a capped row claims only what it shows, leaving its spares for later rows', () => {
    const seen = new Set<string>();
    const [a, b] = claimShelves([
      { products: range('x', 10), min: 1, whenShort: 'hide', max: 4 },
      { products: range('x', 10), min: 1, whenShort: 'hide' },
    ], seen);
    expect(ids(a)).toEqual(['x0', 'x1', 'x2', 'x3']);
    expect(ids(b)).toEqual(['x4', 'x5', 'x6', 'x7', 'x8', 'x9']);
  });
});

describe('buildShelves (the home page)', () => {
  // Heavily overlapping lists, like the live catalogue.
  const deals = range('d', 10, 2000).map((p) => ({ ...p, originalPrice: 4000 }));
  const best = [...deals.slice(4, 6), ...range('s', 10, 3000)];
  const cat = (slug: string, products: StoreProduct[]) => ({ category: { name: slug, slug, href: `/categories/${slug}`, image: '' }, products });
  const data: StoreHomeData = {
    categories: [],
    deals,
    dealsTotal: 10,
    productTotal: 500,
    bestSellers: best,
    newArrivals: [...range('s', 2), ...range('n', 8, 9000)],
    featured: [prod('f0', 90000), prod('f1', 80000)],
    premiumPicks: [prod('f0', 90000), prod('f1', 80000), ...range('e', 6, 70000)],
    dearest: [...range('e', 12, 70000)],
    categoryRows: [
      cat('exterior', best.slice(0, 10)), // nearly all already in Best Sellers → hidden
      cat('lighting', range('l', 20, 4000)),
      cat('audio', range('a', 8, 4000)),
      cat('interior', range('i', 8, 4000)),
    ],
    brands: [],
    reviews: [],
  };

  const all = (s: ReturnType<typeof buildShelves>) => [
    ...s.deals, ...s.premiumPicks, ...s.giftTiers.flatMap((t) => t.products), ...s.bestSellers,
    ...s.categoryRows.flatMap((r) => r.products), ...s.newArrivals,
  ];

  it('no product appears on two shelves, and nothing from the hero or the top deals box', () => {
    const s = buildShelves(data, true, ['/products/f0']);
    const shown = ids(all(s));
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown).not.toContain('f0'); // hero photo
    for (const id of ['d0', 'd1', 'd2', 'd3']) expect(shown).not.toContain(id); // "Top deals for you"
    expect(ids(s.deals)).toEqual(['d4', 'd5', 'd6', 'd7', 'd8', 'd9']);
  });

  it('Premium Picks refills from the dearest products instead of shrinking', () => {
    const s = buildShelves(data, true, ['/products/f0']);
    expect(s.premiumPicks.length).toBeGreaterThanOrEqual(8);
    expect(ids(s.premiumPicks)).toContain('f1');
  });

  it('a category row whose products are already shown gives way to the next one, at most 3 rows of 12', () => {
    const s = buildShelves(data, true);
    expect(s.categoryRows.map((r) => r.category.slug)).toEqual(['lighting', 'audio', 'interior']);
    expect(s.categoryRows[0].products).toHaveLength(12);
  });

  it('the gift section is always built, but only takes products off later shelves while the festival is live', () => {
    const live = buildShelves(data, true);
    const off = buildShelves(data, false);
    expect(live.giftTiers.length).toBeGreaterThan(0);
    expect(off.giftTiers.length).toBeGreaterThan(0);
    const gifts = new Set(ids(live.giftTiers.flatMap((t) => t.products)));
    expect(ids([...live.bestSellers, ...live.newArrivals]).some((id) => gifts.has(id))).toBe(false);
    expect(ids(off.newArrivals).some((id) => gifts.has(id))).toBe(true);
  });

  it('a tiny catalogue still fills the main shelves (repeats rather than holes)', () => {
    const tiny: StoreHomeData = { ...data, deals: deals.slice(0, 5), bestSellers: deals.slice(0, 5), newArrivals: deals.slice(0, 5), categoryRows: [] };
    const s = buildShelves(tiny, false);
    expect(s.bestSellers).toHaveLength(5);
    expect(s.newArrivals).toHaveLength(5);
  });
});

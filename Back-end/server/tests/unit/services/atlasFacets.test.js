/**
 * Disjunctive facet engine and data-derived price bucketing.
 *
 * Two defects motivated this. First, /products was served by Atlas while
 * /products/facets ran independent MongoDB aggregations — two engines with
 * different text and stock semantics answering one screen, so the sidebar counts
 * and the results grid could disagree about the same URL. Second, the price facet
 * was calibrated in the wrong currency: boundaries of <50/50-100/100-200/200-500/500+
 * against a catalogue priced ₹1,450-₹814,200, which put ALL 931 products in a
 * single bucket and left the other four empty.
 */

import { buildFilters, buildPriceHistogramBounds } from '../../../services/atlasSearchService.js';

describe('buildFilters — per-dimension exclusion makes facets disjunctive', () => {
  const params = { brand: 'Auxbeam', minPrice: 1000, maxPrice: 50000, rating: '4', inStock: 'true' };
  const paths = (f) => f.filter.map((c) => Object.values(c)[0].path);

  it('drops ONLY the excluded dimension, leaving the rest applied', () => {
    // The property that makes a facet answer "what would I get if I picked this
    // instead", rather than "how many of what you already picked".
    const all = paths(buildFilters(params));
    expect(all).toContain('brand');

    const noBrand = paths(buildFilters(params, {}, { excludeBrand: true }));
    expect(noBrand).not.toContain('brand');
    expect(noBrand).toContain('price');
    expect(noBrand).toContain('averageRating');
  });

  it('excludes price, rating, availability and category independently', () => {
    expect(paths(buildFilters(params, {}, { excludePrice: true }))).not.toContain('price');
    expect(paths(buildFilters(params, {}, { excludeRating: true }))).not.toContain('averageRating');
    expect(buildFilters(params, {}, { excludeAvailability: true }).mustNot).toEqual([]);

    const resolved = { categoryIds: ['aaaaaaaaaaaaaaaaaaaaaaaa'] };
    expect(paths(buildFilters(params, resolved))).toContain('categories');
    expect(paths(buildFilters(params, resolved, { excludeCategory: true }))).not.toContain('categories');
  });

  it('NEVER lifts the isActive filter, whatever is excluded', () => {
    // Excluding a facet dimension must not become a way to publish drafts.
    const every = { excludeBrand: true, excludeCategory: true, excludePrice: true,
                    excludeRating: true, excludeVehicle: true, excludeAvailability: true };
    expect(buildFilters(params, {}, every).filter)
      .toContainEqual({ equals: { path: 'isActive', value: true } });
  });

  it('keeps the vehicle match-nothing clause distinct from no vehicle filter', () => {
    // Excluding the dimension means "no vehicle filter", which must NOT collapse
    // into the impossible-match clause that an unmatched vehicle produces.
    const unmatched = buildFilters(params, { vehicleFilterIds: [] });
    expect(unmatched.mustNot).toContainEqual({ exists: { path: '_id' } });

    const excluded = buildFilters(params, { vehicleFilterIds: [] }, { excludeVehicle: true });
    expect(excluded.mustNot).not.toContainEqual({ exists: { path: '_id' } });
  });
});

describe('buildPriceHistogramBounds — derived from data, not hardcoded', () => {
  it('spans the real catalogue range instead of a hardcoded ceiling', () => {
    // The UI hardcoded a ₹100,000 maximum against a real max of ₹814,200, leaving
    // 176 products (19%) unfilterable by price.
    const bounds = buildPriceHistogramBounds(1450, 814200, 250000, 20);
    expect(bounds[0].from).toBe(1450);
    // The last bucket is open-ended, so the most expensive product is reachable.
    expect(bounds[bounds.length - 1].to).toBeNull();
  });

  it('bucket boundaries are contiguous and ascending', () => {
    const bounds = buildPriceHistogramBounds(1450, 814200, 250000, 20);
    for (let i = 1; i < bounds.length; i += 1) {
      expect(bounds[i].from).toBe(bounds[i - 1].to);
    }
  });

  it('cuts at p95 so a long tail cannot flatten the chart', () => {
    // Linear buckets over the full range would put ~95% of a right-skewed
    // catalogue in the first bar, which reads as a single spike and tells the
    // shopper nothing.
    const bounds = buildPriceHistogramBounds(0, 1000000, 100000, 10);
    const lastBounded = bounds[bounds.length - 2];
    expect(lastBounded.to).toBeLessThanOrEqual(100000);
    expect(bounds[bounds.length - 1]).toEqual({ from: 100000, to: null });
  });

  it('emits no overflow bucket when there is no tail', () => {
    const bounds = buildPriceHistogramBounds(0, 100, 100, 4);
    expect(bounds).toHaveLength(4);
    expect(bounds[3].to).toBe(100);
  });

  it('handles a single-price result set without producing inverted buckets', () => {
    expect(buildPriceHistogramBounds(5000, 5000, 5000, 20)).toEqual([{ from: 5000, to: null }]);
  });

  it('returns nothing for an empty result set rather than inventing a scale', () => {
    expect(buildPriceHistogramBounds(NaN, NaN, NaN, 20)).toEqual([]);
    expect(buildPriceHistogramBounds(undefined, undefined, undefined, 20)).toEqual([]);
  });

  it('falls back to the full range when p95 is unusable', () => {
    // A nonsensical percentile must not produce inverted or zero-width buckets.
    const bounds = buildPriceHistogramBounds(100, 1000, 5, 5);
    expect(bounds).toHaveLength(5);
    expect(bounds[0].from).toBe(100);
    expect(bounds[4].to).toBe(1000);
  });
});

/**
 * findSitemap paging must be total-ordered.
 *
 * The sitemap pages this repository with skip/limit. `updatedAt` alone is not
 * unique — bulk writes stamp large batches with an identical timestamp — so a
 * sort on it is not a total order and MongoDB may order tied documents
 * differently per query. A document then lands on page 2 in one call and page 3
 * in another: returned twice, while another is never returned at all.
 *
 * Measured on production before the fix: 931 rows across 4 pages carrying only
 * 885 distinct slugs. 46 live products were absent from the sitemap and nothing
 * reported it — every page returned HTTP 200 with a full payload.
 *
 * The spec assertion below is the load-bearing one. The behavioural test can
 * pass against a broken sort by luck on a small local collection, which is
 * precisely how this survived.
 */

import mongoose from 'mongoose';
import { jest } from '@jest/globals';
import Product from '../models/Product.js';
import productRepository from '../repositories/productRepository.js';
import * as dbHandler from './db-handler.js';

const productAt = (i, updatedAt) => ({
  name: `Sitemap Product ${i}`,
  slug: `sitemap-product-${i}`,
  description: 'Test product',
  price: 1000 + i,
  brand: 'Autobacs',
  isActive: true,
  updatedAt,
});

describe('productRepository.findSitemap', () => {
  beforeAll(async () => {
    await dbHandler.connect();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await dbHandler.clearDatabase();
  });

  afterAll(async () => {
    await dbHandler.closeDatabase();
  });

  it('sorts on a UNIQUE tiebreaker, not updatedAt alone', async () => {
    const chain = {};
    for (const method of ['select', 'sort', 'skip', 'limit', 'lean', 'maxTimeMS']) {
      chain[method] = jest.fn(() => chain);
    }
    chain.maxTimeMS = jest.fn(() => Promise.resolve([]));
    const findSpy = jest.spyOn(Product, 'find').mockReturnValue(chain);

    await productRepository.findSitemap({ limit: 10, skip: 0 });

    expect(findSpy).toHaveBeenCalled();
    const sortSpec = chain.sort.mock.calls[0][0];
    expect(Object.keys(sortSpec)).toContain('_id');
  });

  it('returns every product exactly once when paged, with updatedAt all tied', async () => {
    const tied = new Date('2026-08-01T00:00:00.000Z');
    const TOTAL = 30;
    const PAGE = 10;

    // timestamps:false so the identical updatedAt survives insertion — a
    // Mongoose-managed updatedAt would be stamped per-doc and hide the tie.
    await Product.insertMany(
      Array.from({ length: TOTAL }, (_, i) => productAt(i, tied)),
      { timestamps: false },
    );

    const seen = [];
    for (let skip = 0; skip < TOTAL; skip += PAGE) {
      const page = await productRepository.findSitemap({ limit: PAGE, skip });
      seen.push(...page.map((p) => p.slug));
    }

    expect(seen).toHaveLength(TOTAL);
    expect(new Set(seen).size).toBe(TOTAL);
  });

  it('agrees with countSitemap on how many products there are', async () => {
    await Product.insertMany([
      productAt(1, new Date()),
      { ...productAt(2, new Date()), isActive: false },
      { ...productAt(3, new Date()), seo: { noindex: true } },
    ]);

    const total = await productRepository.countSitemap();
    const rows = await productRepository.findSitemap({ limit: 100, skip: 0 });

    expect(rows).toHaveLength(total);
    expect(rows.map((r) => r.slug)).toEqual(['sitemap-product-1']);
  });

  it('never pages past the end', async () => {
    await Product.create(productAt(1, new Date()));
    const page = await productRepository.findSitemap({ limit: 250, skip: 250 });
    expect(page).toEqual([]);
  });
});

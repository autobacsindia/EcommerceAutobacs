/**
 * productRepository.findOnOffer — pagination regression test.
 *
 * THE BUG THIS GUARDS
 * --------------------
 * `findOnOffer` used to take a bare `limit` and always return page 1 — the
 * `/offers` page had no way to see anything past the first N products. Adding
 * `{ page, limit }` means the same eligibility filter now has to be combined
 * correctly with skip/limit/count: page 2 must not repeat page 1's products,
 * the total must reflect ALL eligible products (not just the page returned),
 * and the offer-window / isActive filtering must survive the pagination change
 * unchanged. Only a real query against real documents catches a skip/limit
 * mistake — a mocked repository (as the service/controller unit tests use)
 * can't.
 */

import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import Product from '../models/Product.js';
import productRepository from '../repositories/productRepository.js';

async function seedProduct(overrides = {}) {
  const n = Math.random().toString(36).slice(2, 8);
  return Product.create({
    name: `Product ${n}`,
    description: 'A product',
    price: 1000,
    slug: `product-${n}`,
    isActive: true,
    ...overrides,
  });
}

beforeAll(async () => {
  await dbHandler.connect();
});

describe('productRepository.findOnOffer', () => {
  it('excludes products with no offer signal and no discount', async () => {
    await seedProduct({ price: 1000 }); // not on offer, not discounted
    const discounted = await seedProduct({ price: 800, originalPrice: 1000 });

    const { products, total } = await productRepository.findOnOffer({ page: 1, limit: 24 });

    expect(total).toBe(1);
    expect(products.map((p) => String(p._id))).toEqual([String(discounted._id)]);
  });

  it('excludes an isOfferFeatured product outside its offer window', async () => {
    const now = new Date();
    const future = new Date(now.getTime() + 86_400_000);
    const past = new Date(now.getTime() - 86_400_000);

    await seedProduct({ isOfferFeatured: true, offerStartDate: future }); // not started yet
    await seedProduct({ isOfferFeatured: true, offerEndDate: past });     // already ended
    const live = await seedProduct({ isOfferFeatured: true, offerStartDate: past, offerEndDate: future });

    const { products, total } = await productRepository.findOnOffer({ page: 1, limit: 24 });

    expect(total).toBe(1);
    expect(products.map((p) => String(p._id))).toEqual([String(live._id)]);
  });

  it('excludes inactive products even when they carry a discount', async () => {
    await seedProduct({ price: 500, originalPrice: 1000, isActive: false });

    const { products, total } = await productRepository.findOnOffer({ page: 1, limit: 24 });

    expect(total).toBe(0);
    expect(products).toEqual([]);
  });

  it('paginates without gaps or repeats and reports the TOTAL across all pages, not just the page size', async () => {
    // Seed 5 eligible products with distinct, ordered createdAt so page order is
    // deterministic (sort is createdAt desc).
    const seeded = [];
    for (let i = 0; i < 5; i++) {
      const p = await seedProduct({ price: 500, originalPrice: 1000 });
      await Product.updateOne({ _id: p._id }, { createdAt: new Date(Date.now() + i * 1000) });
      seeded.push(p);
    }
    const expectedOrder = [...seeded].reverse().map((p) => String(p._id)); // newest first

    const page1 = await productRepository.findOnOffer({ page: 1, limit: 2 });
    const page2 = await productRepository.findOnOffer({ page: 2, limit: 2 });
    const page3 = await productRepository.findOnOffer({ page: 3, limit: 2 });

    expect(page1.total).toBe(5);
    expect(page2.total).toBe(5); // total is the same regardless of which page is asked for
    expect(page3.total).toBe(5);

    const page1Ids = page1.products.map((p) => String(p._id));
    const page2Ids = page2.products.map((p) => String(p._id));
    const page3Ids = page3.products.map((p) => String(p._id));

    expect(page1Ids).toEqual(expectedOrder.slice(0, 2));
    expect(page2Ids).toEqual(expectedOrder.slice(2, 4));
    expect(page3Ids).toEqual(expectedOrder.slice(4, 5));

    // No product appears on more than one page.
    const allIds = [...page1Ids, ...page2Ids, ...page3Ids];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('defaults to page 1 / limit 24 when called with no arguments', async () => {
    await seedProduct({ price: 500, originalPrice: 1000 });

    const { products, total } = await productRepository.findOnOffer();

    expect(total).toBe(1);
    expect(products).toHaveLength(1);
  });
});

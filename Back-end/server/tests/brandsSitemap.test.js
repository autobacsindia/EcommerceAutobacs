/**
 * GET /brands/sitemap — the source the frontend sitemap reads for brand URLs.
 *
 * Brand pages were never in the sitemap at all. The subtlety when adding them
 * is that /brands/:slug answers 200 for ANY brand document regardless of how
 * many products it carries (see getBrandDetails), so "does it 404?" is not a
 * usable filter — on production 80 brands are active but only 36 have a single
 * product, and submitting the other 44 asks Google to crawl empty pages.
 *
 * `Product.brand` is a denormalised NAME string, not a ref, so the join is by
 * name. A test that only ever uses matching names would pass against a broken
 * join, hence the mismatched-name case below.
 */

import request from 'supertest';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import Brand from '../models/Brand.js';
import Product from '../models/Product.js';
import * as dbHandler from './db-handler.js';

const BASE = '/api/v1';

/** Minimal valid product carrying a brand display name. */
const productFor = (brandName, overrides = {}) => ({
  name: `${brandName} Light Bar`,
  slug: `${brandName.toLowerCase().replace(/\s+/g, '-')}-light-bar`,
  description: 'Test product',
  price: 4999,
  brand: brandName,
  isActive: true,
  ...overrides,
});

const slugsFrom = (res) => res.body.brands.map((b) => b.slug);

describe('GET /brands/sitemap', () => {
  beforeAll(async () => {
    await dbHandler.connect();
  });

  afterEach(async () => {
    await dbHandler.clearDatabase();
  });

  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  it('returns an active brand that has an active product', async () => {
    await Brand.create({ name: 'Auxbeam', slug: 'auxbeam', isActive: true });
    await Product.create(productFor('Auxbeam'));

    const res = await request(app).get(`${BASE}/brands/sitemap`);

    expect(res.status).toBe(200);
    expect(slugsFrom(res)).toEqual(['auxbeam']);
    expect(res.body.brands[0]).toHaveProperty('updatedAt');
  });

  it('omits a brand with no products — the page would be thin content', async () => {
    await Brand.create({ name: 'Auxbeam', slug: 'auxbeam', isActive: true });
    await Brand.create({ name: 'Empty Brand', slug: 'empty-brand', isActive: true });
    await Product.create(productFor('Auxbeam'));

    const res = await request(app).get(`${BASE}/brands/sitemap`);

    expect(slugsFrom(res)).toEqual(['auxbeam']);
  });

  it('omits a brand whose only product is inactive', async () => {
    await Brand.create({ name: 'Auxbeam', slug: 'auxbeam', isActive: true });
    await Product.create(productFor('Auxbeam', { isActive: false }));

    const res = await request(app).get(`${BASE}/brands/sitemap`);

    expect(slugsFrom(res)).toEqual([]);
  });

  it('omits an inactive brand even when it has products', async () => {
    await Brand.create({ name: 'Auxbeam', slug: 'auxbeam', isActive: false });
    await Product.create(productFor('Auxbeam'));

    const res = await request(app).get(`${BASE}/brands/sitemap`);

    expect(slugsFrom(res)).toEqual([]);
  });

  it('honours seo.noindex, matching products and categories', async () => {
    await Brand.create({
      name: 'Auxbeam',
      slug: 'auxbeam',
      isActive: true,
      seo: { noindex: true },
    });
    await Product.create(productFor('Auxbeam'));

    const res = await request(app).get(`${BASE}/brands/sitemap`);

    expect(slugsFrom(res)).toEqual([]);
  });

  it('joins on the brand NAME, not the slug', async () => {
    // Display name and slug differ — a join written against the wrong field
    // returns [] here while passing every test above.
    await Brand.create({ name: 'Iron Man 4x4', slug: 'iron-man-4x4', isActive: true });
    await Product.create(productFor('Iron Man 4x4'));

    const res = await request(app).get(`${BASE}/brands/sitemap`);

    expect(slugsFrom(res)).toEqual(['iron-man-4x4']);
  });

  it('is not captured by the dynamic /:id route', async () => {
    const res = await request(app).get(`${BASE}/brands/sitemap`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('brands');
    expect(res.body).not.toHaveProperty('message');
  });

  it('projects only slug and updatedAt', async () => {
    await Brand.create({ name: 'Auxbeam', slug: 'auxbeam', isActive: true });
    await Product.create(productFor('Auxbeam'));

    const res = await request(app).get(`${BASE}/brands/sitemap`);

    expect(Object.keys(res.body.brands[0]).sort()).toEqual(['slug', 'updatedAt']);
  });

  it('is edge-cacheable for an hour', async () => {
    const res = await request(app).get(`${BASE}/brands/sitemap`);

    expect(res.headers['cache-control']).toContain('max-age=3600');
  });
});

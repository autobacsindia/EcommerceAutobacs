/**
 * GET /categories/sitemap — only categories a shopper would find products in.
 *
 * /categories/:slug answers 200 for an empty category, so the sitemap used to
 * submit ~51 "no products" pages (e.g. fog-lamp). A hub with no direct products
 * but products in a subcategory is NOT empty (its page lists the subtree), so
 * the rule is "active product anywhere in the subtree", not "direct product".
 */
import request from 'supertest';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import Category from '../models/Category.js';
import Product from '../models/Product.js';
import * as dbHandler from './db-handler.js';
import { categoryProductCounts } from '../utils/categoryTree.js';

const BASE = '/api/v1';
let n = 0;
const product = (categories, overrides = {}) => {
  n += 1;
  return Product.create({
    name: `Part ${n}`, slug: `part-${n}`, description: 'Test', price: 999,
    isActive: true, categories, ...overrides,
  });
};
const slugs = (res) => res.body.categories.map((c) => c.slug).sort();

describe('GET /categories/sitemap', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterEach(async () => { await dbHandler.clearDatabase(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  it('lists categories with products (direct or via a subcategory), drops empty and inactive ones', async () => {
    const hub = await Category.create({ name: 'Lighting', slug: 'lighting', isActive: true });
    const child = await Category.create({ name: 'Light Bars', slug: 'light-bars', isActive: true, parent: hub._id });
    await Category.create({ name: 'Fog Lamp', slug: 'fog-lamp', isActive: true, parent: hub._id }); // empty
    const onlyDraft = await Category.create({ name: 'Winches', slug: 'winches', isActive: true });
    const hidden = await Category.create({ name: 'Old', slug: 'old', isActive: false });

    await product([child._id]);
    await product([onlyDraft._id], { isActive: false }); // a draft does not make a page worth indexing
    await product([hidden._id]);

    const res = await request(app).get(`${BASE}/categories/sitemap`);
    expect(res.status).toBe(200);
    expect(slugs(res)).toEqual(['light-bars', 'lighting']);
    expect(res.body.categories[0]).toHaveProperty('updatedAt');
  });

  it('returns an empty list, not an error, when nothing has products', async () => {
    await Category.create({ name: 'Empty', slug: 'empty', isActive: true });
    const res = await request(app).get(`${BASE}/categories/sitemap`);
    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual([]);
  });
});

describe('categoryProductCounts', () => {
  it('unions (not sums) a product tagged on both a hub and its child, and survives a cycle', () => {
    const cats = [{ _id: 'a' }, { _id: 'b', parent: 'a' }, { _id: 'x', parent: 'y' }, { _id: 'y', parent: { _id: 'x' } }];
    const grouped = [{ _id: 'a', ids: ['p1'] }, { _id: 'b', ids: ['p1', 'p2'] }, { _id: 'x', ids: ['p3'] }];
    const c = categoryProductCounts(cats, grouped);
    expect(c.direct('a')).toBe(1);
    expect(c.total('a')).toBe(2);
    expect(c.total('b')).toBe(2);
    expect(c.total('x')).toBe(1);
    expect(c.total('missing')).toBe(0);
  });
});

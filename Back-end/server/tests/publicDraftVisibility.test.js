/**
 * Unpublished products must not be reachable from any PUBLIC product route.
 *
 * Two real holes, both found 2026-09-16 and both verified against production:
 *
 *  1. `?includeInactive=true` on GET /products lifted the visibility filter.
 *     `buildFilters` read the flag out of `params`, and `params` IS `req.query` on
 *     the public path, so a visitor could publish every draft by guessing a
 *     parameter name: /products?limit=1 returned 929, with the flag 950.
 *
 *  2. GET /products/:id looked the product up by id with no visibility check. A
 *     draft WITH a slug 301-redirected, disclosing the slug (and so the product
 *     name); a draft WITHOUT one fell through to an unfiltered findById that
 *     returned the entire document from an unauthenticated route.
 *
 * These run against the real Express app so the whole middleware stack is in play.
 */

import * as dbHandler from './db-handler.js';

// Named export — app.js does `export { app, ... }`, so a default import is
// undefined and every supertest call dies in serverAddress.
const { default: request } = await import('supertest');
const { app } = await import('../app.js');
const { default: Product } = await import('../models/Product.js');

const base = {
  description: 'x'.repeat(30),
  price: 1000,
  stock: 'in',
  sku: 'SKU-DRAFT-1',
};

let draftId;
let draftNoSlugId;
let liveId;

beforeAll(async () => {
  await dbHandler.connect();
});

// Per-TEST, not per-suite. tests/setup.js installs a global afterEach that wipes
// every collection, so fixtures built in beforeAll survive only the first test —
// and the draft assertions here are all "must 404", which pass perfectly against an
// empty database. The live-product cases below are the positive control that
// exposed exactly that: without them this suite would have reported green while
// testing nothing at all.
beforeEach(async () => {
  const live = await Product.create({
    ...base, name: 'Live Product', slug: 'live-product', sku: 'SKU-LIVE', isActive: true,
  });
  const draft = await Product.create({
    ...base, name: 'Secret Unreleased Product', slug: 'secret-unreleased-product', isActive: false,
  });
  liveId = live._id.toString();
  draftId = draft._id.toString();

  // A slug-less draft cannot be created through the schema (slug is required), so it
  // is inserted raw — which is how a bad import would produce one, and the shape
  // that made the /:id fallthrough return a whole unpublished document.
  const raw = await Product.collection.insertOne({
    name: 'Slugless Draft', description: base.description, price: 1000,
    stock: 'in', sku: 'SKU-NOSLUG', isActive: false, categories: [], images: [],
  });
  draftNoSlugId = raw.insertedId.toString();
});

afterAll(async () => {
  await dbHandler.closeDatabase();
});

describe('GET /products — the visibility filter cannot be lifted from the query', () => {
  it('ignores ?includeInactive=true', async () => {
    const [plain, withFlag] = await Promise.all([
      request(app).get('/api/v1/products?limit=50'),
      request(app).get('/api/v1/products?limit=50&includeInactive=true'),
    ]);

    expect(withFlag.status).toBe(200);
    expect(withFlag.body.total).toBe(plain.body.total);

    const names = (withFlag.body.products || []).map((p) => p.name);
    expect(names).not.toContain('Secret Unreleased Product');
    expect(names).not.toContain('Slugless Draft');
  });

  it('ignores ?status=inactive too', async () => {
    const res = await request(app).get('/api/v1/products?limit=50&status=inactive');
    const names = (res.body.products || []).map((p) => p.name);
    expect(names).not.toContain('Secret Unreleased Product');
  });
});

describe('GET /products/:id — a draft is not reachable by id', () => {
  it('404s a draft instead of redirecting and disclosing its slug', async () => {
    const res = await request(app).get(`/api/v1/products/${draftId}`).redirects(0);
    expect(res.status).toBe(404);
    // The slug must not appear anywhere in the response, including a Location header.
    expect(res.headers.location).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('secret-unreleased-product');
  });

  it('404s a SLUG-LESS draft rather than serving the whole document', async () => {
    const res = await request(app).get(`/api/v1/products/${draftNoSlugId}`).redirects(0);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Slugless Draft');
  });

  it('still redirects a LIVE product to its canonical slug URL', async () => {
    // The guard must not break the SEO redirect it is wrapped around.
    const res = await request(app).get(`/api/v1/products/${liveId}`).redirects(0);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/api/v1/products/slug/live-product');
  });
});

describe('GET /products/slug/:slug — unchanged, and still correct', () => {
  it('404s a draft slug', async () => {
    const res = await request(app).get('/api/v1/products/slug/secret-unreleased-product');
    expect(res.status).toBe(404);
  });

  it('serves a live product', async () => {
    const res = await request(app).get('/api/v1/products/slug/live-product');
    expect(res.status).toBe(200);
    expect(res.body.product?.name).toBe('Live Product');
  });
});

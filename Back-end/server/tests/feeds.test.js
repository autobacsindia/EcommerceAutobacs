import request from 'supertest';
import { app } from '../app.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import * as dbHandler from './db-handler.js';
import { _resetFeedCache } from '../routes/feeds.js';

const BASE = '/api/v1/feeds';

// Both feeds are served from ONE in-process cache map keyed by filename. The
// failure this suite exists to prevent is a shared cache slot handing Google the
// Meta document (or vice versa) — silent, and only visible as a rejected feed
// inside someone else's dashboard days later.
describe('Marketing feeds', () => {
  beforeAll(async () => {
    await dbHandler.connect();
  });

  // The global setup wipes every collection after EACH test, so fixtures are
  // seeded per-test rather than once for the suite.
  beforeEach(async () => {
    _resetFeedCache();

    const category = await Category.create({ name: 'Roof Racks', slug: 'roof-racks' });

    await Product.create({
      name: 'Roof Rack',
      slug: 'roof-rack',
      description: 'A sturdy roof rack.',
      shortDescription: 'A sturdy roof rack.',
      price: 4999,
      sku: 'RR-100',
      wpId: 11466,
      stock: 'in',
      isActive: true,
      categories: [category._id],
      images: [{ url: 'https://cdn.example/rack.jpg', isPrimary: true }],
    });

    // Invalid for Google (no price) — must appear in NEITHER feed as a sellable
    // ₹0 offer. Google would serve it as a real ad at that price.
    await Product.create({
      name: 'Free Sample',
      slug: 'free-sample',
      description: 'Zero priced.',
      price: 0,
      stock: 'in',
      isActive: true,
      images: [{ url: 'https://cdn.example/sample.jpg', isPrimary: true }],
    });
  });

  afterAll(async () => {
    await dbHandler.closeDatabase();
  });

  test('Google feed serves its own document with Google availability values', async () => {
    const res = await request(app).get(`${BASE}/google-merchant.xml`).expect(200);

    expect(res.headers['content-type']).toMatch(/application\/xml/);
    expect(res.text).toContain('Google Merchant Center');
    expect(res.text).toContain('<g:id>11466</g:id>');
    expect(res.text).toContain('<g:availability>in_stock</g:availability>');
    expect(res.text).toContain('<g:mpn>RR-100</g:mpn>');
    expect(res.text).toContain('<g:product_type>Roof Racks</g:product_type>');
    expect(res.text).toContain('<g:google_product_category>');
  });

  test('Meta feed is unchanged and does NOT get the Google document', async () => {
    const res = await request(app).get(`${BASE}/meta-catalog.xml`).expect(200);

    expect(res.text).toContain('Meta Commerce');
    expect(res.text).not.toContain('Google Merchant Center');
    // Meta's vocabulary, not Google's underscored one.
    expect(res.text).toContain('<g:availability>in stock</g:availability>');
    expect(res.text).not.toContain('google_product_category');
  });

  test('the two feeds do not share a cache slot', async () => {
    const google = await request(app).get(`${BASE}/google-merchant.xml`).expect(200);
    const meta = await request(app).get(`${BASE}/meta-catalog.xml`).expect(200);

    expect(google.text).not.toBe(meta.text);
    expect(google.text).toContain('Google Merchant Center');
    expect(meta.text).toContain('Meta Commerce');
  });

  test('a zero-priced product never reaches the Google feed', async () => {
    const res = await request(app).get(`${BASE}/google-merchant.xml`).expect(200);

    expect(res.text).not.toContain('free-sample');
    expect(res.text).not.toContain('0.00 INR');
  });
});

/**
 * GET /vehicles/sitemap — the source for /model/[slug] URLs.
 *
 * /model/:slug 404s only when the Vehicle document is missing, so a vehicle
 * with no compatible products still renders a listing page titled after it.
 * Submitting those means asking Google to crawl empty pages, hence the
 * has-products filter — the same call made for brands.
 *
 * `compatibleVehicles` is a genuine ObjectId ref array (unlike Product.brand,
 * a denormalised name string), so this joins on ids.
 */

import request from 'supertest';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import Vehicle from '../models/Vehicle.js';
import Product from '../models/Product.js';
import * as dbHandler from './db-handler.js';

const BASE = '/api/v1';

const vehicleFor = (make, model, overrides = {}) => ({
  make,
  model,
  slug: `${make}-${model}`.toLowerCase().replace(/\s+/g, '-'),
  isActive: true,
  ...overrides,
});

const productFor = (name, vehicleIds, overrides = {}) => ({
  name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  description: 'Test product',
  price: 4999,
  brand: 'Autobacs',
  isActive: true,
  compatibleVehicles: vehicleIds,
  ...overrides,
});

const slugsFrom = (res) => res.body.vehicles.map((v) => v.slug);

describe('GET /vehicles/sitemap', () => {
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

  it('returns an active vehicle that has a compatible active product', async () => {
    const thar = await Vehicle.create(vehicleFor('Mahindra', 'Thar'));
    await Product.create(productFor('Thar Bull Bar', [thar._id]));

    const res = await request(app).get(`${BASE}/vehicles/sitemap`);

    expect(res.status).toBe(200);
    expect(slugsFrom(res)).toEqual(['mahindra-thar']);
    expect(res.body.vehicles[0]).toHaveProperty('updatedAt');
  });

  it('omits a vehicle with no compatible products', async () => {
    const thar = await Vehicle.create(vehicleFor('Mahindra', 'Thar'));
    await Vehicle.create(vehicleFor('Audi', 'Q7'));
    await Product.create(productFor('Thar Bull Bar', [thar._id]));

    const res = await request(app).get(`${BASE}/vehicles/sitemap`);

    expect(slugsFrom(res)).toEqual(['mahindra-thar']);
  });

  it('omits a vehicle whose only compatible product is inactive', async () => {
    const thar = await Vehicle.create(vehicleFor('Mahindra', 'Thar'));
    await Product.create(productFor('Thar Bull Bar', [thar._id], { isActive: false }));

    const res = await request(app).get(`${BASE}/vehicles/sitemap`);

    expect(slugsFrom(res)).toEqual([]);
  });

  it('omits an inactive vehicle even when products map to it', async () => {
    const thar = await Vehicle.create(vehicleFor('Mahindra', 'Thar', { isActive: false }));
    await Product.create(productFor('Thar Bull Bar', [thar._id]));

    const res = await request(app).get(`${BASE}/vehicles/sitemap`);

    expect(slugsFrom(res)).toEqual([]);
  });

  it('returns each vehicle once when a product maps to several', async () => {
    const thar = await Vehicle.create(vehicleFor('Mahindra', 'Thar'));
    const scorpio = await Vehicle.create(vehicleFor('Mahindra', 'Scorpio'));
    await Product.create(productFor('Universal Roof Rack', [thar._id, scorpio._id]));
    await Product.create(productFor('Second Rack', [thar._id]));

    const res = await request(app).get(`${BASE}/vehicles/sitemap`);

    const slugs = slugsFrom(res);
    expect(slugs.sort()).toEqual(['mahindra-scorpio', 'mahindra-thar']);
    expect(slugs.length).toBe(new Set(slugs).size);
  });

  it('is not captured by the dynamic /:id route', async () => {
    const res = await request(app).get(`${BASE}/vehicles/sitemap`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('vehicles');
  });

  it('projects only slug and updatedAt', async () => {
    const thar = await Vehicle.create(vehicleFor('Mahindra', 'Thar'));
    await Product.create(productFor('Thar Bull Bar', [thar._id]));

    const res = await request(app).get(`${BASE}/vehicles/sitemap`);

    expect(Object.keys(res.body.vehicles[0]).sort()).toEqual(['slug', 'updatedAt']);
  });

  it('returns an empty list rather than erroring when there are no vehicles', async () => {
    const res = await request(app).get(`${BASE}/vehicles/sitemap`);

    expect(res.status).toBe(200);
    expect(res.body.vehicles).toEqual([]);
  });

  it('is edge-cacheable for an hour', async () => {
    const res = await request(app).get(`${BASE}/vehicles/sitemap`);

    expect(res.headers['cache-control']).toContain('max-age=3600');
  });
});

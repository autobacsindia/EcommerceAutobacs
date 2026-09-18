/**
 * GET /vehicles/admin/list — the vehicle source for the product fitment picker.
 *
 * It exists to be UNCACHED. The picker used to read the public GET /vehicles,
 * which is served `public, max-age=...`; browsers key their HTTP cache on the
 * URL and not on cookies, so an admin's authenticated fetch was answered from
 * their own disk with whatever the storefront had put there, and a
 * just-created vehicle did not appear for up to half an hour.
 *
 * httpCache skips any URL containing `/admin`, which is why the path shape
 * matters — these tests pin the no-store behaviour so a future "let's cache the
 * admin list too" change fails loudly instead of silently reintroducing the lag.
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import Vehicle from '../models/Vehicle.js';
import * as dbHandler from './db-handler.js';

const BASE = '/api/v1';

const adminUser = {
  name: 'Picker Admin',
  email: 'pickeradmin@example.com',
  password: 'SecurePass123!',
};

const vehicleFor = (make, model, overrides = {}) => ({
  make,
  model,
  slug: `${make}-${model}`.toLowerCase().replace(/\s+/g, '-'),
  isActive: true,
  ...overrides,
});

describe('GET /vehicles/admin/list', () => {
  let adminToken;

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

  beforeEach(async () => {
    const passwordHash = await bcrypt.hash(adminUser.password, await bcrypt.genSalt(10));
    await User.create({
      name: adminUser.name,
      email: adminUser.email,
      passwordHash,
      role: 'admin',
    });

    const loginRes = await request(app)
      .post(`${BASE}/auth/login`)
      .send({ email: adminUser.email, password: adminUser.password });
    const accessCookie = (loginRes.headers['set-cookie'] || []).find((c) =>
      c.startsWith('accessToken=')
    );
    adminToken = accessCookie
      ? accessCookie.split(';')[0].slice('accessToken='.length)
      : loginRes.body.accessToken;
  });

  const list = () =>
    request(app)
      .get(`${BASE}/vehicles/admin/list`)
      .set('Authorization', `Bearer ${adminToken}`);

  it('requires an authenticated admin', async () => {
    const res = await request(app).get(`${BASE}/vehicles/admin/list`);
    expect([401, 403]).toContain(res.status);
  });

  it('sends an EXPLICIT no-store, not merely an absent Cache-Control', async () => {
    await Vehicle.create(vehicleFor('Mahindra', 'Thar'));

    const res = await list().expect(200);

    // A response with no Cache-Control at all is heuristically cacheable, which
    // is the same ambiguity that let the admin's browser pin a stale fitment
    // list in the first place. The directive has to be stated.
    const cacheControl = res.headers['cache-control'] || '';
    expect(cacheControl).toMatch(/no-store/);
    expect(cacheControl).toMatch(/private/);
    expect(cacheControl).not.toMatch(/public/);
    expect(cacheControl).not.toMatch(/max-age=[1-9]/);
  });

  it('orders active vehicles ahead of deactivated ones so the row cap can only cost hidden rows', async () => {
    await Vehicle.create(vehicleFor('AAA', 'Retired', { isActive: false }));
    await Vehicle.create(vehicleFor('ZZZ', 'Current'));

    const res = await list().expect(200);

    // Alphabetically the inactive one sorts first; the cap is a hard cut, so an
    // active (selectable) vehicle must never be the row that gets dropped.
    expect(res.body.vehicles.map((v) => v.model)).toEqual(['Current', 'Retired']);
  });

  it('reflects a newly created vehicle on the very next call', async () => {
    await Vehicle.create(vehicleFor('Mahindra', 'Thar'));
    const first = await list().expect(200);
    expect(first.body.vehicles.map((v) => v.model)).toEqual(['Thar']);

    await Vehicle.create(vehicleFor('Maruti', 'Jimny'));
    const second = await list().expect(200);

    // No TTL to wait out: the second read must already see the new row.
    expect(second.body.vehicles.map((v) => v.model).sort()).toEqual(['Jimny', 'Thar']);
  });

  it('includes inactive vehicles with their flag, so an existing fitment stays visible', async () => {
    await Vehicle.create(vehicleFor('Mahindra', 'Thar', { isActive: false }));

    const res = await list().expect(200);

    // The public /vehicles filters these out, which is what made a deactivated
    // vehicle vanish from the editor while still attached to the product.
    expect(res.body.vehicles).toHaveLength(1);
    expect(res.body.vehicles[0].isActive).toBe(false);
  });

  it('returns lean rows without a per-vehicle product count', async () => {
    await Vehicle.create(vehicleFor('Mahindra', 'Thar'));

    const res = await list().expect(200);

    const [vehicle] = res.body.vehicles;
    expect(Object.keys(vehicle).sort()).toEqual(['_id', 'isActive', 'make', 'model', 'slug']);
    expect(res.body.truncated).toBe(false);
  });
});

/**
 * DELETE /vehicles/:id — permanent delete.
 *
 * This route used to be a soft delete (isActive = false), which made it an exact
 * duplicate of PATCH /:id/toggle-status: the admin's "Delete" button removed
 * nothing, and there was no way to get rid of a vehicle at all.
 *
 * The invariant that makes a real delete safe is that no product may be left
 * pointing at a Vehicle row that no longer exists. `compatibleVehicles` is a
 * genuine ObjectId ref array, and orphaned refs in it are what broke vehicle
 * fitment before — so the ref cleanup is asserted here, not just the row
 * disappearing.
 */

import { jest } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import Vehicle from '../models/Vehicle.js';
import Product from '../models/Product.js';
import AuditLog from '../models/AuditLog.js';
import productRepository from '../repositories/productRepository.js';
import * as dbHandler from './db-handler.js';

const BASE = '/api/v1';

const adminUser = {
  name: 'Vehicle Admin',
  email: 'vehicleadmin@example.com',
  password: 'SecurePass123!',
};

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

describe('DELETE /vehicles/:id', () => {
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

  const del = (id, query = '') =>
    request(app)
      .delete(`${BASE}/vehicles/${id}${query}`)
      .set('Authorization', `Bearer ${adminToken}`);

  it('requires an authenticated admin', async () => {
    const thar = await Vehicle.create(vehicleFor('Mahindra', 'Thar'));

    // 403 rather than 401: CSRF turns the anonymous mutation away before auth
    // even runs. Either way it must never be a 2xx — "auth failure never
    // returns 200" is the invariant being pinned here.
    const res = await request(app).delete(`${BASE}/vehicles/${thar._id}`);
    expect([401, 403]).toContain(res.status);

    // The row must survive an unauthenticated attempt.
    expect(await Vehicle.findById(thar._id)).not.toBeNull();
  });

  it('really removes the row — it does NOT just set isActive:false', async () => {
    const thar = await Vehicle.create(vehicleFor('Mahindra', 'Thar'));

    const res = await del(thar._id).expect(200);

    expect(res.body.success).toBe(true);
    // The whole point of the change: the document is gone, not deactivated.
    expect(await Vehicle.findById(thar._id)).toBeNull();
    expect(await Vehicle.countDocuments({})).toBe(0);
  });

  it('refuses with 409 and the exact product count when products are still mapped', async () => {
    const thar = await Vehicle.create(vehicleFor('Mahindra', 'Thar'));
    await Product.create(productFor('Thar Bull Bar', [thar._id]));
    await Product.create(productFor('Thar Roof Rack', [thar._id]));

    const res = await del(thar._id).expect(409);

    expect(res.body.requiresConfirmation).toBe(true);
    expect(res.body.productCount).toBe(2);
    // Nothing may be written on the refused call.
    expect(await Vehicle.findById(thar._id)).not.toBeNull();
    const untouched = await Product.findOne({ name: 'Thar Bull Bar' });
    expect(untouched.compatibleVehicles.map(String)).toContain(String(thar._id));
  });

  it('counts INACTIVE products too, so the confirmed number matches what gets written', async () => {
    const thar = await Vehicle.create(vehicleFor('Mahindra', 'Thar'));
    await Product.create(productFor('Published Bar', [thar._id]));
    await Product.create(productFor('Draft Bar', [thar._id], { isActive: false }));

    const res = await del(thar._id).expect(409);

    expect(res.body.productCount).toBe(2);
  });

  it('with force=true, strips the ref from every product and deletes the vehicle', async () => {
    const thar = await Vehicle.create(vehicleFor('Mahindra', 'Thar'));
    const jimny = await Vehicle.create(vehicleFor('Maruti', 'Jimny'));
    await Product.create(productFor('Shared Mat', [thar._id, jimny._id]));
    await Product.create(productFor('Draft Bar', [thar._id], { isActive: false }));

    const res = await del(thar._id, '?force=true').expect(200);

    expect(res.body.productsUnmapped).toBe(2);
    expect(await Vehicle.findById(thar._id)).toBeNull();

    // No product may still reference the deleted vehicle — the orphaned-ref
    // invariant this whole route exists to protect.
    expect(await Product.countDocuments({ compatibleVehicles: thar._id })).toBe(0);

    // …and the OTHER vehicle's fitment must survive: $pull removes one element,
    // it does not clear the array.
    const shared = await Product.findOne({ name: 'Shared Mat' });
    expect(shared.compatibleVehicles.map(String)).toEqual([String(jimny._id)]);
  });

  it('is idempotent under a double-submit — the second call 404s and changes nothing', async () => {
    const thar = await Vehicle.create(vehicleFor('Mahindra', 'Thar'));
    const jimny = await Vehicle.create(vehicleFor('Maruti', 'Jimny'));
    await Product.create(productFor('Jimny Mat', [jimny._id]));

    await del(thar._id).expect(200);
    await del(thar._id).expect(404);

    expect(await Vehicle.countDocuments({})).toBe(1);
    const jimnyMat = await Product.findOne({ name: 'Jimny Mat' });
    expect(jimnyMat.compatibleVehicles.map(String)).toEqual([String(jimny._id)]);
  });

  it('still strips refs when the pre-check counted zero — closing the map-during-delete race', async () => {
    const thar = await Vehicle.create(vehicleFor('Mahindra', 'Thar'));
    await Product.create(productFor('Late Bar', [thar._id]));

    // The count is a read taken BEFORE the delete, so a product mapped in the
    // window between the two is invisible to it. Forcing the count to report 0
    // while a product really is mapped reproduces that window exactly — and it
    // is the only way to, since any real seeding is visible to the real count.
    //
    // The old code treated a 0 count as proof there was nothing to pull, which
    // stranded a ref to a row that no longer exists. Nothing in the admin UI can
    // clear a fitment whose vehicle is gone, so it would have been permanent.
    const countSpy = jest
      .spyOn(productRepository, 'countByCompatibleVehicle')
      .mockResolvedValue(0);

    try {
      // No force flag — this is the path that used to skip the $pull entirely.
      await del(thar._id).expect(200);
    } finally {
      countSpy.mockRestore();
    }

    expect(await Vehicle.findById(thar._id)).toBeNull();
    expect(await Product.countDocuments({ compatibleVehicles: thar._id })).toBe(0);
  });

  it('runs the ref cleanup even on a vehicle with no products at all', async () => {
    const thar = await Vehicle.create(vehicleFor('Mahindra', 'Thar'));
    const jimny = await Vehicle.create(vehicleFor('Maruti', 'Jimny'));
    await Product.create(productFor('Jimny Mat', [jimny._id]));

    await del(thar._id).expect(200);

    // The unrelated product's fitment must be untouched by the blanket $pull.
    const mat = await Product.findOne({ name: 'Jimny Mat' });
    expect(mat.compatibleVehicles.map(String)).toEqual([String(jimny._id)]);
  });

  it('rejects a malformed id without touching anything', async () => {
    await Vehicle.create(vehicleFor('Mahindra', 'Thar'));

    await del('not-an-object-id').expect(400);

    expect(await Vehicle.countDocuments({})).toBe(1);
  });

  it('records the delete in the audit log with the number of products unmapped', async () => {
    const thar = await Vehicle.create(vehicleFor('Mahindra', 'Thar'));
    await Product.create(productFor('Thar Bull Bar', [thar._id]));

    await del(thar._id, '?force=true').expect(200);

    const entry = await AuditLog.findOne({ resource: 'Vehicle', action: 'VEHICLE_DELETE' });
    expect(entry).not.toBeNull();
    expect(entry.resourceId).toBe(String(thar._id));
    expect(entry.details.productsUnmapped).toBe(1);
    expect(entry.details.make).toBe('Mahindra');
  });
});

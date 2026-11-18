/**
 * Procurement keeps the delivery-fee rate card from the team panel
 * (/api/v1/staff/delivery-fees). Same service, validator, cache purge and audit log
 * as Admin → Delivery fees; the two on/off switches stay admin-only.
 *
 *   - procurement can read and save rates (the next quote uses them);
 *   - other staff teams and customers get 403;
 *   - an invalid / blank rate is refused and nothing is saved;
 *   - procurement cannot flip "charge at checkout" or "GST on fees" (403, unchanged);
 *   - the save purges the public delivery-fee cache and is audited with who did it;
 *   - the admin flow (/delivery-fees/admin) is unchanged and still flips the switch.
 */

import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: AuditLog } = await import('../models/AuditLog.js');
const { default: DeliveryFeeConfig } = await import('../models/DeliveryFeeConfig.js');
const { default: cacheService } = await import('../services/cacheService.js');
const { DELIVERY_FEE_CACHE_TAG } = await import('../services/deliveryFeeService.js');

const BASE = '/api/v1';
const URL = `${BASE}/staff/delivery-fees`;
const ADMIN_URL = `${BASE}/delivery-fees/admin`;

jest.setTimeout(120000);
beforeAll(async () => { await dbHandler.connect(); });
afterEach(async () => { await dbHandler.clearDatabase(); jest.restoreAllMocks(); });
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

let n = 0;
async function login(role, staff) {
  n += 1;
  const email = `df${n}@autobacs.test`;
  const password = 'SecurePass123!';
  const user = await User.create({
    name: `User ${n}`, email, phone: '9000000001', passwordHash: await bcrypt.hash(password, 10), role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
  const token = (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='))
    .split(';')[0].slice('accessToken='.length);
  return { token, user };
}
const as = (token) => ({ Authorization: `Bearer ${token}` });

/** What the procurement editor sends: the whole card from GET, minus the switches. */
function ratesPayload(config, bands) {
  const { chargeAtCheckout, gstOnFees, updatedAt, remotePinCount, pinLocationCount, ...rest } = config;
  return { ...rest, gstOnFees: { percent: gstOnFees.percent }, distanceBands: bands };
}

const NEW_BANDS = [
  { upToKm: 500, ratePerKg: 12, slabRate: 90 },
  { upToKm: 1500, ratePerKg: 18, slabRate: null },
  { upToKm: null, ratePerKg: 24, slabRate: 150 },
];

describe('/staff/delivery-fees — access', () => {
  test('procurement (member, not head) can read the rate card', async () => {
    const { token } = await login('staff', { team: 'procurement' });
    const res = await request(app).get(URL).set(as(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.config.distanceBands)).toBe(true);
    expect(typeof res.body.config.chargeAtCheckout).toBe('boolean');
  });

  test.each(['sales', 'accounts', 'operations', 'marketing', 'developer'])('%s staff get 403 on read and save', async (team) => {
    const { token } = await login('staff', { team, isHead: true });
    expect((await request(app).get(URL).set(as(token))).status).toBe(403);
    expect((await request(app).put(URL).set(as(token)).send({ distanceBands: NEW_BANDS })).status).toBe(403);
  });

  test('inactive procurement staff and customers get 403', async () => {
    const { token: customer } = await login('customer');
    expect((await request(app).get(URL).set(as(customer))).status).toBe(403);
    const { token: inactive, user } = await login('staff', { team: 'procurement' });
    await User.updateOne({ _id: user._id }, { $set: { 'staff.active': false } });
    expect((await request(app).get(URL).set(as(inactive))).status).toBe(403);
  });

  test('anonymous gets 401', async () => {
    expect((await request(app).get(URL)).status).toBe(401);
  });

  test('procurement still cannot use the admin endpoint', async () => {
    const { token } = await login('staff', { team: 'procurement' });
    expect((await request(app).get(ADMIN_URL).set(as(token))).status).toBe(403);
  });
});

describe('/staff/delivery-fees — saving rates', () => {
  test('procurement saves distance-band rates; purges the cache; audited with who', async () => {
    const { token, user } = await login('staff', { team: 'procurement' });
    const config = (await request(app).get(URL).set(as(token))).body.config;
    const purge = jest.spyOn(cacheService, 'invalidateTags');

    const res = await request(app).put(URL).set(as(token)).send(ratesPayload(config, NEW_BANDS));
    expect(res.status).toBe(200);
    expect(res.body.config.distanceBands).toEqual(NEW_BANDS);

    const stored = await DeliveryFeeConfig.findOne({ key: 'default' }).lean();
    expect(stored.distanceBands.map(({ upToKm, ratePerKg, slabRate }) => ({ upToKm, ratePerKg, slabRate }))).toEqual(NEW_BANDS);
    expect(String(stored.updatedBy)).toBe(String(user._id));
    // Switches untouched.
    expect(stored.chargeAtCheckout).toBe(config.chargeAtCheckout);
    expect(stored.gstOnFees.enabled).toBe(config.gstOnFees.enabled);

    expect(purge).toHaveBeenCalledWith(DELIVERY_FEE_CACHE_TAG);
    const audit = await AuditLog.findOne({ action: 'DELIVERY_FEE_RATES_UPDATE' }).lean();
    expect(String(audit.user)).toBe(String(user._id));
    expect(audit.details.to.distanceBands[2].ratePerKg).toBe(24);
  });

  test('an invalid rate is refused and nothing is saved', async () => {
    const { token } = await login('staff', { team: 'procurement' });
    const config = (await request(app).get(URL).set(as(token))).body.config;
    const bad = [
      [{ upToKm: 500, ratePerKg: -1 }, { upToKm: null, ratePerKg: 16 }], // negative
      [{ upToKm: 500, ratePerKg: '' }, { upToKm: null, ratePerKg: 16 }], // blank ≠ ₹0
      [{ upToKm: 500, ratePerKg: 'abc' }, { upToKm: null, ratePerKg: 16 }],
      [{ upToKm: 900, ratePerKg: 12 }, { upToKm: 500, ratePerKg: 14 }, { upToKm: null, ratePerKg: 16 }], // km going down
      [{ upToKm: null, ratePerKg: 5000 }], // above ₹1000/kg
    ];
    for (const bands of bad) {
      const res = await request(app).put(URL).set(as(token)).send(ratesPayload(config, bands));
      expect(res.status).toBe(400);
    }
    // A blank non-band field is refused too.
    const blankSlab = ratesPayload(config, NEW_BANDS);
    blankSlab.courier = { ...blankSlab.courier, slabRate: '' };
    expect((await request(app).put(URL).set(as(token)).send(blankSlab)).status).toBe(400);

    expect(await DeliveryFeeConfig.countDocuments({ 'distanceBands.ratePerKg': 24 })).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'DELIVERY_FEE_RATES_UPDATE' })).toBe(0);
  });

  test.each([
    ['chargeAtCheckout', (p) => ({ ...p, chargeAtCheckout: true })],
    ['chargeAtCheckout (same value)', (p) => ({ ...p, chargeAtCheckout: false })],
    ['gstOnFees.enabled', (p) => ({ ...p, gstOnFees: { ...p.gstOnFees, enabled: false } })],
  ])('procurement cannot send the %s switch (403, nothing saved)', async (_label, tamper) => {
    const { token } = await login('staff', { team: 'procurement' });
    const config = (await request(app).get(URL).set(as(token))).body.config;
    const res = await request(app).put(URL).set(as(token)).send(tamper(ratesPayload(config, NEW_BANDS)));
    expect(res.status).toBe(403);
    expect(await DeliveryFeeConfig.countDocuments({ 'distanceBands.ratePerKg': 24 })).toBe(0);
  });
});

describe('admin flow unchanged', () => {
  test('admin saves through /delivery-fees/admin and can flip the master switch', async () => {
    const { token } = await login('admin');
    const config = (await request(app).get(ADMIN_URL).set(as(token))).body.config;
    const res = await request(app).put(ADMIN_URL).set(as(token))
      .send({ ...ratesPayload(config, NEW_BANDS), chargeAtCheckout: true, gstOnFees: { ...config.gstOnFees, enabled: false } });
    expect(res.status).toBe(200);
    expect(res.body.config.chargeAtCheckout).toBe(true);
    expect(res.body.config.gstOnFees.enabled).toBe(false);
    expect(res.body.config.distanceBands).toEqual(NEW_BANDS);
  });

  test('admin can also use the team-panel route, switches included', async () => {
    const { token } = await login('admin');
    const config = (await request(app).get(URL).set(as(token))).body.config;
    const res = await request(app).put(URL).set(as(token)).send({ ...ratesPayload(config, NEW_BANDS), chargeAtCheckout: true });
    expect(res.status).toBe(200);
    expect(res.body.config.chargeAtCheckout).toBe(true);
  });
});

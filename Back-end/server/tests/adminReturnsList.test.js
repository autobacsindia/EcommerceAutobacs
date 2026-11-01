/**
 * Admin → Returns list over HTTP (GET /api/v1/returns/admin/all): search, filters,
 * sort and "Show more" pages (controllers/returnController.getAllReturns →
 * returnService.adminReturnsPage → utils/listQuery.js).
 *
 * What must hold:
 *   - only an admin gets in; a customer or staff member never does
 *   - search reaches every return, not just the loaded page: order number, the old
 *     website's #number, the customer, a product — every word must match
 *   - status, reason, came-from and raised-on narrow it; an unknown status is ignored
 *   - pages never repeat or skip a return, with a filter on; the count is first page only
 *   - an oversized search or page size is a 400, never a slow query
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: Product } = await import('../models/Product.js');
const { default: ReturnRequest } = await import('../models/ReturnRequest.js');

const BASE = '/api/v1/returns/admin/all';
const oid = () => new mongoose.Types.ObjectId();
const ist = (ymd) => new Date(`${ymd}T12:00:00+05:30`);
const WIPER = { _id: oid(), name: 'Bosch Aerotwin Wiper Blade', slug: 'bosch-aerotwin' };
const MAT = { _id: oid(), name: '3D Floor Mat Creta', slug: '3d-floor-mat' };

jest.setTimeout(120000);
beforeAll(async () => { await dbHandler.connect(); });
afterEach(async () => { await dbHandler.clearDatabase(); });
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

let n = 0;
async function login(role, staff) {
  n += 1;
  const email = `a${n}@autobacs.test`;
  const password = 'SecurePass123!';
  await User.create({ name: `User ${n}`, email, phone: '9000000001', passwordHash: await bcrypt.hash(password, 10), role, ...(staff && { staff: { active: true, isHead: false, ...staff } }) });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='))
    .split(';')[0].slice('accessToken='.length);
}
const as = (token) => ({ Authorization: `Bearer ${token}` });

async function order(over = {}) {
  const _id = oid();
  await Order.collection.insertOne({
    _id, shippingAddress: { fullName: 'Anil Thomas', phone: '9847001122' }, items: [], totalAmount: 1000, createdAt: new Date(), ...over,
  });
  return _id;
}
function ret(orderId, over = {}) {
  const { line, ...rest } = over;
  return {
    _id: oid(), order: orderId, origin: 'customer', status: 'pending', type: 'return', resolution: 'refund',
    items: [{ product: WIPER._id, quantity: 1, reason: 'wrong_item', unitPrice: 900, ...line }],
    supplierClaims: [], pickupAttempts: [], refund: { status: 'pending', productValue: 900 }, destination: { kind: 'warehouse' },
    createdAt: ist('2026-10-10'), updatedAt: new Date(), ...rest,
  };
}
const ids = (res) => res.body.requests.map((r) => r._id);

describe('admin returns list', () => {
  let adminToken; let anil; let kavya; let walkIn;
  beforeEach(async () => {
    adminToken = await login('admin');
    await Product.collection.insertMany([{ ...WIPER }, { ...MAT }]);
    anil = ret(await order({ wpId: 48213, orderNumber: 'AB-1001' }), { createdAt: ist('2026-09-05') });
    kavya = ret(await order({ shippingAddress: { fullName: 'Kavya Rao', phone: '9845077665' } }), {
      line: { product: MAT._id, reason: 'transit_damage' }, status: 'approved',
    });
    walkIn = ret(await order({ shippingAddress: { fullName: 'Joseph Mathew', phone: '9000000000' } }), {
      line: { product: MAT._id }, origin: 'admin_offline', status: 'refunded', createdAt: ist('2026-10-20'),
    });
    await ReturnRequest.collection.insertMany([anil, kavya, walkIn]);
  });
  const list = (qs = '') => request(app).get(`${BASE}?${qs}`).set(as(adminToken));

  it('only an admin gets in', async () => {
    expect([401, 403]).toContain((await request(app).get(BASE)).status);
    expect((await request(app).get(BASE).set(as(await login('customer')))).status).toBe(403);
    expect((await request(app).get(BASE).set(as(await login('staff', { team: 'operations' })))).status).toBe(403);
  });

  it('opens newest first with the count, the order and the customer filled in', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([walkIn, kavya, anil].map((r) => String(r._id)));
    expect(res.body).toMatchObject({ success: true, nextCursor: null, sort: 'newest', summary: { count: 3, capped: false } });
    expect(res.body.requests[2].order).toMatchObject({ orderNumber: 'AB-1001', wpId: 48213 });
    expect(res.body.requests[2].items[0].product).toMatchObject({ name: WIPER.name });
    expect(res.body).not.toHaveProperty('pagination');
  });

  it.each([
    ['the order number', 'ab-1001', () => [anil]],
    ["the old website's #number", '#48213', () => [anil]],
    ['the customer', 'KAVYA', () => [kavya]],
    ['a product and a customer, both must match', 'joseph floor', () => [walkIn]],
    ['a miss', 'joseph wiper', () => []],
  ])('search by %s', async (_, q, expected) => {
    expect(ids(await list(`q=${encodeURIComponent(q)}`))).toEqual(expected().map((r) => String(r._id)));
  });

  it('status, reason, came-from and raised-on narrow it; an unknown status is ignored', async () => {
    expect(ids(await list('status=approved'))).toEqual([String(kavya._id)]);
    expect(ids(await list('reason=transit_damage'))).toEqual([String(kavya._id)]);
    expect(ids(await list('origin=recorded'))).toEqual([String(walkIn._id)]);
    expect(ids(await list('from=2026-09-01&to=2026-09-30'))).toEqual([String(anil._id)]);
    expect(ids(await list('status=lost'))).toHaveLength(3);
    expect(ids(await list('sort=oldest'))).toEqual([anil, kavya, walkIn].map((r) => String(r._id)));
  });

  it('pages never repeat or skip a return, with a filter on', async () => {
    const o = await order();
    const same = ist('2026-10-15');
    await ReturnRequest.collection.insertMany(Array.from({ length: 11 }, (_, i) => ret(o, {
      line: { product: oid() }, origin: i % 2 ? 'staff' : 'customer', createdAt: same,
    })));
    const seen = [];
    let cursor = '';
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- pages are sequential by nature
      const res = await list(`origin=staff&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      if (cursor) expect(res.body.summary).toBeUndefined();
      else expect(res.body.summary).toMatchObject({ count: 5 });
      seen.push(...ids(res));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('an oversized search or page size is refused', async () => {
    expect((await list(`q=${'x'.repeat(101)}`)).status).toBe(400);
    expect((await list('limit=500')).status).toBe(400);
  });
});

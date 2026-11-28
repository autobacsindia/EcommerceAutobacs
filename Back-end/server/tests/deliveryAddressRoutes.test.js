/**
 * Every door where a person types a delivery address refuses a bad one ON THE
 * SERVER — not just in the form (utils/deliveryAddress.js):
 *   website checkout (POST /orders, /orders/guest), staff quotations
 *   (POST /staff/sales/quotations), admin offline orders (POST /orders/admin/offline),
 *   saved addresses (PUT /profile/addresses). The admin address edit is covered
 *   in orderShippingAddress.test.js.
 * And old records still load: an order and a saved address from before the rule.
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');

const BASE = '/api/v1';

beforeAll(async () => { await dbHandler.connect(); });
afterEach(async () => { await dbHandler.clearDatabase(); });
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

let n = 0;
async function login(role = 'customer', extra = {}) {
  n += 1;
  const email = `addr-${role}${n}@autobacs.test`;
  const password = 'SecurePass123!';
  const user = await User.create({
    name: `${role} ${n}`, email, phone: `90000001${String(n).padStart(2, '0')}`,
    passwordHash: await bcrypt.hash(password, 10), role, ...extra,
  });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
  const token = (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='))
    .split(';')[0].slice('accessToken='.length);
  return { token, user };
}

const GOOD = {
  fullName: 'Rahul Menon', phone: '9876543210', houseNumber: 'Flat 4B, Jomer Symphony',
  addressLine1: 'MG Road, Edappally', landmark: 'Opp. Lulu Mall', city: 'Kochi', state: 'Kerala', postalCode: '682024',
};
const items = [{ product: new mongoose.Types.ObjectId().toString(), quantity: 1 }];
const text = (res) => JSON.stringify(res.body).toLowerCase();

describe('website checkout refuses a bad address before anything is priced or saved', () => {
  it.each([
    ['missing house no.', { houseNumber: '' }, 'house name or flat / building number'],
    ['one-word street', { addressLine1: 'Kochi' }, 'one word'],
    ['junk street', { addressLine1: '----' }, "doesn't look right"],
    ['junk landmark', { landmark: 'aaaa' }, 'landmark'],
  ])('POST /orders — %s → 400', async (_n, over, msg) => {
    const { token } = await login();
    const res = await request(app).post(`${BASE}/orders`).set('Authorization', `Bearer ${token}`)
      .send({ items, shippingAddress: { ...GOOD, ...over }, paymentMethod: 'razorpay' });
    expect(res.status).toBe(400);
    expect(text(res)).toContain(msg);
    expect(await Order.countDocuments({})).toBe(0);
  });

  it('POST /orders/guest — missing house no. → 400', async () => {
    // An anonymous browser: cookie jar + CSRF token, as the storefront does.
    const jar = request.agent(app);
    const t = await jar.get(`${BASE}/csrf-token`);
    const xsrf = ((t.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN=')) || '').split(';')[0].split('=')[1] || t.body?.csrfToken || '';
    const res = await jar.post(`${BASE}/orders/guest`).set('X-XSRF-TOKEN', xsrf)
      .send({ items, email: 'guest@example.test', shippingAddress: { ...GOOD, houseNumber: undefined }, paymentMethod: 'razorpay' });
    expect(res.status).toBe(400);
    expect(text(res)).toContain('house name or flat / building number');
  });

  it('a good address gets past the address check (landmark optional)', async () => {
    const { token } = await login();
    const res = await request(app).post(`${BASE}/orders`).set('Authorization', `Bearer ${token}`)
      .send({ items, shippingAddress: { ...GOOD, landmark: undefined }, paymentMethod: 'razorpay' });
    // The made-up product then fails later — but not on the address.
    expect(text(res)).not.toContain('house name or flat');
    expect(text(res)).not.toContain('street and area');
  });
});

describe('staff and admin doors', () => {
  it('POST /staff/sales/quotations — no house no. → 400 on that field', async () => {
    const { token } = await login('staff', { staff: { team: 'sales', active: true } });
    const res = await request(app).post(`${BASE}/staff/sales/quotations`).set('Authorization', `Bearer ${token}`)
      .send({ customer: { name: 'Big Build', phone: '9820917286' }, shippingAddress: { ...GOOD, houseNumber: '' }, items: [{ custom: true, name: 'Lift kit', quantity: 1, price: 100 }] });
    expect(res.status).toBe(400);
    expect(text(res)).toContain('house name or flat / building number');
  });

  it('POST /orders/admin/offline — one-word street → 400, no order, no customer', async () => {
    const { token } = await login('admin');
    const before = await User.countDocuments({});
    const res = await request(app).post(`${BASE}/orders/admin/offline`).set('Authorization', `Bearer ${token}`)
      .send({
        email: 'walkin@example.test', phone: '9876543210', status: 'processing', paymentMode: 'paid',
        items: [{ product: new mongoose.Types.ObjectId().toString(), quantity: 1, price: 500 }],
        shippingAddress: { ...GOOD, addressLine1: 'Kochi' },
      });
    expect(res.status).toBe(400);
    expect(text(res)).toContain('one word');
    expect(await Order.countDocuments({})).toBe(0);
    expect(await User.countDocuments({})).toBe(before);
  });
});

describe('saved addresses (PUT /profile/addresses)', () => {
  const OLD = { fullName: 'Rahul Menon', phone: '9876543210', addressLine1: 'Kochi', city: 'Kochi', state: 'Kerala', postalCode: '682024', country: 'India', isDefault: true };

  it('refuses a new address with no house no.', async () => {
    const { token } = await login();
    const res = await request(app).put(`${BASE}/profile/addresses`).set('Authorization', `Bearer ${token}`)
      .send({ addresses: [{ ...GOOD, houseNumber: '' }] });
    expect(res.status).toBe(400);
    expect(res.body.message.toLowerCase()).toContain('house name or flat / building number');
  });

  it('keeps an old address untouched while a new one is added, and still lists it', async () => {
    const { token, user } = await login();
    await User.updateOne({ _id: user._id }, { $set: { addresses: [OLD] } });
    const res = await request(app).put(`${BASE}/profile/addresses`).set('Authorization', `Bearer ${token}`)
      .send({ addresses: [OLD, { ...GOOD, isDefault: false }] });
    expect(res.status).toBe(200);
    expect(res.body.addresses).toHaveLength(2);
    expect(res.body.addresses[1]).toMatchObject({ houseNumber: GOOD.houseNumber, landmark: GOOD.landmark });

    const list = await request(app).get(`${BASE}/profile/addresses`).set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.addresses[0]).toMatchObject({ addressLine1: 'Kochi' });
    expect(list.body.addresses[0].houseNumber).toBeUndefined();
  });
});

describe('old orders still load', () => {
  it('a customer can open an order placed before the rule', async () => {
    const { token, user } = await login();
    const order = await Order.create({
      user: user._id,
      items: [{ product: new mongoose.Types.ObjectId(), name: 'A', price: 500, quantity: 1 }],
      shippingAddress: { fullName: 'Rahul', phone: '9876543210', addressLine1: 'Kochi', city: 'Kochi', state: 'Kerala', postalCode: '682024' },
      subtotal: 500, totalAmount: 500, status: 'processing',
    });
    const res = await request(app).get(`${BASE}/orders/${order._id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const addr = (res.body.order || res.body.data || res.body).shippingAddress;
    expect(addr).toMatchObject({ addressLine1: 'Kochi' });
  });
});

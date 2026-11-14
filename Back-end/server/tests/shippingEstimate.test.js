/**
 * Procurement shipping calculator (services/shippingEstimateService.js):
 * pincode + weight → the delivery zone's rate, in paise.
 *
 * What must hold:
 *   - procurement and the admin only
 *   - it is the SAME number the existing delivery-zone calculation gives (no second rate system)
 *   - base + per-kg breakdown in whole paise; product weights summed per quantity in grams
 *   - unknown / not-serviceable pincodes say so (and whether any rates exist at all)
 *   - bad pincode / weight / product → 4xx with a plain message, never a 500
 */
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: DeliveryZone } = await import('../models/DeliveryZone.js');
const { default: Product } = await import('../models/Product.js');
const { default: deliveryZoneService } = await import('../services/deliveryZoneService.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const URL_ = '/supplier-enquiries/shipping-estimate';
const csrfFrom = (res) => {
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  return { post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body) };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return signIn(email);
};
const staff = (team) => ({ team, isHead: false, active: true });
const zone = (over) => DeliveryZone.create({
  name: 'Kerala metro', type: 'metro', pinCodes: ['682001', '682016'], deliveryTime: { minDays: 2, maxDays: 4 },
  shippingCost: { baseRate: 50, perKgRate: 20.5 }, ...over,
});
const product = async (name, weightKg) => (await Product.collection.insertOne({ name, slug: name.toLowerCase().replace(/\W+/g, '-'), shippingSize: { weightKg } })).insertedId.toString();

describe('Shipping calculator (procurement panel)', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let admin, procurement, accounts;
  beforeEach(async () => {
    admin = await makeUser('Owner', 'admin');
    procurement = await makeUser('Priya', 'staff', staff('procurement'));
    accounts = await makeUser('Anu', 'staff', staff('accounts'));
  });

  it('procurement and the admin; nobody else', async () => {
    await zone();
    expect((await procurement.post(URL_, { pin: '682001' })).status).toBe(200);
    expect((await admin.post(URL_, { pin: '682001' })).status).toBe(200);
    expect((await accounts.post(URL_, { pin: '682001' })).status).toBe(403);
    expect((await request(app).post(`${BASE}${URL_}`).send({ pin: '682001' })).status).toBeGreaterThanOrEqual(401);
  });

  it('base + per kg in whole paise, the same figure the delivery-zone calculation gives', async () => {
    await zone();
    const res = await procurement.post(URL_, { pin: '682 001', weightKg: '2.5' });
    expect(res.status).toBe(200);
    expect(res.body.estimate).toMatchObject({
      found: true, pin: '682001', weightKg: 2.5, zone: { name: 'Kerala metro', type: 'metro' }, deliveryDays: { min: 2, max: 4 },
      basePaise: 5000, perKgPaise: 2050, weightPaise: 5125, totalPaise: 10125,
    });
    const same = await deliveryZoneService.calculateShippingCost('682001', 2.5);
    expect(Math.round(same.shippingCost * 100)).toBe(res.body.estimate.totalPaise);
    // No weight → the base rate alone.
    expect((await procurement.post(URL_, { pin: '682016' })).body.estimate).toMatchObject({ weightKg: 0, totalPaise: 5000, weightPaise: 0 });
  });

  it('overlapping zones: the higher priority wins; a zone switched off is ignored', async () => {
    await zone();
    await zone({ name: 'Kochi express', priority: 5, shippingCost: { baseRate: 80, perKgRate: 0 } });
    await zone({ name: 'Paused', priority: 9, isServiceable: false, shippingCost: { baseRate: 1, perKgRate: 0 } });
    expect((await procurement.post(URL_, { pin: '682001', weightKg: 3 })).body.estimate).toMatchObject({ zone: { name: 'Kochi express' }, totalPaise: 8000 });
  });

  it('a pincode no zone covers says so, and whether any rates are set up at all', async () => {
    const none = (await procurement.post(URL_, { pin: '110001' })).body.estimate;
    expect(none).toMatchObject({ found: false, zonesConfigured: 0 });
    expect(none.totalPaise).toBeUndefined();
    await zone();
    expect((await procurement.post(URL_, { pin: '110001' })).body.estimate).toMatchObject({ found: false, zonesConfigured: 1 });
  });

  it('adds up picked products by quantity (grams, no float drift) and lists ones without a weight', async () => {
    await zone();
    const wax = await product('Car wax', 0.6);
    const mat = await product('Floor mat set', 1.15);
    const kit = await product('Sensor kit', null);
    const res = await procurement.post(URL_, { pin: '682001', weightKg: '0.25', items: [{ productId: wax, qty: 3 }, { productId: mat, qty: 2 }, { productId: kit, qty: 1 }] });
    expect(res.status).toBe(200);
    const e = res.body.estimate;
    expect(e.weightKg).toBe(4.35); // 0.25 + 1.8 + 2.3
    expect(e.items.map((i) => [i.name, i.qty, i.weightKg])).toEqual([['Car wax', 3, 0.6], ['Floor mat set', 2, 1.15], ['Sensor kit', 1, null]]);
    expect(e.missingWeight).toEqual(['Sensor kit']);
    expect(e.totalPaise).toBe(5000 + Math.round(4.35 * 2050)); // 5000 + 8918
  });

  it('bad input is a plain 4xx, never a 500', async () => {
    await zone();
    for (const pin of ['', '12345', '012345', '68200a', '6820011']) {
      const r = await procurement.post(URL_, { pin });
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/6-digit pincode/);
    }
    for (const weightKg of ['-1', 'two', '1.2345', '5000']) expect((await procurement.post(URL_, { pin: '682001', weightKg })).status).toBe(400);
    expect((await procurement.post(URL_, { pin: '682001', items: [{ productId: 'nope', qty: 1 }] })).status).toBe(400);
    expect((await procurement.post(URL_, { pin: '682001', items: [{ productId: '6af7f13f25aff7d6892e444b', qty: 0 }] })).status).toBe(400);
    expect((await procurement.post(URL_, { pin: '682001', items: [{ productId: '6af7f13f25aff7d6892e444b', qty: 1 }] })).status).toBe(404);
  });
});

/**
 * GET /delivery-fees/card-waivers — the product cards' Black Friday "Save ₹X+" figures.
 * Public, display only, bounded input; the maths is covered in bfPinSavingsPacking.test.js.
 */
import { jest } from '@jest/globals';

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: Product } = await import('../models/Product.js');
const { default: DeliveryFeeConfig } = await import('../models/DeliveryFeeConfig.js');
const { default: FestivalOffer } = await import('../models/FestivalOffer.js');
const { setBlackFridayGateForTests } = await import('../services/deliveryFeeService.js');
const { API } = await import('./helpers/api.js');

jest.setTimeout(60000);

beforeAll(async () => { await dbHandler.connect(); setBlackFridayGateForTests(async () => true); });
afterAll(async () => {
  setBlackFridayGateForTests(null);
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  await dbHandler.closeDatabase();
});

const URL = `${API}/delivery-fees/card-waivers`;

it('offer live → per-product figures, no auth needed', async () => {
  const p = await Product.create({
    name: 'Card P', slug: `card-p-${Date.now()}`, description: 'x', price: 20000, originalPrice: 23000,
    stock: 'in', brand: 'B', isActive: true, shippingClass: 'large',
  });
  await DeliveryFeeConfig.findOneAndUpdate({ key: 'default' }, { $set: { chargeAtCheckout: true } }, { upsert: true, setDefaultsOnInsert: true });
  await FestivalOffer.findOneAndUpdate({ key: 'default' }, { $set: { waiveDeliveryFees: true, enabled: false } }, { upsert: true });
  const res = await request(app).get(`${URL}?ids=${p._id},nonsense`).expect(200);
  expect(res.body.waivers.live).toBe(true);
  const w = res.body.waivers.products[String(p._id)];
  expect(w).toMatchObject({ discount: 3000, packing: 500 });
  expect(w.save).toBeCloseTo(w.discount + w.total, 2);
});

it('no ids → 200, live false (nothing to compute)', async () => {
  const res = await request(app).get(URL).expect(200);
  expect(res.body.waivers).toEqual({ live: false, products: {} });
});

it('an oversized id list is refused with a 400, not computed', async () => {
  await request(app).get(`${URL}?ids=${'a'.repeat(2001)}`).expect(400);
});

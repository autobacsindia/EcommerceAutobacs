/**
 * GET /delivery-fees/estimates — the delivery window per product for the PDP and
 * cards. Public, display only, bounded input.
 */
import { jest } from '@jest/globals';

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: Product } = await import('../models/Product.js');
const { default: Category } = await import('../models/Category.js');
const { resetCategoryIndexForTests } = await import('../services/deliveryFeeService.js');
const { API } = await import('./helpers/api.js');

jest.setTimeout(60000);

beforeAll(async () => { await dbHandler.connect(); });
afterAll(async () => {
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  await dbHandler.closeDatabase();
});

const URL = `${API}/delivery-fees/estimates`;
let n = 0;
const make = (extra = {}) => Product.create({
  name: `Est P ${++n}`, slug: `est-p-${n}-${Date.now()}`, description: 'x', price: 1000,
  stock: 'in', brand: 'B', isActive: true, ...extra,
});

it('returns the window per product, no auth needed; unknown/inactive ids are absent', async () => {
  resetCategoryIndexForTests();
  const cat = await Category.create({ name: 'Body Kits', slug: `body-kits-${Date.now()}` });
  const small = await make({ shippingClass: 'small' });
  const xl = await make({ shippingClass: 'xl' });
  const byCategory = await make({ categories: [cat._id] }); // body-kit → XL guess
  const inactive = await make({ isActive: false, shippingClass: 'small' });
  const res = await request(app)
    .get(`${URL}?ids=${small._id},${xl._id},${byCategory._id},${inactive._id},nonsense`)
    .expect(200);
  const { products, general } = res.body.estimates;
  expect(general).toEqual({ minDays: 7, maxDays: 10 });
  expect(products[String(small._id)]).toEqual({ minDays: 7, maxDays: 10, heavy: false });
  expect(products[String(xl._id)]).toEqual({ minDays: 10, maxDays: 15, heavy: true });
  expect(products[String(byCategory._id)]).toEqual({ minDays: 10, maxDays: 15, heavy: true });
  expect(products[String(inactive._id)]).toBeUndefined();
  expect(products.nonsense).toBeUndefined();
});

it('a product with nothing known (no class, no category) gets the general window', async () => {
  const p = await make();
  const res = await request(app).get(`${URL}?ids=${p._id}`).expect(200);
  expect(res.body.estimates.products[String(p._id)]).toEqual({ minDays: 7, maxDays: 10, heavy: false });
});

it('no ids → 200 with the general window and no products', async () => {
  const res = await request(app).get(URL).expect(200);
  expect(res.body.estimates).toEqual({ general: { minDays: 7, maxDays: 10 }, products: {} });
});

it('an oversized id list is refused with a 400', async () => {
  await request(app).get(`${URL}?ids=${'a'.repeat(2001)}`).expect(400);
});

/**
 * The team lists' search / filter / sort parameters over HTTP: the validators let
 * the new ones through (dates, amounts, salesman, sorts), refuse malformed ones
 * with a 400, and the gate in front is unchanged — customers never get in, and a
 * team that could not open a list before still cannot. What each filter DOES is
 * covered in orderListFilters / salesListSearch / staffTasks.
 */
import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';

const storageMock = {
  resourceTypeFor: () => 'image',
  putPrivateAsset: async () => ({ publicId: 'x', provider: 'r2', bytes: 1, url: '' }),
  deletePrivateAsset: async () => true,
  readPrivateAsset: async () => Buffer.alloc(0),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');

const BASE = '/api/v1';
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
  const email = `u${n}@autobacs.test`;
  const password = 'SecurePass123!';
  const user = await User.create({
    name: `User ${n}`, email, phone: '9000000001', passwordHash: await bcrypt.hash(password, 10), role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
  const token = (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='))
    .split(';')[0].slice('accessToken='.length);
  return { token, id: String(user._id) };
}
const get = (path, who) => request(app).get(`${BASE}${path}`).set({ Authorization: `Bearer ${who.token}` });

it('work lists: dates and amounts are accepted; a bad sort is refused', async () => {
  const p = await login('staff', { team: 'procurement' });
  const ok = await get('/staff/work?queue=procurement&q=hilux&from=2026-10-01&to=2026-10-31&min=100&max=50000&sort=oldest', p);
  expect(ok.status).toBe(200);
  expect(ok.body.orders).toEqual([]);
  expect((await get('/staff/work?queue=procurement&sort=sideways', p)).status).toBe(400);
  expect((await get(`/staff/work?queue=procurement&from=${'9'.repeat(20)}`, p)).status).toBe(400);
});

it('Order processing: amount sorts, dates and amounts; the count comes back on the first page', async () => {
  const acc = await login('staff', { team: 'accounts' });
  const res = await get('/staff/orders/paid?stage=processing&sort=amount_desc&from=2026-10-01&min=1', acc);
  expect(res.status).toBe(200);
  expect(res.body.summary).toEqual({ count: 0, capped: false, total: 0 });
  expect(res.body.sort).toBe('amount_desc');
  // Teams that could not open it before still cannot.
  const marketing = await login('staff', { team: 'marketing' });
  expect((await get('/staff/orders/paid?stage=processing', marketing)).status).toBe(403);
});

it('Quotations and My orders: search, salesman, dates and sorts; malformed values refused', async () => {
  const lead = await login('staff', { team: 'sales' });
  const quotations = await get(`/staff/sales/quotations?status=open&q=ravi&seller=${lead.id}&from=2026-10-01&to=2026-10-31&sort=amount_desc`, lead);
  expect(quotations.status).toBe(200);
  expect(quotations.body).toMatchObject({ quotations: [], scope: 'mine', summary: { count: 0 } });
  // A cursor from before this change (a bare quotation id) is accepted and starts the list over.
  expect((await get(`/staff/sales/quotations?cursor=${lead.id}`, lead)).status).toBe(200);
  expect((await get(`/staff/sales/quotations?q=${'x'.repeat(61)}`, lead)).status).toBe(400);
  expect((await get('/staff/sales/quotations?status=lost', lead)).status).toBe(400);

  const orders = await get('/staff/sales/orders?view=active&q=ravi&paid=unpaid&sort=amount_asc&from=2026-10-01', lead);
  expect(orders.status).toBe(200);
  expect(orders.body).toMatchObject({ orders: [], scope: 'mine', summary: { count: 0 } });
  expect((await get('/staff/sales/orders?paid=maybe', lead)).status).toBe(400);
});

it('the sales filter options: a lead gets no salesmen, the head gets the team, others are refused', async () => {
  const lead = await login('staff', { team: 'sales' });
  const head = await login('staff', { team: 'sales', isHead: true });
  expect((await get('/staff/sales/filter-options', lead)).body).toEqual({ success: true, sellers: [] });
  const forHead = await get('/staff/sales/filter-options', head);
  expect(forHead.status).toBe(200);
  expect(forHead.body.sellers.map((s) => s.id).sort()).toEqual([lead.id, head.id].sort());
  expect((await get('/staff/sales/filter-options', await login('staff', { team: 'procurement' }))).status).toBe(403);
});

it('customers never reach any of these lists', async () => {
  const customer = await login('customer');
  for (const path of [
    '/staff/work?queue=procurement', '/staff/orders/paid', '/staff/sales/quotations', '/staff/sales/orders',
    '/staff/sales/filter-options', '/staff/tasks?sort=newest',
  ]) {
    expect([401, 403]).toContain((await get(path, customer)).status);
  }
});

it('Tasks: the sort is accepted, and the open list carries a count', async () => {
  const p = await login('staff', { team: 'procurement' });
  const res = await get('/staff/tasks?view=mine&state=open&sort=newest', p);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ tasks: [], sort: 'newest', summary: { count: 0, capped: false } });
  // An unknown sort reads as due date (an old link still opens).
  expect((await get('/staff/tasks?view=mine&state=open&sort=sideways', p)).body.sort).toBe('due');
});

/**
 * "Above 10% needs approval" through the real API (routes/staff.js): signed-in
 * browsers with cookies + CSRF, so a direct API call is tested exactly as a
 * hand-crafted request would arrive. The service rules are in
 * quotationDiscountApproval.test.js; this proves the gates are wired.
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import emailHandler from '../services/emailHandler.js';
import { whyCannotApprove } from '../services/quotationApprovalService.js';

const BASE = '/api/v1';
const PASSWORD = 'SecurePass123!';
const csrfFrom = (res) => {
  const xsrf = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return xsrf ? xsrf.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PASSWORD });
  const csrf = csrfFrom(res);
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
  };
}
const createUser = async (name, email, extra) => User.create({
  name, email, phone: '9876543210', passwordHash: await bcrypt.hash(PASSWORD, 4), ...extra,
});

const body = (percent) => ({
  customer: { name: 'Rohit Shah', phone: '9820917286' },
  shippingAddress: { addressLine1: 'Suman Heights', city: 'Navi Mumbai', state: 'Maharashtra', postalCode: '400706' },
  items: [{ custom: true, name: 'Installation', quantity: 1, price: 10000 }],
  discount: { percent, reason: 'Fleet customer' },
});

describe('discount approval API', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  beforeEach(() => { jest.spyOn(emailHandler, 'sendEmail').mockResolvedValue({ success: true }); });
  afterEach(async () => { jest.restoreAllMocks(); await dbHandler.clearDatabase(); });

  let seller; let head; let admin;
  beforeEach(async () => {
    await createUser('Asha', 'asha@example.com', { role: 'staff', staff: { team: 'sales', active: true } });
    await createUser('Vikram', 'vikram@example.com', { role: 'staff', staff: { team: 'sales', active: true, isHead: true } });
    await createUser('Owner', 'owner@example.com', { role: 'admin' });
    seller = await signIn('asha@example.com');
    head = await signIn('vikram@example.com');
    admin = await signIn('owner@example.com');
  });

  it('a 12% quotation cannot be shared or accepted by direct API call until approved', async () => {
    const created = await seller.post('/staff/sales/quotations', body(12));
    expect(created.status).toBe(201);
    const id = created.body.quotation.id;
    expect(created.body.quotation.approval).toMatchObject({ state: 'needed', percent: 12, threshold: 10 });

    expect((await seller.get(`/staff/sales/quotations/${id}/pdf`)).status).toBe(409);
    expect((await seller.post(`/staff/sales/quotations/${id}/accept`)).status).toBe(409);
    // The seller cannot approve their own, even by calling decide directly.
    expect((await seller.post(`/staff/sales/quotations/${id}/approval/request`, { reason: 'Fleet, 6 cars' })).status).toBe(200);
    expect((await seller.post(`/staff/sales/quotations/${id}/approval/decide`, { decision: 'approve' })).status).toBe(403);
    expect((await seller.post(`/staff/sales/quotations/${id}/accept`)).status).toBe(409);

    // The head sees it in "Needs approval", with the approve buttons.
    const list = await head.get('/staff/sales/quotations?status=approval');
    expect(list.status).toBe(200);
    expect(list.body.quotations.map((q) => q.id)).toEqual([id]);
    const detail = await head.get(`/staff/sales/quotations/${id}`);
    expect(detail.body.quotation.approval).toMatchObject({ state: 'pending', canDecide: true });
    expect((await seller.get(`/staff/sales/quotations/${id}`)).body.quotation.approval.canDecide).toBe(false);

    const ok = await head.post(`/staff/sales/quotations/${id}/approval/decide`, {
      decision: 'approve', note: 'OK', priceKey: detail.body.quotation.approval.priceKey,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.quotation.approval.state).toBe('approved');

    expect((await seller.get(`/staff/sales/quotations/${id}/pdf`)).status).toBe(200);
    const accepted = await seller.post(`/staff/sales/quotations/${id}/accept`);
    expect(accepted.status).toBe(201);
    const order = await Order.findById(accepted.body.orderId).lean();
    expect(order).toMatchObject({ totalAmount: 8800, discountApproval: expect.objectContaining({ percent: 12, approvedByName: 'Vikram' }) });
  });

  it('a raised discount after approval needs approving again (via the edit API)', async () => {
    const id = (await seller.post('/staff/sales/quotations', body(12))).body.quotation.id;
    await seller.post(`/staff/sales/quotations/${id}/approval/request`, { reason: 'Fleet' });
    await admin.post(`/staff/sales/quotations/${id}/approval/decide`, { decision: 'approve' });
    const edited = await seller.put(`/staff/sales/quotations/${id}`, body(18));
    expect(edited.status).toBe(200);
    expect(edited.body.quotation.approval.state).toBe('needed');
    expect((await seller.post(`/staff/sales/quotations/${id}/accept`)).status).toBe(409);
  });

  it('10% exactly goes through untouched', async () => {
    const id = (await seller.post('/staff/sales/quotations', body(10))).body.quotation.id;
    expect((await seller.get(`/staff/sales/quotations/${id}/pdf`)).status).toBe(200);
    expect((await seller.post(`/staff/sales/quotations/${id}/accept`)).status).toBe(201);
  });

  it('validates the request and decision bodies', async () => {
    const id = (await seller.post('/staff/sales/quotations', body(12))).body.quotation.id;
    expect((await seller.post(`/staff/sales/quotations/${id}/approval/request`, { reason: '' })).status).toBe(400);
    expect((await head.post(`/staff/sales/quotations/${id}/approval/decide`, { decision: 'maybe' })).status).toBe(400);
  });
});

describe('whyCannotApprove (pure)', () => {
  const q = { salesUser: 'seller1', discountApproval: { requestedBy: 'seller1' } };
  const seller = { _id: 'seller1', staff: { team: 'sales' } };
  it('admin yes; GTM head yes; procurement head and a lead no', () => {
    expect(whyCannotApprove({ role: 'admin', _id: 'a' }, q, seller)).toBeNull();
    expect(whyCannotApprove({ role: 'staff', _id: 'h', staff: { team: 'sales', isHead: true, active: true } }, q, seller)).toBeNull();
    expect(whyCannotApprove({ role: 'staff', _id: 'p', staff: { team: 'procurement', isHead: true, active: true } }, q, seller)).toMatch(/own team/);
    expect(whyCannotApprove({ role: 'staff', _id: 'l', staff: { team: 'sales', active: true } }, q, seller)).toMatch(/Only the GTM head/);
    expect(whyCannotApprove({ role: 'staff', _id: 'h', staff: { team: 'sales', isHead: false, active: false } }, q, seller)).toMatch(/Only/);
  });
});

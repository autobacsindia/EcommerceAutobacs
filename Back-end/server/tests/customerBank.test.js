/**
 * Saved customer bank details for refunds / NEFT (services/customerBankService.js),
 * over HTTP — real auth, CSRF, validators and an in-memory Mongo.
 *
 * What must hold:
 *   - saved from a quotation, they appear on the same customer's next quotation and
 *     order (keyed by the mobile, however it was typed)
 *   - the number is ENCRYPTED in the database; every screen sees XXXXXXXX1234
 *   - only accounts and admin can see the full number, and each reveal is audited —
 *     with the last four digits only
 *   - a seller reaches only their own customers; a website order is accounts/admin only
 *   - only bank fields are stored — a card number or CVV sent along is dropped
 *   - no key configured → refused, nothing stored in plaintext
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import SalesQuotation from '../models/SalesQuotation.js';
import CustomerBankAccount from '../models/CustomerBankAccount.js';
import AuditLog from '../models/AuditLog.js';
import { isEncrypted, decryptField } from '../utils/fieldEncryption.js';

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const ORIGINAL_KEY = process.env.FIELD_ENCRYPTION_KEY;
const BANK = { accountName: 'Big Build Pvt Ltd', accountNumber: '123456789012', confirmAccountNumber: '1234 5678 9012', ifsc: 'hdfc0001234', bankName: 'HDFC Bank' };

const csrfFrom = (res) => {
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};
let n = 0;
async function person(role, staff, name) {
  n += 1;
  const email = `p${n}@autobacs.test`;
  const user = await User.create({ name: name || `Person ${n}`, email, role, staff, phone: '9000000001', passwordHash: await bcrypt.hash(PW, 4) });
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  return {
    user,
    get: (url) => agent.get(`${BASE}${url}`),
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    del: (url) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf),
  };
}
const sales = (isHead = false) => ({ team: 'sales', isHead, active: true });

const quotation = (seller, phone = '9820917286') => SalesQuotation.create({
  number: `QT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
  customer: { name: 'Big Build', phone },
  shippingAddress: { fullName: 'Big Build', phone, addressLine1: '1 St', city: 'Mumbai', state: 'MH', postalCode: '400706' },
  items: [{ custom: true, name: 'Lift kit', quantity: 1, price: 1000 }],
  subtotal: 1000, totalAmount: 1000, salesUser: seller._id, validUntil: new Date(Date.now() + 7 * 864e5),
});
const order = async (seller, phone = '9820917286') => {
  const customer = await User.create({ name: 'Big Build', email: `c${++n}@x.com`, phone, passwordHash: 'x' });
  return Order.create({
    user: customer._id, salesUser: seller?._id ?? null, source: seller ? 'offline' : 'web',
    items: [{ custom: true, name: 'Lift kit', quantity: 1, price: 1000 }],
    shippingAddress: { fullName: 'Big Build', phone, addressLine1: '1 St', city: 'Mumbai', state: 'MH', postalCode: '400706' },
    subtotal: 1000, totalAmount: 1000, status: 'awaiting_payment', paymentStatus: 'pending',
  });
};

describe('Customer bank details', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    if (ORIGINAL_KEY === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
    else process.env.FIELD_ENCRYPTION_KEY = ORIGINAL_KEY;
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  beforeEach(() => { process.env.FIELD_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64'); });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  it('saved on a quotation: encrypted at rest, masked on screen, there on the next quotation and order', async () => {
    const seller = await person('staff', sales(), 'Asha');
    const q1 = await quotation(seller.user);

    expect((await seller.get(`/staff/customer-bank/quotation/${q1._id}`)).body).toMatchObject({ account: null, canReveal: false, hasMobile: true });
    const saved = await seller.put(`/staff/customer-bank/quotation/${q1._id}`, BANK);
    expect(saved.status).toBe(200);
    expect(saved.body.account).toMatchObject({ accountName: 'Big Build Pvt Ltd', accountNumber: 'XXXXXXXX9012', last4: '9012', ifsc: 'HDFC0001234', savedBy: 'Asha' });
    expect(JSON.stringify(saved.body)).not.toContain('123456789012');

    const raw = await CustomerBankAccount.findOne({}).select('+accountNumber').lean();
    expect(isEncrypted(raw.accountNumber)).toBe(true);
    expect(raw.accountNumber).not.toContain('123456789012');
    expect(decryptField(raw.accountNumber)).toBe('123456789012');

    // Same customer, mobile typed differently — next quotation and the order both have it.
    const q2 = await quotation(seller.user, '+91 98209 17286');
    expect((await seller.get(`/staff/customer-bank/quotation/${q2._id}`)).body.account.last4).toBe('9012');
    const o = await order(seller.user, '09820917286');
    const onOrder = await seller.get(`/staff/customer-bank/order/${o._id}`);
    expect(onOrder.body.account.accountNumber).toBe('XXXXXXXX9012');
    expect(onOrder.headers['cache-control']).toMatch(/no-store/);
  });

  it('only accounts and admin see the full number — and each look is audited without it', async () => {
    const seller = await person('staff', sales());
    const accounts = await person('staff', { team: 'accounts', isHead: false, active: true });
    const admin = await person('admin');
    const o = await order(seller.user);
    await seller.put(`/staff/customer-bank/order/${o._id}`, BANK);

    expect((await seller.get(`/staff/customer-bank/order/${o._id}?reveal=1`)).status).toBe(403);
    const acc = await accounts.get(`/staff/customer-bank/order/${o._id}?reveal=1`);
    expect(acc.body).toMatchObject({ canReveal: true, account: { accountNumber: '123456789012' } });
    expect((await admin.get(`/staff/customer-bank/order/${o._id}?reveal=1`)).body.account.accountNumber).toBe('123456789012');
    // Without asking, even accounts sees it masked.
    expect((await accounts.get(`/staff/customer-bank/order/${o._id}`)).body.account.accountNumber).toBe('XXXXXXXX9012');

    await new Promise((r) => setTimeout(r, 50)); // audit writes are fire-and-forget
    const reveals = await AuditLog.find({ action: 'READ_SENSITIVE', resource: 'CustomerBankAccount' }).lean();
    expect(reveals).toHaveLength(2);
    expect(JSON.stringify(await AuditLog.find({}).lean())).not.toContain('123456789012');
  });

  it("a seller reaches only their own customers; a website order is for accounts and admin", async () => {
    const asha = await person('staff', sales());
    const ravi = await person('staff', sales());
    const head = await person('staff', sales(true));
    const ops = await person('staff', { team: 'operations', isHead: false, active: true });
    const accounts = await person('staff', { team: 'accounts', isHead: false, active: true });
    const q = await quotation(asha.user);
    const web = await order(null);

    expect((await ravi.get(`/staff/customer-bank/quotation/${q._id}`)).status).toBe(404);
    expect((await ravi.put(`/staff/customer-bank/quotation/${q._id}`, BANK)).status).toBe(404);
    expect((await ops.get(`/staff/customer-bank/quotation/${q._id}`)).status).toBe(404);
    expect((await head.get(`/staff/customer-bank/quotation/${q._id}`)).status).toBe(200);
    expect((await asha.get(`/staff/customer-bank/order/${web._id}`)).status).toBe(404);
    expect((await accounts.put(`/staff/customer-bank/order/${web._id}`, BANK)).status).toBe(200);
    expect((await asha.get(`/staff/customer-bank/quotation/${new mongoose.Types.ObjectId()}`)).status).toBe(404);
  });

  it('checks the details, and stores only bank fields — never a card', async () => {
    const seller = await person('staff', sales());
    const q = await quotation(seller.user);
    const url = `/staff/customer-bank/quotation/${q._id}`;
    expect((await seller.put(url, { ...BANK, ifsc: 'HDFC1234' })).status).toBe(400);
    expect((await seller.put(url, { ...BANK, accountNumber: '12345', confirmAccountNumber: '12345' })).status).toBe(400);
    expect((await seller.put(url, { ...BANK, confirmAccountNumber: '123456789013' })).status).toBe(400);
    expect((await seller.put(url, { ...BANK, accountName: '' })).status).toBe(400);
    expect(await CustomerBankAccount.countDocuments({})).toBe(0);

    const res = await seller.put(url, { ...BANK, cardNumber: '4111111111111111', cvv: '123', expiry: '12/30' });
    expect(res.status).toBe(200);
    const raw = await CustomerBankAccount.findOne({}).select('+accountNumber').lean();
    expect(Object.keys(raw)).not.toEqual(expect.arrayContaining(['cardNumber']));
    expect(JSON.stringify(raw)).not.toMatch(/4111|cvv|expiry/);
  });

  it('saving again replaces the account; removing forgets it', async () => {
    const seller = await person('staff', sales());
    const q = await quotation(seller.user);
    const url = `/staff/customer-bank/quotation/${q._id}`;
    await seller.put(url, BANK);
    const replaced = await seller.put(url, { ...BANK, accountNumber: '998877665544', confirmAccountNumber: '998877665544', ifsc: 'ICIC0000001' });
    expect(replaced.body.account).toMatchObject({ last4: '5544', ifsc: 'ICIC0000001' });
    expect(await CustomerBankAccount.countDocuments({})).toBe(1);

    expect((await seller.del(url)).body.account).toBeNull();
    expect(await CustomerBankAccount.countDocuments({})).toBe(0);
    expect((await seller.get(url)).body.account).toBeNull();
  });

  it('two first saves at the same moment leave one account', async () => {
    const seller = await person('staff', sales());
    const q = await quotation(seller.user);
    await CustomerBankAccount.syncIndexes();
    const url = `/staff/customer-bank/quotation/${q._id}`;
    const results = await Promise.all([seller.put(url, BANK), seller.put(url, { ...BANK, accountNumber: '998877665544', confirmAccountNumber: '998877665544' })]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await CustomerBankAccount.countDocuments({})).toBe(1);
  });

  it('a customer with no mobile cannot have details saved', async () => {
    const seller = await person('staff', sales());
    const q = await quotation(seller.user);
    await SalesQuotation.updateOne({ _id: q._id }, { $set: { 'customer.phone': '022 2345 6789' } });
    expect((await seller.get(`/staff/customer-bank/quotation/${q._id}`)).body).toMatchObject({ hasMobile: false, account: null });
    expect((await seller.put(`/staff/customer-bank/quotation/${q._id}`, BANK)).status).toBe(422);
  });

  it('with no encryption key configured it refuses — nothing stored in plaintext', async () => {
    const seller = await person('staff', sales());
    const q = await quotation(seller.user);
    delete process.env.FIELD_ENCRYPTION_KEY;
    expect((await seller.put(`/staff/customer-bank/quotation/${q._id}`, BANK)).status).toBe(503);
    expect(await CustomerBankAccount.countDocuments({})).toBe(0);
  });
});

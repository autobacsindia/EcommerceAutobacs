/**
 * Bank transfers over HTTP (routes/staff.js): multipart upload, validation, CSRF
 * and auth are real; Razorpay link cancelling and private storage are doubles.
 * The rules themselves are in bankTransfers.test.js — this proves the wiring.
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));
const stored = new Map();
const storageMock = {
  resourceTypeFor: (t) => (String(t).startsWith('image/') ? 'image' : 'raw'),
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    const publicId = `${folder}/${basename}`;
    stored.set(publicId, buffer);
    return { publicId, provider: 'r2', bytes: buffer.length, url: '' };
  },
  deletePrivateAsset: async ({ publicId }) => { stored.delete(publicId); return true; },
  readPrivateAsset: async (ref) => stored.get(ref.publicId),
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Order } = await import('../models/Order.js');
const { default: BankTransfer } = await import('../models/BankTransfer.js');
const { default: razorpayService } = await import('../services/razorpayService.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(300, 1)]);

const csrfFrom = (res) => {
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    form: (url, fields = {}, files = []) => {
      let r = agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, String(v));
      for (const f of files) r = r.attach('proof', f.buffer, { filename: f.name, contentType: f.type });
      return r;
    },
  };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, session: await signIn(email) };
};
const shot = (i = 0) => ({ buffer: JPEG, name: `t${i}.jpg`, type: 'image/jpeg' });

describe('Bank transfer routes', () => {
  beforeAll(async () => { await dbHandler.connect(); await BankTransfer.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { stored.clear(); jest.restoreAllMocks(); await dbHandler.clearDatabase(); });

  let accounts, lead, order;
  beforeEach(async () => {
    jest.spyOn(razorpayService, 'cancelPaymentLink').mockResolvedValue({ status: 'cancelled' });
    jest.spyOn(razorpayService, '_afterOrderPaid').mockImplementation(() => {});
    accounts = await makeUser('Anu', 'staff', { team: 'accounts', isHead: false, active: true });
    lead = await makeUser('Sam', 'staff', { team: 'sales', isHead: false, active: true });
    order = await Order.create({
      user: new mongoose.Types.ObjectId(), source: 'offline', salesUser: lead.user._id,
      items: [{ product: new mongoose.Types.ObjectId(), name: 'Lift kit', price: 52000, quantity: 1 }],
      shippingAddress: { fullName: 'Ravi Kumar', phone: '9812345678', addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      subtotal: 52000, totalAmount: 52000, status: 'awaiting_payment', paymentStatus: 'pending',
    });
  });

  const fields = { amount: 52000, reference: 'UTR123456789012', paidOn: new Date().toISOString().slice(0, 10) };

  it('refuses a request whose files add up to more than 40 MB before reading it', async () => {
    const big = { buffer: Buffer.concat([JPEG, Buffer.alloc(9 * 1024 * 1024)]), name: 'big.jpg', type: 'image/jpeg' };
    const res = await lead.session.form(`/staff/sales/orders/${order._id}/bank-transfer`, fields, [big, big, big, big, big]);
    expect(res.status).toBe(413);
    expect(res.body.message).toBe('These files add up to more than 40 MB. Send fewer at a time.');
    expect(stored.size).toBe(0);
  });

  it('records with up to twenty screenshots, then accounts confirms; the order is paid', async () => {
    const tooMany = await lead.session.form(`/staff/sales/orders/${order._id}/bank-transfer`, fields, Array.from({ length: 21 }, (_, i) => shot(i)));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.message).toBe('You can attach up to 20 files at a time.');
    expect(stored.size).toBe(0);

    const fakePdf = await lead.session.form(`/staff/sales/orders/${order._id}/bank-transfer`, fields,
      [{ buffer: Buffer.from('MZ\x90\x00 not a pdf'), name: 'statement.pdf', type: 'application/pdf' }]);
    expect(fakePdf.status).toBe(400);
    expect(fakePdf.body.message).toMatch(/"statement.pdf" is not a photo/);
    const exe = await lead.session.form(`/staff/sales/orders/${order._id}/bank-transfer`, fields,
      [{ buffer: Buffer.from('MZ'), name: 'pay.exe', type: 'application/x-msdownload' }]);
    expect(exe.status).toBe(400);
    expect(exe.body.message).toMatch(/"pay.exe" is not a photo \(JPG, PNG, WebP\) or a PDF/);
    expect(stored.size).toBe(0);

    const pdf = { buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]), name: 'statement.pdf', type: 'application/pdf' };
    const res = await lead.session.form(`/staff/sales/orders/${order._id}/bank-transfer`, fields, [...Array.from({ length: 19 }, (_, i) => shot(i)), pdf]);
    expect(res.status).toBe(201);
    expect(res.body.transfer.files).toHaveLength(20);
    const id = res.body.transfer.id;

    // The seller sees it, and can open the screenshot — privately.
    expect((await lead.session.get('/staff/bank-transfers')).body.transfers.map((t) => t.id)).toEqual([id]);
    const file = await lead.session.get(`/staff/bank-transfers/${id}/files/${res.body.transfer.files[0].id}`);
    expect(file.status).toBe(200);
    expect(file.headers['cache-control']).toBe('private, no-store');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    // A PDF opens in the browser tab, through the same permission-checked proxy.
    const pdfFile = await lead.session.get(`/staff/bank-transfers/${id}/files/${res.body.transfer.files[19].id}`);
    expect(pdfFile.status).toBe(200);
    expect(pdfFile.headers['content-type']).toBe('application/pdf');
    expect(pdfFile.headers['content-disposition']).toBe('inline; filename="statement.pdf"');
    // Someone outside the order cannot open it.
    const other = await makeUser('Ops', 'staff', { team: 'operations', isHead: false, active: true });
    expect((await other.session.get(`/staff/bank-transfers/${id}/files/${res.body.transfer.files[19].id}`)).status).toBe(403);

    expect((await lead.session.post(`/staff/bank-transfers/${id}/confirm`)).status).toBe(403);
    const ok = await accounts.session.post(`/staff/bank-transfers/${id}/confirm`);
    expect(ok.status).toBe(200);
    expect(ok.body.transfer.status).toBe('confirmed');
    expect((await Order.findById(order._id).lean()).paymentStatus).toBe('paid');
  });

  it('validates ids, filters and the rejection reason', async () => {
    expect((await accounts.session.get('/staff/bank-transfers?status=weird')).status).toBe(400);
    expect((await accounts.session.get('/staff/bank-transfers/not-an-id')).status).toBe(400);
    expect((await accounts.session.post('/staff/bank-transfers/not-an-id/confirm')).status).toBe(400);
    const res = await lead.session.form(`/staff/sales/orders/${order._id}/bank-transfer`, fields, [shot()]);
    const id = res.body.transfer.id;
    expect((await accounts.session.post(`/staff/bank-transfers/${id}/reject`, {})).status).toBe(400);
    expect((await accounts.session.post(`/staff/bank-transfers/${id}/reject`, { note: 'Not in statement' })).body.transfer.status).toBe('rejected');
  });

  it('needs a signed-in staff member', async () => {
    expect((await request(app).get(`${BASE}/staff/bank-transfers`)).status).toBe(401);
  });
});

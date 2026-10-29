/**
 * Past (offline) sales over HTTP (routes/pastSales.js): auth, CSRF, validation,
 * the CSV upload and the lead page's past purchases are real. The rules
 * themselves are in pastSales.test.js — this proves the wiring.
 */
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';

jest.setTimeout(120000);

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
const { default: Lead } = await import('../models/Lead.js');
const { default: PastSale } = await import('../models/PastSale.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const HEADER = 'Sale date,Bill no,Customer name,Customer phone,Item,Quantity,Price per unit,Discount,Total paid,Payment method';

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
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    del: (url) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf),
    upload: (url, text, fields = {}) => {
      let r = agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, String(v));
      return r.attach('file', Buffer.from(text), { filename: 'sales.csv', contentType: 'text/csv' });
    },
  };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876500000', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, session: await signIn(email) };
};

const sale = (over = {}) => ({
  saleDate: '2024-03-14',
  invoiceNo: 'AB-1',
  customer: { name: 'Arun Kumar', phone: '9876543210' },
  items: [{ name: 'Mats', quantity: 1, price: 6500 }],
  totalAmount: 6500,
  paymentMethod: 'cash',
  ...over,
});

describe('Past sales routes', () => {
  beforeAll(async () => { await dbHandler.connect(); await PastSale.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  let accounts, lead, ops, admin;
  beforeEach(async () => {
    accounts = await makeUser('Anu', 'staff', { team: 'accounts', isHead: false, active: true });
    lead = await makeUser('Sam', 'staff', { team: 'sales', isHead: false, active: true });
    ops = await makeUser('Omar', 'staff', { team: 'operations', isHead: false, active: true });
    admin = await makeUser('Owner', 'admin');
  });

  it('a salesman adds, lists, edits; accounts deletes and restores', async () => {
    const created = await lead.session.post('/staff/past-sales', sale());
    expect(created.status).toBe(201);
    const { id, version } = created.body.sale;

    const list = await lead.session.get('/staff/past-sales');
    expect(list.body.sales.map((s) => s.id)).toEqual([id]);
    expect((await lead.session.get(`/staff/past-sales/${id}`)).body.sale.history).toHaveLength(1);

    const edited = await lead.session.put(`/staff/past-sales/${id}`, { ...sale({ notes: 'Fitted' }), version });
    expect(edited.status).toBe(200);
    expect(edited.body.sale.notes).toBe('Fitted');
    expect((await lead.session.put(`/staff/past-sales/${id}`, { ...sale({ notes: 'stale' }), version })).status).toBe(409);

    expect((await lead.session.del(`/staff/past-sales/${id}`)).status).toBe(403);
    const deleted = await accounts.session.del(`/staff/past-sales/${id}`);
    expect(deleted.body.sale.deleted).toMatchObject({ by: 'Anu' });
    expect((await accounts.session.post(`/staff/past-sales/${id}/restore`)).body.sale.deleted).toBeNull();

    const totals = await admin.session.get('/staff/past-sales/totals?from=2024-01-01&to=2024-12-31');
    expect(totals.body.total).toEqual({ sales: 1, value: 6500 });
  });

  it('a bad sale is a 400 with the reason; a repeated bill a 409', async () => {
    const bad = await lead.session.post('/staff/past-sales', sale({ totalAmount: '' }));
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('Enter the total amount paid.');
    expect((await lead.session.post('/staff/past-sales', sale())).status).toBe(201);
    const again = await lead.session.post('/staff/past-sales', sale());
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/Bill AB-1 is already entered/);
  });

  it('validates ids and filters', async () => {
    expect((await lead.session.get('/staff/past-sales/not-an-id')).status).toBe(400);
    expect((await lead.session.get('/staff/past-sales?from=14-03-2024')).status).toBe(400);
    expect((await lead.session.get('/staff/past-sales?deleted=yes')).status).toBe(400);
    expect((await lead.session.post('/staff/past-sales', { items: 'x' })).status).toBe(400);
    expect((await accounts.session.del('/staff/past-sales/uploads/nope')).status).toBe(400);
  });

  it('uploads a CSV: preview writes nothing, import adds the sales, the template downloads', async () => {
    const text = [HEADER, '14/03/2024,AB-1,Arun,9876543210,Mats,1,6500,0,6500,GPay', '15/03/2024,,Bina,,Wiper,2,450,0,900,Cash'].join('\n');
    const preview = await lead.session.upload('/staff/past-sales/upload/preview', text);
    expect(preview.status).toBe(200);
    expect(preview.body.counts).toEqual({ rows: 2, sales: 2, ready: 2, duplicates: 0, errors: 0 });
    expect(await PastSale.countDocuments()).toBe(0);

    const imported = await lead.session.upload('/staff/past-sales/upload', text);
    expect(imported.body.counts).toMatchObject({ imported: 2 });
    expect((await lead.session.upload('/staff/past-sales/upload', text)).body.counts).toMatchObject({ imported: 0, duplicates: 2 });
    expect(await PastSale.countDocuments()).toBe(2);

    const undo = await accounts.session.del(`/staff/past-sales/uploads/${imported.body.batchId}`);
    expect(undo.body).toEqual({ success: true, deleted: 2 });

    const tpl = await lead.session.get('/staff/past-sales/template');
    expect(tpl.status).toBe(200);
    expect(tpl.headers['content-type']).toMatch(/text\/csv/);
    expect(tpl.text).toMatch(/Sale date,Bill no,Customer name/);
  });

  it('an upload with no file, or a file that is not a sheet, is a 400 with words', async () => {
    const none = await lead.session.post('/staff/past-sales/upload/preview');
    expect(none.status).toBe(400);
    expect(none.body.message).toBe('Choose the CSV file to upload.');
    const junk = await lead.session.upload('/staff/past-sales/upload/preview', 'hello,world\n1,2');
    expect(junk.status).toBe(400);
    expect(junk.body.message).toMatch(/columns are missing/);
  });

  it('other teams get 403; signed-out gets 401', async () => {
    expect((await ops.session.get('/staff/past-sales')).status).toBe(403);
    expect((await ops.session.post('/staff/past-sales', sale())).status).toBe(403);
    expect((await request(app).get(`${BASE}/staff/past-sales`)).status).toBe(401);
  });

  it("the lead page shows the customer's past purchases, matched by phone", async () => {
    await lead.session.post('/staff/past-sales', sale({ customer: { name: 'Arun', phone: '+91 98765 43210' } }));
    const crm = await Lead.create({ identityKey: 'phone:9876543210', phone: '09876543210', name: 'Arun', status: 'new' });
    const res = await admin.session.get(`/leads/${crm._id}`);
    expect(res.status).toBe(200);
    expect(res.body.pastSales).toEqual([expect.objectContaining({ saleDate: '2024-03-14', invoiceNo: 'AB-1', totalAmount: 6500, soldBy: 'Sam' })]);
  });
});

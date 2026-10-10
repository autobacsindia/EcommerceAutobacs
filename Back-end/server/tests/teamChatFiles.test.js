/**
 * Team chat stage 2/3 — attachments, @mentions, order references and the
 * automatic business posts.
 *
 * Cloudinary is mocked: what is asserted here is OUR behaviour (which file
 * types are accepted, that the bytes must match the claimed type, who can see a
 * shared file, that a retried business event posts once), not the vendor's
 * upload. Separate from teamChat.test.js because mocking a module has to happen
 * before app.js is imported.
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

const uploaded = [];
const fakeUpload = (buffer, { folder } = {}) => {
  const publicId = `${folder}/mock-${uploaded.length + 1}`;
  uploaded.push(publicId);
  return Promise.resolve({ secure_url: `https://mock.cloudinary/${publicId}`, public_id: publicId });
};
const deleted = [];

jest.unstable_mockModule('../utils/cloudinaryHelpers.js', () => ({
  uploadToCloudinary: (...args) => fakeUpload(...args),
  uploadRawToCloudinary: (...args) => fakeUpload(...args),
  uploadManyToCloudinary: jest.fn(),
  deleteFromCloudinary: (publicId) => { deleted.push(publicId); return Promise.resolve(); },
  deleteManyFromCloudinary: jest.fn(),
  buildOptimizedUrl: (publicId) => `https://mock.cloudinary/${publicId}`,
  generateUploadSignature: ({ folder = 'general' } = {}) => ({
    cloudName: 'test-cloud', apiKey: 'test-key', timestamp: 1700000000, folder,
    allowedFormats: 'jpg,jpeg,png,webp', signature: 'test-sig',
  }),
}));

// eslint-disable-next-line import/first
const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const User = (await import('../models/User.js')).default;
const Order = (await import('../models/Order.js')).default;
const emailHandler = (await import('../services/emailHandler.js')).default;
const { postBusinessUpdate } = await import('../services/chatBusinessUpdates.js');

const BASE = '/api/v1';
const PASSWORD = 'SecurePass123!';

const csrfFrom = (res) => {
  const xsrf = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return xsrf ? xsrf.split(';')[0].split('=')[1] : '';
};

async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    del: (url) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf),
    /** Multipart send: text fields plus attachments, as the browser does it. */
    upload: (url, fields = {}, files = []) => {
      let req = agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
      for (const [k, v] of Object.entries(fields)) {
        req = req.field(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
      }
      for (const f of files) req = req.attach('files', f.buffer, { filename: f.name, contentType: f.type });
      return req;
    },
  };
}

const staff = (team, isHead = false) => ({ team, isHead, active: true });

const createUser = async ({ name, email, role = 'customer', staff: s }) =>
  User.create({ name, email, role, staff: s, phone: '9876543210', passwordHash: await bcrypt.hash(PASSWORD, 4) });

const ADDRESS = {
  fullName: 'Order Test User', addressLine1: '123 Test St', city: 'Kochi',
  state: 'Kerala', postalCode: '682001', country: 'India', phone: '9876543210',
};

const sampleOrder = (over = {}) => ({
  user: new mongoose.Types.ObjectId(),
  items: [{ name: 'Bushranger Winch', quantity: 1, price: 150000, product: new mongoose.Types.ObjectId() }],
  shippingAddress: ADDRESS,
  subtotal: 150000,
  totalAmount: 150000,
  paymentStatus: 'paid',
  status: 'processing',
  ...over,
});

const spaceId = (channels, key) => channels.find((c) => c.key === key)?.id;

// A 1x1 PNG header — enough for the magic-byte check the service performs.
const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('body')]);

describe('Team chat — files, mentions, order refs, automatic updates', () => {
  let admin, salesHead, accounts, users, company;

  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { jest.restoreAllMocks(); await dbHandler.clearDatabase(); });

  beforeEach(async () => {
    uploaded.length = 0;
    deleted.length = 0;
    users = {
      admin: await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' }),
      salesHead: await createUser({ name: 'Sana', email: 'sana@example.com', role: 'staff', staff: staff('sales', true) }),
      accounts: await createUser({ name: 'Anu', email: 'anu@example.com', role: 'staff', staff: staff('accounts', true) }),
    };
    admin = await signIn('owner@example.com');
    salesHead = await signIn('sana@example.com');
    accounts = await signIn('anu@example.com');
    company = spaceId((await admin.get('/chat/channels')).body.channels, 'company');
  });

  describe('files', () => {
    it('shares a photo and lists it in the channel Files tab', async () => {
      const res = await salesHead.upload(`/chat/channels/${company}/messages`, { text: 'Damage photo' },
        [{ buffer: PNG, name: 'damage.png', type: 'image/png' }]);
      expect(res.status).toBe(201);
      expect(res.body.message.attachments).toEqual([
        expect.objectContaining({ kind: 'image', name: 'damage.png', mime: 'image/png' }),
      ]);

      const files = await accounts.get(`/chat/channels/${company}/files`);
      expect(files.body.files).toHaveLength(1);
      expect(files.body.files[0]).toMatchObject({ name: 'damage.png', sharedBy: { name: 'Sana' } });
    });

    it('a PDF is stored as a download, not an inline image', async () => {
      const res = await accounts.upload(`/chat/channels/${company}/messages`, { text: 'Invoice' },
        [{ buffer: PDF, name: 'invoice.pdf', type: 'application/pdf' }]);
      expect(res.body.message.attachments[0]).toMatchObject({ kind: 'file', name: 'invoice.pdf' });
    });

    it('a photo with no text is a valid message; nothing at all is not', async () => {
      const ok = await salesHead.upload(`/chat/channels/${company}/messages`, {},
        [{ buffer: PNG, name: 'photo.png', type: 'image/png' }]);
      expect(ok.status).toBe(201);
      expect((await salesHead.post(`/chat/channels/${company}/messages`, { text: '   ' })).status).toBe(400);
    });

    it('refuses a disallowed type, and a file whose bytes contradict its name', async () => {
      const exe = await salesHead.upload(`/chat/channels/${company}/messages`, { text: 'x' },
        [{ buffer: Buffer.from('MZ binary'), name: 'virus.exe', type: 'application/x-msdownload' }]);
      expect(exe.status).toBe(400);

      const fake = await salesHead.upload(`/chat/channels/${company}/messages`, { text: 'x' },
        [{ buffer: Buffer.from('definitely not a pdf'), name: 'invoice.pdf', type: 'application/pdf' }]);
      expect(fake.status).toBe(400);
      expect(fake.body.message).toMatch(/does not look like a real PDF/i);
      expect(uploaded).toHaveLength(0); // rejected before anything was stored
    });

    it('keeps files in a team space invisible to other teams', async () => {
      const sales = spaceId((await admin.get('/chat/channels')).body.channels, 'team:sales');
      await salesHead.upload(`/chat/channels/${sales}/messages`, { text: 'quote' },
        [{ buffer: PNG, name: 'quote.png', type: 'image/png' }]);
      expect((await accounts.get(`/chat/channels/${sales}/files`)).status).toBe(404);
    });

    it('deleting the message removes its files from the Files tab', async () => {
      const sent = await salesHead.upload(`/chat/channels/${company}/messages`, { text: 'oops' },
        [{ buffer: PNG, name: 'wrong.png', type: 'image/png' }]);
      await salesHead.del(`/chat/messages/${sent.body.message.id}`);
      expect((await admin.get(`/chat/channels/${company}/files`)).body.files).toHaveLength(0);
      const msgs = await admin.get(`/chat/channels/${company}/messages`);
      expect(msgs.body.messages[0]).toMatchObject({ deleted: true, attachments: [] });
    });
  });

  describe('mentions', () => {
    it('drops a mention of someone who cannot see the channel', async () => {
      const sales = spaceId((await admin.get('/chat/channels')).body.channels, 'team:sales');
      const res = await salesHead.post(`/chat/channels/${sales}/messages`, {
        text: 'please look', mentions: [String(users.accounts._id), String(users.admin._id)],
      });
      // Admins see every space; the accounts head cannot see #sales.
      expect(res.body.message.mentions).toEqual([String(users.admin._id)]);
    });

    it('emails someone mentioned who does not have chat open', async () => {
      const send = jest.spyOn(emailHandler, 'sendEmail').mockResolvedValue({ success: true });
      await salesHead.post(`/chat/channels/${company}/messages`, {
        text: 'Anu, can you confirm?', mentions: [String(users.accounts._id)],
      });
      await new Promise((r) => setTimeout(r, 200)); // the email is fire-and-forget
      expect(send).toHaveBeenCalledWith(expect.objectContaining({
        to: 'anu@example.com',
        subject: expect.stringContaining('mentioned you'),
      }));
    });

    it('never emails you about your own mention', async () => {
      const send = jest.spyOn(emailHandler, 'sendEmail').mockResolvedValue({ success: true });
      await salesHead.post(`/chat/channels/${company}/messages`, {
        text: 'note to self', mentions: [String(users.salesHead._id)],
      });
      await new Promise((r) => setTimeout(r, 200));
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('order references', () => {
    it('attaches a real order and ignores an unknown id', async () => {
      const order = await Order.create(sampleOrder());
      const res = await salesHead.post(`/chat/channels/${company}/messages`, {
        text: 'Shipping today', orderIds: [String(order._id), '0'.repeat(24)],
      });
      expect(res.body.message.refs).toHaveLength(1);
      expect(res.body.message.refs[0]).toMatchObject({ type: 'order', id: String(order._id) });
      expect(res.body.message.refs[0].code).toMatch(/^#/);
    });

    it('the picker lists paid orders only', async () => {
      await Order.create(sampleOrder({ paymentStatus: 'pending' }));
      const paid = await Order.create(sampleOrder({ shippingAddress: { ...ADDRESS, fullName: 'Ravi Kumar' } }));
      const { body } = await accounts.get('/chat/orders/recent');
      expect(body.orders).toHaveLength(1);
      expect(body.orders[0]).toMatchObject({ id: String(paid._id), customer: 'Ravi Kumar' });
    });
  });

  describe('automatic business updates', () => {
    it('a paid order posts once in #operations, even when the job retries', async () => {
      const order = await Order.create(sampleOrder());
      await postBusinessUpdate('send-staff-sales-paid-alert', { orderId: String(order._id) });
      await postBusinessUpdate('send-staff-sales-paid-alert', { orderId: String(order._id) });

      const ops = spaceId((await admin.get('/chat/channels')).body.channels, 'team:operations');
      const { body } = await admin.get(`/chat/channels/${ops}/messages`);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0]).toMatchObject({ kind: 'system', sender: null });
      expect(body.messages[0].text).toMatch(/Paid order #/);
      expect(body.messages[0].refs[0]).toMatchObject({ id: String(order._id) });
    });

    it('routes each event to its own team space', async () => {
      const order = await Order.create(sampleOrder());
      await postBusinessUpdate('send-team-refund-requested-alert', {
        orderId: String(order._id), itemId: String(order.items[0]._id),
      });
      const channels = (await admin.get('/chat/channels')).body.channels;
      const textsIn = async (key) =>
        (await admin.get(`/chat/channels/${spaceId(channels, key)}/messages`)).body.messages.map((m) => m.text);
      expect((await textsIn('team:accounts')).join()).toMatch(/Refund requested/);
      expect(await textsIn('team:operations')).toHaveLength(0);
    });

    it('a missing record or unknown event is a no-op, never a throw', async () => {
      await expect(postBusinessUpdate('send-staff-sales-paid-alert', { orderId: '0'.repeat(24) })).resolves.toBeNull();
      await expect(postBusinessUpdate('not-a-chat-event', {})).resolves.toBeNull();
    });
  });
});

/**
 * Team chat: screenshots on the site's own storage, and managing group members.
 *
 *   - with STORAGE_PROVIDER=r2 (production), a shared photo goes to the PRIVATE
 *     bucket — never Cloudinary, whose account can be switched off — and is read
 *     back through /chat/channels/:id/files/:name by people in that channel only
 *   - a custom group's members are added / removed by the admin or the person
 *     who created it; other members cannot; team spaces have no member list
 */
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';

const stored = new Map();
const cloudinaryCalls = [];
const storageMock = {
  resourceTypeFor: (t) => (String(t).startsWith('image/') ? 'image' : 'raw'),
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    const publicId = `${folder}/${basename}`;
    stored.set(publicId, buffer);
    return { publicId, provider: 'r2', bytes: buffer.length, resourceType: 'image', url: '' };
  },
  deletePrivateAsset: async ({ publicId }) => { stored.delete(publicId); return true; },
  readPrivateAsset: async (ref) => {
    if (!stored.has(ref.publicId)) throw new Error('NoSuchKey');
    return stored.get(ref.publicId);
  },
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));
jest.unstable_mockModule('../utils/cloudinaryHelpers.js', () => {
  const boom = (...a) => { cloudinaryCalls.push(a); return Promise.reject(new Error('cloud_name is disabled')); };
  return {
    uploadToCloudinary: boom, uploadRawToCloudinary: boom, uploadManyToCloudinary: boom,
    deleteFromCloudinary: () => Promise.resolve(), deleteManyFromCloudinary: () => Promise.resolve(),
    buildOptimizedUrl: (id) => id,
    generateUploadSignature: () => ({}),
  };
});

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const User = (await import('../models/User.js')).default;

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');

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
    raw: (url) => agent.get(url),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    del: (url) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf),
    upload: (url, fields, files) => {
      let r = agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, String(v));
      for (const f of files) r = r.attach('files', f.buffer, { filename: f.name, contentType: f.type });
      return r;
    },
  };
}
let n = 0;
const person = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@example.com`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, s: await signIn(email) };
};
const staff = (team, isHead = false) => ({ team, isHead, active: true });
const channelsOf = async (s) => (await s.get('/chat/channels')).body.channels;

describe('Team chat — own storage and group members', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    delete process.env.STORAGE_PROVIDER;
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  beforeEach(() => { process.env.STORAGE_PROVIDER = 'r2'; stored.clear(); cloudinaryCalls.length = 0; });
  afterEach(async () => { await dbHandler.clearDatabase(); });

  describe('screenshots', () => {
    it('a photo goes to private storage (not Cloudinary) and only people in the channel can open it', async () => {
      const buyer = await person('Priya', 'staff', staff('procurement'));
      const mate = await person('Pavan', 'staff', staff('procurement'));
      const sales = await person('Sana', 'staff', staff('sales'));
      const team = (await channelsOf(buyer.s)).find((c) => c.key === 'team:procurement');

      const res = await buyer.s.upload(`/chat/channels/${team.id}/messages`, { text: '', clientId: '1e777eb2-3395-4f4d-9723-532ee8e65fd6' },
        [{ buffer: PNG, name: 'Screenshot 2026-10-24.png', type: 'image/png' }]);
      expect(res.status).toBe(201);
      expect(cloudinaryCalls).toHaveLength(0);
      const [a] = res.body.message.attachments;
      expect(a).toMatchObject({ kind: 'image', mime: 'image/png' });
      expect(a.url).toMatch(new RegExp(`^/api/v1/chat/channels/${team.id}/files/\\d{13}-[a-f0-9]{8}-Screenshot`));
      expect([...stored.keys()][0]).toMatch(new RegExp(`^chat/${team.id}/`));

      const seen = await mate.s.raw(a.url);
      expect(seen.status).toBe(200);
      expect(seen.headers['content-type']).toMatch(/^image\/png/);
      expect(seen.headers['cache-control']).toMatch(/private/);
      expect(Buffer.compare(seen.body, PNG)).toBe(0);
      expect((await sales.s.raw(a.url)).status).toBe(404); // not in procurement's space
      expect((await request(app).get(a.url)).status).toBe(401);
    });

    it('refuses names that are not a stored file', async () => {
      const buyer = await person('Priya', 'staff', staff('procurement'));
      const team = (await channelsOf(buyer.s)).find((c) => c.key === 'team:procurement');
      expect((await buyer.s.get(`/chat/channels/${team.id}/files/..%2F..%2Fpayment-requests%2Fx.png`)).status).toBe(404);
      expect((await buyer.s.get(`/chat/channels/${team.id}/files/1792000000000-abcdef12-missing.png`)).status).toBe(404);
    });
  });

  describe('group members', () => {
    async function group() {
      const admin = await person('Owner', 'admin');
      const head = await person('Hari', 'staff', staff('procurement', true));
      const member = await person('Mona', 'staff', staff('procurement'));
      const later = await person('Lata', 'staff', staff('accounts'));
      const created = await head.s.post('/chat/channels', { name: 'supplier-calls', memberIds: [String(member.user._id)] });
      expect(created.status).toBe(201);
      return { admin, head, member, later, id: created.body.channel.id };
    }

    it('the creator adds someone after creating the group; they then see it', async () => {
      const { head, later, id } = await group();
      expect((await channelsOf(later.s)).some((c) => c.id === id)).toBe(false);
      const res = await head.s.post(`/chat/channels/${id}/members`, { userIds: [String(later.user._id)] });
      expect(res.status).toBe(200);
      expect(res.body.members.map((m) => m.name).sort()).toEqual(['Hari', 'Lata', 'Mona']);
      const mine = (await channelsOf(later.s)).find((c) => c.id === id);
      expect(mine).toBeTruthy();
      expect(mine.canManageMembers).toBe(false);
      expect((await channelsOf(head.s)).find((c) => c.id === id).canManageMembers).toBe(true);
    });

    it('the admin can manage any group; an ordinary member cannot', async () => {
      const { admin, member, later, id } = await group();
      expect((await member.s.post(`/chat/channels/${id}/members`, { userIds: [String(later.user._id)] })).status).toBe(403);
      expect((await admin.s.post(`/chat/channels/${id}/members`, { userIds: [String(later.user._id)] })).status).toBe(200);
      expect((await member.s.get(`/chat/channels/${id}/members`)).body.canManage).toBe(false);
    });

    it('removes a member (who then loses the group), but never the creator', async () => {
      const { head, member, id } = await group();
      const res = await head.s.del(`/chat/channels/${id}/members/${member.user._id}`);
      expect(res.status).toBe(200);
      expect((await member.s.get(`/chat/channels/${id}/messages`)).status).toBe(404);
      expect((await head.s.del(`/chat/channels/${id}/members/${head.user._id}`)).status).toBe(400);
    });

    it('team spaces have no member list to edit, and a customer account cannot be added', async () => {
      const { admin, head, id } = await group();
      const team = (await channelsOf(head.s)).find((c) => c.key === 'team:procurement');
      expect((await admin.s.post(`/chat/channels/${team.id}/members`, { userIds: [String(head.user._id)] })).status).toBe(400);
      const customer = await User.create({ name: 'Cust', email: 'cust@example.com', role: 'customer', phone: '9876543210', passwordHash: 'x' });
      expect((await head.s.post(`/chat/channels/${id}/members`, { userIds: [String(customer._id)] })).status).toBe(400);
    });
  });
});

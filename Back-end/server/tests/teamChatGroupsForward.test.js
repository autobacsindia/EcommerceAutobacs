/**
 * Group conversations, @all, and Forward (chatService.openConversation,
 * mayMentionAll, forwardMessage).
 *
 * What must hold:
 *   - anyone can start a conversation with 2-7 others; it is private to its
 *     members (admins are NOT implicitly in), and opening the same people
 *     again — even at the same moment — reuses the one conversation;
 *   - @all reaches everyone in the conversation, but in #company only admins
 *     and heads may use it; on "@mentions only" it still counts as a mention;
 *   - Forward copies text, files and order links into a conversation the
 *     caller can read — never out of one they cannot — and never reveals the
 *     source conversation, never re-pings the original's mentions, and a
 *     retry is one forward; forwarded files are readable by the new readers.
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
const emailHandler = (await import('../services/emailHandler.js')).default;
const { postSystemMessage } = await import('../services/chatService.js');

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
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
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
  const email = `${name.toLowerCase().replace(/\s+/g, '.')}${n}@example.com`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, s: await signIn(email) };
};
const staff = (team, isHead = false) => ({ team, isHead, active: true });
const channelsOf = async (s) => (await s.get('/chat/channels')).body.channels;


describe('Group conversations, @all, and Forward', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    delete process.env.STORAGE_PROVIDER;
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  beforeEach(() => { process.env.STORAGE_PROVIDER = 'r2'; stored.clear(); cloudinaryCalls.length = 0; });
  afterEach(async () => { await dbHandler.clearDatabase(); jest.restoreAllMocks(); });

  let sam, anu, ravi, priya, head, admin;
  beforeEach(async () => {
    sam = await person('Sam Kumar', 'staff', staff('sales'));
    anu = await person('Anu', 'staff', staff('accounts'));
    ravi = await person('Ravi', 'staff', staff('operations'));
    priya = await person('Priya', 'staff', staff('procurement'));
    head = await person('Sana', 'staff', staff('sales', true));
    admin = await person('Owner', 'admin');
  });

  let k = 0;
  const say = async (who, channelId, body) => {
    const res = await who.s.post(`/chat/channels/${channelId}/messages`, { clientId: `grp-${++k}-test`, ...body });
    expect(res.status).toBe(201);
    return res.body.message;
  };
  const open = (who, others) => who.s.post('/chat/dm', { userIds: others.map((p) => String(p.user._id)) });
  const space = async (who, key) => (await channelsOf(who.s)).find((c) => c.key === key);

  describe('group conversations', () => {
    it('anyone can start one; it is named after the others and shows who is in it', async () => {
      const res = await open(sam, [anu, ravi]);
      expect(res.status).toBe(200);
      const id = res.body.channel.id;

      const mine = (await channelsOf(sam.s)).find((c) => c.id === id);
      expect(mine).toMatchObject({ kind: 'dm', name: 'Anu and Ravi', group: true, memberCount: 3, partner: null });
      expect(mine.memberIds.sort()).toEqual([sam, anu, ravi].map((p) => String(p.user._id)).sort());
      expect((await channelsOf(anu.s)).find((c) => c.id === id).name).toBe('Sam and Ravi');
    });

    it('is private: members only — not an admin, not anyone else', async () => {
      const { id } = (await open(sam, [anu, ravi])).body.channel;
      await say(anu, id, { text: 'just us three' });
      expect((await ravi.s.get(`/chat/channels/${id}/messages`)).body.messages[0].text).toBe('just us three');
      expect((await admin.s.get(`/chat/channels/${id}/messages`)).status).toBe(404);
      expect((await priya.s.get(`/chat/channels/${id}/messages`)).status).toBe(404);
      expect((await channelsOf(admin.s)).some((c) => c.id === id)).toBe(false);
    });

    it('the same people again — in any order, from anyone in it, even at once — is the same conversation', async () => {
      const [a, b] = await Promise.all([open(sam, [anu, ravi]), open(ravi, [sam, anu])]);
      expect(a.body.channel.id).toBe(b.body.channel.id);
      expect((await open(anu, [ravi, sam])).body.channel.id).toBe(a.body.channel.id);
      // A different set of people is a different conversation; one person is a plain DM.
      expect((await open(sam, [anu, ravi, priya])).body.channel.id).not.toBe(a.body.channel.id);
      const dm = (await open(sam, [anu])).body.channel.id;
      expect((await sam.s.post('/chat/dm', { userId: String(anu.user._id) })).body.channel.id).toBe(dm);
      const plain = (await channelsOf(sam.s)).find((c) => c.id === dm);
      expect(plain.name).toBe('Anu');
      expect(plain.group).toBeUndefined();
    });

    it('allows up to 8 people in all', async () => {
      const crowd = [];
      for (let i = 0; i < 8; i += 1) crowd.push(await person(`P${i}`, 'staff', staff('sales')));
      expect((await open(sam, crowd.slice(0, 7))).status).toBe(200);
      expect((await open(sam, crowd)).status).toBe(400);
    });

    it('refuses nobody, only yourself, unknown people, and customers', async () => {
      expect((await sam.s.post('/chat/dm', {})).status).toBe(400);
      expect((await sam.s.post('/chat/dm', { userIds: [] })).status).toBe(400);
      expect((await sam.s.post('/chat/dm', { userIds: [String(sam.user._id)] })).status).toBe(400);
      expect((await sam.s.post('/chat/dm', { userIds: [String(anu.user._id), '64b7f0f0f0f0f0f0f0f0f0f0'] })).status).toBe(404);
      const cara = await person('Cara', 'customer');
      expect((await open(sam, [anu, cara])).status).toBe(404);
      expect((await cara.s.post('/chat/dm', { userIds: [String(anu.user._id), String(ravi.user._id)] })).status).toBe(403);
    });
  });

  describe('@all', () => {
    it('in #company only admins and team heads may use it', async () => {
      const company = await space(sam, 'company');
      const res = await sam.s.post(`/chat/channels/${company.id}/messages`, { text: '@all hi', mentionAll: true, clientId: 'all-test-1' });
      expect(res.status).toBe(403);
      expect((await say(head, company.id, { text: '@all meeting at 4', mentionAll: true })).mentionAll).toBe(true);
      expect((await say(admin, company.id, { text: '@all holiday', mentionAll: true })).mentionAll).toBe(true);
    });

    it('anyone may use it in their team space or a group conversation', async () => {
      const sales = await space(sam, 'team:sales');
      expect((await say(sam, sales.id, { text: '@all quick one', mentionAll: true })).mentionAll).toBe(true);
      const { id } = (await open(sam, [anu, ravi])).body.channel;
      expect((await say(sam, id, { text: '@all lunch?', mentionAll: true })).mentionAll).toBe(true);
      expect((await say(sam, id, { text: 'no ping' })).mentionAll).toBe(false);
    });

    it('counts as a mention on "@mentions only", and emails who is offline in the conversation', async () => {
      const mail = jest.spyOn(emailHandler, 'sendEmail').mockResolvedValue({ success: true });
      const { id } = (await open(sam, [anu, ravi])).body.channel;
      await anu.s.put(`/chat/channels/${id}/notify`, { notify: 'mentions' });
      await ravi.s.put(`/chat/channels/${id}/notify`, { notify: 'off' });
      await say(sam, id, { text: 'chatter' });
      await say(sam, id, { text: '@all decision needed', mentionAll: true });

      expect((await channelsOf(anu.s)).find((c) => c.id === id).unreadMentions).toBe(1);
      for (let i = 0; i < 40 && mail.mock.calls.length < 1; i += 1) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 100));
      // Anu is emailed; Ravi turned the conversation off; Sam wrote it; nobody outside it.
      expect(mail.mock.calls.map((c) => c[0].to)).toEqual([anu.user.email]);
    });
  });

  describe('Forward', () => {
    const forward = (who, id, channelId, clientId) =>
      who.s.post(`/chat/messages/${id}/forward`, { channelId, ...(clientId ? { clientId } : {}) });

    it('copies the text into a conversation I am in, marked with who wrote it — not where', async () => {
      const sales = await space(sam, 'team:sales');
      const original = await say(head, sales.id, { text: 'Customer wants delivery by Friday', mentions: [String(sam.user._id)] });
      const { id: group } = (await open(sam, [anu, ravi])).body.channel;

      const res = await forward(sam, original.id, group, 'fwd-test-0001');
      expect(res.status).toBe(201);
      const m = res.body.message;
      expect(m).toMatchObject({
        channelId: group, text: 'Customer wants delivery by Friday', mentions: [], mentionAll: false,
        forwarded: { by: 'Sana' }, sender: expect.objectContaining({ name: 'Sam Kumar' }),
      });
      expect(JSON.stringify(m)).not.toContain(sales.id);
      expect(JSON.stringify(m)).not.toContain(original.id);
      const seen = (await anu.s.get(`/chat/channels/${group}/messages`)).body.messages[0];
      expect(seen.forwarded).toEqual({ by: 'Sana', at: original.createdAt });
    });

    it('a retry is one forward', async () => {
      const sales = await space(sam, 'team:sales');
      const original = await say(head, sales.id, { text: 'once' });
      const { id: group } = (await open(sam, [anu, ravi])).body.channel;
      const [a, b] = await Promise.all([forward(sam, original.id, group, 'fwd-test-0002'), forward(sam, original.id, group, 'fwd-test-0002')]);
      expect(a.body.message.id).toBe(b.body.message.id);
      expect((await sam.s.get(`/chat/channels/${group}/messages`)).body.messages).toHaveLength(1);
    });

    it('never out of a conversation I cannot read, and never into one', async () => {
      const ops = await space(ravi, 'team:operations');
      const secret = await say(ravi, ops.id, { text: 'ops only' });
      const sales = await space(sam, 'team:sales');
      expect((await forward(sam, secret.id, sales.id)).status).toBe(404);

      const mine = await say(sam, sales.id, { text: 'sales note' });
      expect((await forward(sam, mine.id, ops.id)).status).toBe(404);
      expect((await forward(sam, mine.id, 'nope')).status).toBe(400);
      expect((await ravi.s.get(`/chat/channels/${ops.id}/messages`)).body.messages).toHaveLength(1);
    });

    it('not a deleted message', async () => {
      const sales = await space(sam, 'team:sales');
      const m = await say(sam, sales.id, { text: 'oops' });
      await sam.s.del(`/chat/messages/${m.id}`);
      expect((await forward(sam, m.id, sales.id)).status).toBe(409);
    });

    it('copies files so the new readers can open them — the original stays where it was', async () => {
      const sales = await space(sam, 'team:sales');
      const up = await sam.s.upload(`/chat/channels/${sales.id}/messages`, { text: 'invoice', clientId: 'fwd-file-01' },
        [{ buffer: PNG, name: 'invoice.png', type: 'image/png' }]);
      expect(up.status).toBe(201);
      const { id: group } = (await open(sam, [anu, ravi])).body.channel;

      const res = await forward(sam, up.body.message.id, group);
      const [a] = res.body.message.attachments;
      expect(a.url).toMatch(new RegExp(`^/api/v1/chat/channels/${group}/files/\\d{13}-[a-f0-9]{8}-invoice\\.png$`));
      expect(stored.size).toBe(2);

      const file = await anu.s.raw(a.url);
      expect(file.status).toBe(200);
      expect(Buffer.compare(file.body, PNG)).toBe(0);
      // Anu still cannot open the original in #sales.
      expect((await anu.s.raw(up.body.message.attachments[0].url)).status).toBe(404);
    });

    it('works on an automatic order update, credited to Roavion updates', async () => {
      await postSystemMessage('team:sales', 'Order #AB12 paid', { key: 'fwd-sys' });
      const sales = await space(sam, 'team:sales');
      const update = (await sam.s.get(`/chat/channels/${sales.id}/messages`)).body.messages.find((m) => m.kind === 'system');
      const { id: group } = (await open(sam, [anu, ravi])).body.channel;
      const res = await forward(sam, update.id, group);
      expect(res.body.message).toMatchObject({ kind: 'user', text: 'Order #AB12 paid', forwarded: { by: 'Roavion updates' } });
    });
  });
});

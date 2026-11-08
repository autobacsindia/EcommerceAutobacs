/**
 * Formatted text (rich-text box) in task notes and comments.
 *
 * What must hold:
 *   - formatted HTML is cleaned to the allow-list on every write (no XSS ever stored)
 *   - old plain text is kept exactly and never parsed as HTML (no migration)
 *   - limits count words, not markup; a huge payload is refused before parsing
 *   - lists, pop-ups and the Inbox get plain words, never tags
 *   - permissions and the edit race behave as before
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
const pushes = [];
const pushMock = {
  pushConfigured: () => true, publicKey: () => null, cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}),
  sendToUsers: async (targets, payload) => { pushes.push({ to: targets.map((t) => t.userId).sort(), ...payload }); return targets.length; },
  sendTest: async () => ({ sent: 0 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

const stored = new Map();
const storageMock = {
  resourceTypeFor: (t) => (String(t).startsWith('image/') ? 'image' : 'raw'),
  putPrivateAsset: async ({ buffer, folder, basename }) => {
    const publicId = `${folder}/${basename}`;
    stored.set(publicId, buffer);
    return { publicId, provider: 'r2', bytes: buffer.length, resourceType: 'raw', url: '' };
  },
  deletePrivateAsset: async ({ publicId }) => { stored.delete(publicId); return true; },
  readPrivateAsset: async (ref) => {
    if (!stored.has(ref.publicId)) throw new Error('NoSuchKey');
    return stored.get(ref.publicId);
  },
};
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({ ...storageMock, default: storageMock }));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffTaskComment } = await import('../models/StaffTaskComment.js');

const BASE = '/api/v1';
const PW = 'SecurePass123!';

const csrfFrom = (res) => {
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  const upload = (method, url, { fields = {}, files = [] }) => {
    let r = agent[method](`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    for (const f of files) r = r.attach('files', f.buffer, { filename: f.name, contentType: f.type });
    return r;
  };
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    raw: (url) => agent.get(url),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    patch: (url, body = {}) => agent.patch(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    del: (url) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf),
    upload: (url, opts) => upload('post', url, opts),
  };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, id: String(user._id), session: await signIn(email) };
};


describe('Formatted task notes and comments', () => {
  beforeAll(async () => { await dbHandler.connect(); await StaffTask.init(); await StaffTaskComment.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); pushes.length = 0; });

  let head, member, outsider;
  beforeEach(async () => {
    head = await makeUser('Priya', 'staff', { team: 'procurement', isHead: true, active: true });
    member = await makeUser('Arun', 'staff', { team: 'procurement', isHead: false, active: true });
    outsider = await makeUser('Bala', 'staff', { team: 'sales', isHead: false, active: true });
  });
  const create = (description, who = head) => who.session.post('/staff/tasks', { title: 'Call Bosch', assigneeId: member.id, description });

  describe('notes (description)', () => {
    it('formatted notes are stored cleaned: scripts, handlers and javascript: links never reach the database or a browser', async () => {
      const res = await create('<p>Call <strong>Ravi</strong><script>alert(1)</script><img src=x onerror=alert(1)></p><p><a href="javascript:alert(1)">x</a></p>');
      expect(res.status).toBe(201);
      const saved = await StaffTask.findById(res.body.task.id).lean();
      expect(saved.description).toBe('<p>Call <strong>Ravi</strong></p><p><a target="_blank" rel="noopener noreferrer nofollow">x</a></p>');
      const page = await member.session.get(`/staff/tasks/${res.body.task.id}`);
      expect(page.body.task.description).toBe(saved.description);
      expect(page.body.task.description).not.toMatch(/script|onerror|javascript/);
    });

    it('lists show a plain preview of formatted notes (no tags)', async () => {
      await create('<h2>Steps</h2><ul><li><p>pack</p></li><li><p>ship &amp; bill</p></li></ul>');
      const list = await member.session.get('/staff/tasks?view=mine');
      expect(list.status).toBe(200);
      expect(list.body.tasks[0].summary).toBe('Steps • pack • ship & bill');
    });

    it('old plain notes stay exactly as written — angle brackets included — and are never treated as HTML', async () => {
      const plain = 'Price < 500\n<b>not bold</b> & keep\nline 3';
      const res = await create(plain);
      expect(res.status).toBe(201);
      expect((await StaffTask.findById(res.body.task.id).lean()).description).toBe(plain);
      const list = await member.session.get('/staff/tasks?view=mine');
      expect(list.body.tasks[0].summary).toBe('Price < 500 <b>not bold</b> & keep line 3');
    });

    it('the limit counts words, not formatting', async () => {
      const words = 'a'.repeat(4000);
      const fits = await create(`<p><strong><em><u>${words}</u></em></strong></p>`);
      expect(fits.body.message).toBeUndefined();
      expect(fits.status).toBe(201);
      const over = await create(`<p>${words}b</p>`);
      expect(over.status).toBe(400);
      expect(over.body.message).toMatch(/under 4000/);
      // A huge payload is refused before it is parsed.
      expect((await create(`<p>${'<b></b>'.repeat(5000)}x</p>`)).status).toBe(400);
    });

    it('empty formatting saves as no notes', async () => {
      const res = await create('<p></p><p>&nbsp;</p>');
      expect(res.status).toBe(201);
      expect((await StaffTask.findById(res.body.task.id).lean()).description).toBe('');
    });

    it('editing notes cleans them too, and two people saving from the same version: one wins, one is told to reload', async () => {
      const { task } = (await create('old words')).body;
      const a = head.session.patch(`/staff/tasks/${task.id}`, { rev: task.rev, description: '<p>from <em>Priya</em><iframe src="https://evil.test"></iframe></p>' });
      // The same person in two tabs (only the giver may edit the notes).
      const b = head.session.patch(`/staff/tasks/${task.id}`, { rev: task.rev, description: '<p>from Arun</p>' });
      const [ra, rb] = await Promise.all([a, b]);
      expect([ra.status, rb.status].sort()).toEqual([200, 409]);
      const saved = (await StaffTask.findById(task.id).lean()).description;
      expect(['<p>from <em>Priya</em></p>', '<p>from Arun</p>']).toContain(saved);
    });

    it('someone who cannot see the task cannot read or change its notes', async () => {
      const { task } = (await create('<p>secret</p>')).body;
      expect((await outsider.session.get(`/staff/tasks/${task.id}`)).status).toBe(404);
      expect((await outsider.session.patch(`/staff/tasks/${task.id}`, { rev: task.rev, description: '<p>x</p>' })).status).toBe(404);
    });
  });

  describe('comments', () => {
    let taskId;
    beforeEach(async () => { taskId = (await create('')).body.task.id; pushes.length = 0; });

    it('a formatted comment is stored cleaned and its pop-up reads as plain words', async () => {
      const res = await head.session.post(`/staff/tasks/${taskId}/comments`, {
        text: '<p><strong>@Arun</strong> please <a href="https://bosch.in" onclick="x()">call</a></p><ul><li><p>today</p></li></ul><script>1</script>',
        mentions: [member.id], clientId: 'rich-comment-1',
      });
      expect(res.status).toBe(201);
      expect(res.body.comment.text).toBe('<p><strong>@Arun</strong> please <a href="https://bosch.in" target="_blank" rel="noopener noreferrer nofollow">call</a></p><ul><li><p>today</p></li></ul>');
      expect(pushes).toHaveLength(1);
      expect(pushes[0].body).not.toMatch(/[<>]/);
      expect(pushes[0].body).toContain('@Arun please call (https://bosch.in)');
    });

    it('an empty formatted comment is refused; files-alone rules are unchanged', async () => {
      const res = await head.session.post(`/staff/tasks/${taskId}/comments`, { text: '<p> </p>' });
      expect(res.status).toBe(400);
      expect(await StaffTaskComment.countDocuments()).toBe(0);
    });

    it('a comment over the limit in words is refused even though plain words would fit the old check', async () => {
      const ok = await head.session.post(`/staff/tasks/${taskId}/comments`, { text: `<p><strong>${'a'.repeat(2000)}</strong></p>` });
      expect(ok.status).toBe(201);
      const over = await head.session.post(`/staff/tasks/${taskId}/comments`, { text: `<p>${'a'.repeat(2001)}</p>` });
      expect(over.status).toBe(400);
    });

    it('editing a comment cleans it; saving the same cleaned words is not a new edit', async () => {
      const { comment } = (await head.session.post(`/staff/tasks/${taskId}/comments`, { text: '<p>first</p>' })).body;
      const ed = await head.session.patch(`/staff/tasks/${taskId}/comments/${comment.id}`, { text: '<p>second <u>now</u><style>p{}</style></p>' });
      expect(ed.status).toBe(200);
      expect(ed.body.comment.text).toBe('<p>second <u>now</u></p>');
      const again = await head.session.patch(`/staff/tasks/${taskId}/comments/${comment.id}`, { text: '<p>second <u>now</u></p>' });
      expect(again.status).toBe(200);
      const raw = await StaffTaskComment.findById(comment.id).lean();
      expect(raw.edits).toHaveLength(1);
    });

    it('old plain comments still come back as written', async () => {
      const { comment } = (await head.session.post(`/staff/tasks/${taskId}/comments`, { text: 'plain <i>words</i>\nline 2' })).body;
      expect(comment.text).toBe('plain <i>words</i>\nline 2');
    });
  });
});

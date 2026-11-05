/**
 * Task comments, phase 2a, over HTTP: @mentions, edit/delete in a window,
 * reactions, files (on comments and on the task) and pop-ups.
 *
 * What must hold:
 *   - a mention names someone already on the task; anyone else is refused (400)
 *     (the giver may mention anyone in the panel: tests/staffTaskShared.test.js)
 *   - pop-ups go to the giver, the person doing it and anyone mentioned —
 *     never the person who wrote it — and a retried post sends none
 *   - only the author changes a comment, only within 30 minutes; a delete keeps
 *     the words in the database (for the record) and is safe to repeat
 *   - reactions are one write: two people at once both count, a double tap is one
 *   - a file's BYTES must match its type; files live in private storage under
 *     the task and are served only to people who can see the task
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
const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');
const FAKE_PDF = Buffer.from('MZ\x90\x00 this is not a pdf');

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
const png = (name = 'photo.png') => ({ buffer: PNG, name, type: 'image/png' });

describe('Task comments: mentions, edit/delete, reactions, files, pop-ups', () => {
  const savedProvider = process.env.STORAGE_PROVIDER;
  beforeAll(async () => {
    process.env.STORAGE_PROVIDER = 'r2';
    await dbHandler.connect(); await StaffTask.init(); await StaffTaskComment.init();
  });
  afterAll(async () => {
    if (savedProvider === undefined) delete process.env.STORAGE_PROVIDER; else process.env.STORAGE_PROVIDER = savedProvider;
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); stored.clear(); pushes.length = 0; });

  let head, member, outsider, taskId;
  beforeEach(async () => {
    head = await makeUser('Priya', 'staff', { team: 'procurement', isHead: true, active: true });
    member = await makeUser('Arun', 'staff', { team: 'procurement', isHead: false, active: true });
    outsider = await makeUser('Bala', 'staff', { team: 'sales', isHead: false, active: true });
    const res = await head.session.post('/staff/tasks', { title: 'Call Bosch', assigneeId: member.id });
    expect(res.status).toBe(201);
    taskId = res.body.task.id;
    pushes.length = 0; // the "new task" pop-up is not what these tests are about
  });
  const comments = (who) => who.session.get(`/staff/tasks/${taskId}/comments`).then((r) => r.body.comments);

  describe('@mentions and pop-ups', () => {
    it('lists the people on the task, never the caller and never an outsider', async () => {
      const res = await member.session.get(`/staff/tasks/${taskId}/mentionable`);
      expect(res.status).toBe(200);
      expect(res.body.people).toEqual([{ id: head.id, name: 'Priya', onTask: true }]);
      expect((await outsider.session.get(`/staff/tasks/${taskId}/mentionable`)).status).toBe(404);
    });

    it('a mention is saved with the name; the mentioned person gets a "mentioned you" pop-up, the writer none', async () => {
      const res = await head.session.post(`/staff/tasks/${taskId}/comments`, { text: '@Arun please call', mentions: [member.id], clientId: 'mention-0001' });
      expect(res.status).toBe(201);
      expect(res.body.comment.mentions).toEqual([{ id: member.id, name: 'Arun' }]);
      expect(pushes).toHaveLength(1);
      expect(pushes[0]).toMatchObject({ to: [member.id], title: 'Priya mentioned you', tag: `task-${taskId}` });
    });

    // The giver may (they become a follower): tests/staffTaskShared.test.js.
    it('the person doing it mentioning someone not on the task is refused, and nothing is posted', async () => {
      const res = await member.session.post(`/staff/tasks/${taskId}/comments`, { text: '@Bala look', mentions: [outsider.id] });
      expect(res.status).toBe(400);
      expect(await StaffTaskComment.countDocuments()).toBe(0);
      expect(pushes).toHaveLength(0);
    });

    it('a comment pops up for the giver when the doer writes; a retried post sends nothing more', async () => {
      const body = { text: 'Done, they said Friday', clientId: 'retry-00000001' };
      expect((await member.session.post(`/staff/tasks/${taskId}/comments`, body)).status).toBe(201);
      const again = await member.session.post(`/staff/tasks/${taskId}/comments`, body);
      expect(again.status).toBe(200);
      expect(again.body.duplicate).toBe(true);
      expect(pushes).toHaveLength(1);
      expect(pushes[0]).toMatchObject({ to: [head.id], title: 'Arun commented on T-1' });
    });

    it('someone who gave themselves the task gets no pop-up for their own comment', async () => {
      const own = await head.session.post('/staff/tasks', { title: 'Note to self' });
      pushes.length = 0;
      await head.session.post(`/staff/tasks/${own.body.task.id}/comments`, { text: 'reminder' });
      expect(pushes).toHaveLength(0);
    });
  });

  describe('edit and delete', () => {
    let cid;
    beforeEach(async () => {
      cid = (await member.session.post(`/staff/tasks/${taskId}/comments`, { text: 'Bosch says Friday' })).body.comment.id;
    });

    it('the author sees a deadline; others do not', async () => {
      const [mine] = await comments(member);
      expect(mine).toMatchObject({ mine: true, deleted: false, editedAt: null });
      expect(new Date(mine.editableUntil).getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
      const [theirs] = await comments(head);
      expect(theirs).toMatchObject({ mine: false, editableUntil: null });
    });

    it('the author edits; the old words are kept in the database, not shown', async () => {
      const res = await member.session.patch(`/staff/tasks/${taskId}/comments/${cid}`, { text: 'Bosch says Monday' });
      expect(res.status).toBe(200);
      expect(res.body.comment).toMatchObject({ text: 'Bosch says Monday', editedAt: expect.any(String) });
      expect(res.body.comment.edits).toBeUndefined();
      const row = await StaffTaskComment.findById(cid).lean();
      expect(row.edits.map((e) => e.text)).toEqual(['Bosch says Friday']);
    });

    it('nobody else may change it — not the head who gave the task', async () => {
      expect((await head.session.patch(`/staff/tasks/${taskId}/comments/${cid}`, { text: 'x' })).status).toBe(403);
      expect((await head.session.del(`/staff/tasks/${taskId}/comments/${cid}`)).status).toBe(403);
      expect((await outsider.session.del(`/staff/tasks/${taskId}/comments/${cid}`)).status).toBe(404);
    });

    it('after 30 minutes it can no longer be changed', async () => {
      await StaffTaskComment.collection.updateOne({ _id: new StaffTask.base.Types.ObjectId(cid) }, { $set: { createdAt: new Date(Date.now() - 31 * 60_000) } });
      expect((await member.session.patch(`/staff/tasks/${taskId}/comments/${cid}`, { text: 'late' })).status).toBe(403);
      expect((await member.session.del(`/staff/tasks/${taskId}/comments/${cid}`)).status).toBe(403);
      const [c] = await comments(member);
      expect(c.editableUntil).toBeNull();
    });

    it('a delete hides the words from everyone, keeps them in the database, and is safe to repeat', async () => {
      const res = await member.session.del(`/staff/tasks/${taskId}/comments/${cid}`);
      expect(res.status).toBe(200);
      expect(res.body.comment).toMatchObject({ deleted: true, text: '', files: [], reactions: [] });
      expect((await member.session.del(`/staff/tasks/${taskId}/comments/${cid}`)).status).toBe(200);
      const [c] = await comments(head);
      expect(c).toMatchObject({ deleted: true, text: '' });
      const row = await StaffTaskComment.findById(cid).lean();
      expect(row).toMatchObject({ text: 'Bosch says Friday', deletedBy: member.user._id });
      expect((await member.session.patch(`/staff/tasks/${taskId}/comments/${cid}`, { text: 'back' })).status).toBe(409);
    });

    it('an edit cannot empty a comment that has no files', async () => {
      expect((await member.session.patch(`/staff/tasks/${taskId}/comments/${cid}`, { text: '  ' })).status).toBe(400);
    });
  });

  describe('reactions', () => {
    let cid;
    beforeEach(async () => {
      cid = (await member.session.post(`/staff/tasks/${taskId}/comments`, { text: 'Ordered' })).body.comment.id;
    });
    const react = (who, emoji, on = true) => who.session.put(`/staff/tasks/${taskId}/comments/${cid}/reactions`, { emoji, on });

    it('two people at the same moment both count; a double tap is one; off takes mine away', async () => {
      const [a, b] = await Promise.all([react(head, '👍'), react(member, '👍')]);
      expect([a.status, b.status]).toEqual([200, 200]);
      await react(head, '👍');
      let [c] = await comments(head);
      expect(c.reactions).toEqual([{ emoji: '👍', count: 2, mine: true, names: expect.arrayContaining(['Priya', 'Arun']) }]);
      await react(head, '👍', false);
      [c] = await comments(member);
      expect(c.reactions).toEqual([{ emoji: '👍', count: 1, mine: true, names: ['Arun'] }]);
      expect(pushes.filter((p) => /react/i.test(p.title))).toHaveLength(0);
    });

    it('refuses something that is not one emoji, an outsider, and a deleted comment', async () => {
      expect((await react(head, '👍👍')).status).toBe(400);
      expect((await react(head, 'ok')).status).toBe(400);
      expect((await react(outsider, '👍')).status).toBe(404);
      await member.session.del(`/staff/tasks/${taskId}/comments/${cid}`);
      expect((await react(head, '👍')).status).toBe(409);
    });
  });

  describe('files', () => {
    it('a comment with a photo: stored privately under the task, served to people on the task only', async () => {
      const res = await member.session.upload(`/staff/tasks/${taskId}/comments`, {
        fields: { text: 'The bill', clientId: 'files-00000001', mentions: JSON.stringify([head.id]) }, files: [png()],
      });
      expect(res.status).toBe(201);
      const [file] = res.body.comment.files;
      expect(file).toMatchObject({ name: 'photo.png', kind: 'image', mime: 'image/png' });
      expect(file.url).toMatch(new RegExp(`^/api/v1/staff/tasks/${taskId}/files/\\d{13}-[a-f0-9]{8}-photo\\.png$`));
      expect([...stored.keys()][0]).toMatch(new RegExp(`^tasks/${taskId}/`));
      expect(res.body.comment.mentions).toEqual([{ id: head.id, name: 'Priya' }]);

      const got = await head.session.raw(file.url);
      expect(got.status).toBe(200);
      expect(got.headers['content-type']).toMatch('image/png');
      expect(got.headers['cache-control']).toMatch('private');
      expect((await outsider.session.raw(file.url)).status).toBe(404);
      // A comment's file downloads under its own name too.
      const saved = await head.session.raw(`${file.url}?download=1`);
      expect(saved.headers['content-disposition']).toBe(`attachment; filename="photo.png"; filename*=UTF-8''photo.png`);
    });

    it('a file with no words can be posted; once its comment is deleted, the file is no longer served', async () => {
      const res = await member.session.upload(`/staff/tasks/${taskId}/comments`, { fields: { text: '' }, files: [png()] });
      expect(res.status).toBe(201);
      const { url } = res.body.comment.files[0];
      await member.session.del(`/staff/tasks/${taskId}/comments/${res.body.comment.id}`);
      expect((await head.session.raw(url)).status).toBe(404);
    });

    it('a file whose bytes do not match its type is refused and nothing is stored or posted', async () => {
      const res = await member.session.upload(`/staff/tasks/${taskId}/comments`, {
        fields: { text: 'bill' }, files: [{ buffer: FAKE_PDF, name: 'bill.pdf', type: 'application/pdf' }],
      });
      expect(res.status).toBe(400);
      expect(stored.size).toBe(0);
      expect(await StaffTaskComment.countDocuments()).toBe(0);
    });

    it('task files: anyone on the task adds; the uploader or an editor removes; history records both', async () => {
      const added = await member.session.upload(`/staff/tasks/${taskId}/files`, { files: [png('quote.png')] });
      expect(added.status).toBe(200);
      const [file] = added.body.task.files;
      expect(file).toMatchObject({ name: 'quote.png', by: 'Arun', canRemove: true });
      expect(added.body.task.history[0]).toMatchObject({ action: 'file_added', to: 'quote.png', by: 'Arun' });
      expect(added.body.task.can.files).toBe(true);

      const byHead = await head.session.upload(`/staff/tasks/${taskId}/files`, { files: [png('plan.png')] });
      const headFile = byHead.body.task.files.find((f) => f.name === 'plan.png');
      const asMember = (await member.session.get(`/staff/tasks/${taskId}`)).body.task.files.find((f) => f.name === 'plan.png');
      expect(asMember.canRemove).toBe(false);
      const name = headFile.url.split('/').pop();
      expect((await member.session.del(`/staff/tasks/${taskId}/files/${name}`)).status).toBe(403);

      const removed = await head.session.del(`/staff/tasks/${taskId}/files/${file.url.split('/').pop()}`);
      expect(removed.status).toBe(200);
      expect(removed.body.task.files.map((f) => f.name)).toEqual(['plan.png']);
      expect(removed.body.task.history[0]).toMatchObject({ action: 'file_removed', from: 'quote.png' });
      expect((await member.session.raw(file.url)).status).toBe(404);
      // Removing it again is the same result, not an error.
      expect((await head.session.del(`/staff/tasks/${taskId}/files/${file.url.split('/').pop()}`)).status).toBe(200);
    });

    it('a file opens to view by default, and ?download=1 saves it under the name it was uploaded with', async () => {
      const added = await member.session.upload(`/staff/tasks/${taskId}/files`, { files: [png("Bill (Pune) ₹10482's.png")] });
      const [file] = added.body.task.files;
      const view = await head.session.raw(file.url);
      expect(view.status).toBe(200);
      expect(view.headers['content-disposition']).toMatch(/^inline; filename="/);
      const saved = await head.session.raw(`${file.url}?download=1`);
      expect(saved.status).toBe(200);
      expect(saved.headers['content-disposition']).toMatch(/^attachment; filename="[\w.-]+"; filename\*=UTF-8''/);
      // It downloads under the name the task shows, and no quote or bracket is left raw in the header.
      const encoded = saved.headers['content-disposition'].split("filename*=UTF-8''")[1];
      expect(decodeURIComponent(encoded)).toBe(file.name);
      expect(encoded).not.toMatch(/['()]/);
      // Downloading is reading: someone who cannot see the task still gets a 404.
      expect((await outsider.session.raw(`${file.url}?download=1`)).status).toBe(404);
    });

    it('an outsider can neither add nor read task files', async () => {
      expect((await outsider.session.upload(`/staff/tasks/${taskId}/files`, { files: [png()] })).status).toBe(404);
      expect(stored.size).toBe(0);
      expect((await outsider.session.raw(`/api/v1/staff/tasks/${taskId}/files/1700000000000-abcdef12-photo.png`)).status).toBe(404);
    });

    it('a name that is not a stored file name is a 404, not a path into storage', async () => {
      expect((await head.session.raw(`/api/v1/staff/tasks/${taskId}/files/..%2F..%2Fchat%2Fx.png`)).status).toBe(404);
    });

    it('without private storage a file is refused (503) rather than stored publicly', async () => {
      process.env.STORAGE_PROVIDER = 'cloudinary';
      try {
        const res = await member.session.upload(`/staff/tasks/${taskId}/files`, { files: [png()] });
        expect(res.status).toBe(503);
        expect(stored.size).toBe(0);
      } finally {
        process.env.STORAGE_PROVIDER = 'r2';
      }
    });

    it('an archived task takes no new files', async () => {
      const t = (await head.session.get(`/staff/tasks/${taskId}`)).body.task;
      await head.session.patch(`/staff/tasks/${taskId}`, { rev: t.rev, archived: true });
      const res = await member.session.upload(`/staff/tasks/${taskId}/files`, { files: [png()] });
      expect(res.status).toBe(409);
      expect(stored.size).toBe(0);
    });
  });
});

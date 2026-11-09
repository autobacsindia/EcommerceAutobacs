/**
 * The Lesson Library over HTTP: auth, CSRF, validation and status codes are real;
 * storage is a double.
 *
 * What must hold:
 *   - visibility: staff see company lessons and their own team's; another team's
 *     lesson is a 404, from the list, the page and the file link
 *   - posting: admin anywhere, a head to their team or company, a member nowhere
 *   - editing: owner yes (text only); moving, re-owning and archiving need a manager
 *   - two editors: the second gets 409, not a silent overwrite
 *   - finishing is recorded once however many times it is pressed
 *   - cursor pages are complete, never overlapping
 *   - a file is kept only if the STORE says it is real, within the cap, and minted
 *     for this lesson; a retry attaches once
 *   - sign-out on access removal: a deactivated person gets nothing
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

const r2 = {
  headObject: jest.fn(), getObjectHead: jest.fn(), deleteObject: jest.fn(async () => true),
  presignPut: jest.fn(async ({ key }) => ({ url: `https://r2.test/put/${key}`, expiresIn: 900 })),
  presignGet: jest.fn(async ({ key }) => `https://r2.test/get/${key}`),
};
const r2Rest = Object.fromEntries(['resetClient', 'putObject', 'objectExists', 'getObjectBuffer', 'deleteObjects', 'listKeys'].map((n) => [n, jest.fn()]));
jest.unstable_mockModule('../services/storage/r2Provider.js', () => ({ ...r2Rest, ...r2, default: { ...r2Rest, ...r2 } }));
const realConfig = await import('../config/storage.js');
jest.unstable_mockModule('../config/storage.js', () => ({ ...realConfig, storageProvider: () => 'r2' }));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: StaffLesson } = await import('../models/StaffLesson.js');
const { default: StaffLessonProgress } = await import('../models/StaffLessonProgress.js');

const BASE = '/api/v1/staff/lessons';
const PW = 'SecurePass123!';
const PDF = Buffer.from('%PDF-1.7 hello');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(8)]);
const HTML = Buffer.from('<html><script>alert(1)</script>');
const PPTX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

const csrfFrom = (res) => {
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return x ? x.split(';')[0].split('=')[1] : '';
};
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PW });
  expect(res.status).toBe(200);
  const csrf = csrfFrom(res);
  const withCsrf = (r) => r.set('X-XSRF-TOKEN', csrf);
  return {
    get: (url = '') => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => withCsrf(agent.post(`${BASE}${url}`)).send(body),
    patch: (url, body = {}) => withCsrf(agent.patch(`${BASE}${url}`)).send(body),
    put: (url, body = {}) => withCsrf(agent.put(`${BASE}${url}`)).send(body),
    del: (url) => withCsrf(agent.delete(`${BASE}${url}`)),
    postNoCsrf: (url, body = {}) => agent.post(`${BASE}${url}`).send(body),
  };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, s: await signIn(email) };
};
const procurement = (extra = {}) => ({ team: 'procurement', active: true, ...extra });

describe('Lesson Library', () => {
  beforeAll(async () => { await dbHandler.connect(); await StaffLessonProgress.init(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  let admin; let head; let member; let outsider;
  beforeEach(async () => {
    Object.values(r2).forEach((f) => f.mockClear());
    r2.deleteObject.mockImplementation(async () => true);
    r2.presignPut.mockImplementation(async ({ key }) => ({ url: `https://r2.test/put/${key}`, expiresIn: 900 }));
    r2.presignGet.mockImplementation(async ({ key }) => `https://r2.test/get/${key}`);
    admin = await makeUser('Admin', 'admin');
    head = await makeUser('Head', 'staff', procurement({ isHead: true }));
    member = await makeUser('Member', 'staff', procurement());
    outsider = await makeUser('Outsider', 'staff', { team: 'sales', active: true });
  });

  const post = async (who, body = {}) => {
    const res = await who.s.post('', { title: 'How to raise a PO', audience: 'procurement', ...body });
    expect(res.status).toBe(201);
    return res.body.lesson;
  };

  test('needs sign-in and CSRF', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
    expect((await head.s.postNoCsrf('', { title: 'x', audience: 'procurement' })).status).toBe(403);
  });

  describe('who can see', () => {
    test('a team lesson is hidden from another team, everywhere', async () => {
      const l = await post(head);
      expect((await member.s.get(`/${l.id}`)).status).toBe(200);
      expect((await admin.s.get(`/${l.id}`)).status).toBe(200);
      expect((await outsider.s.get(`/${l.id}`)).status).toBe(404);
      expect((await outsider.s.get('')).body.lessons).toEqual([]);
      expect((await outsider.s.get('?section=procurement')).status).toBe(403);
      await StaffLesson.updateOne({ _id: l.id }, { $push: { files: { publicId: `autobacs/lessons/${l.id}/file-aaaaaaaaaaaaaaaa.pdf`, kind: 'pdf', name: 'a.pdf', mime: 'application/pdf' } } });
      expect((await outsider.s.get(`/${l.id}/files/file-aaaaaaaaaaaaaaaa.pdf`)).status).toBe(404);
      expect((await member.s.get(`/${l.id}/files/file-aaaaaaaaaaaaaaaa.pdf`)).status).toBe(200);
    });

    test('a company lesson reaches everyone', async () => {
      const l = await post(head, { audience: 'company' });
      expect((await outsider.s.get(`/${l.id}`)).status).toBe(200);
      expect((await outsider.s.get('')).body.lessons.map((x) => x.id)).toEqual([l.id]);
    });

    test('someone whose access was removed sees nothing', async () => {
      const l = await post(head, { audience: 'company' });
      await User.updateOne({ _id: member.user._id }, { $set: { 'staff.active': false }, $inc: { sessionVersion: 1 } });
      expect((await member.s.get(`/${l.id}`)).status).toBe(401);
    });

    test('an archived lesson is gone', async () => {
      const l = await post(head);
      expect((await head.s.del(`/${l.id}`)).status).toBe(200);
      expect((await head.s.get(`/${l.id}`)).status).toBe(404);
      expect((await head.s.get('')).body.lessons).toEqual([]);
      expect(await StaffLesson.countDocuments({})).toBe(1);
    });
  });

  describe('who can post and change', () => {
    test('heads post to their own team or the company; members cannot post', async () => {
      await post(head);
      await post(head, { audience: 'company' });
      expect((await head.s.post('', { title: 'x', audience: 'sales' })).status).toBe(403);
      expect((await member.s.post('', { title: 'x', audience: 'procurement' })).status).toBe(403);
      await post(admin, { audience: 'sales' });
    });

    test('the form\'s blank owner means the poster on create, and no change on edit', async () => {
      const l = await post(head, { ownerId: '' });
      expect(l.owner.name).toBe('Head');
      const edited = await admin.s.patch(`/${l.id}`, { rev: l.rev, title: 'Renamed', ownerId: '' });
      expect(edited.status).toBe(200);
      expect(edited.body.lesson.owner.name).toBe('Head');
    });

    test('a lesson needs a title and a real audience', async () => {
      expect((await head.s.post('', { title: '  ', audience: 'procurement' })).status).toBe(400);
      expect((await head.s.post('', { title: 'x', audience: 'nowhere' })).status).toBe(400);
    });

    test('notes are cleaned of scripts', async () => {
      const l = await post(head, { body: '<p>Hello</p><script>alert(1)</script>' });
      expect(l.body).toContain('Hello');
      expect(l.body).not.toContain('script');
    });

    test('a named owner edits text but cannot move, re-own or archive', async () => {
      const l = await post(head, { ownerId: String(member.user._id) });
      expect(l.can).toEqual({ edit: true, manage: true });
      const edited = await member.s.patch(`/${l.id}`, { rev: l.rev, title: 'Better' });
      expect(edited.status).toBe(200);
      expect(edited.body.lesson.can).toEqual({ edit: true, manage: false });
      const rev = edited.body.lesson.rev;
      expect((await member.s.patch(`/${l.id}`, { rev, audience: 'company' })).status).toBe(403);
      expect((await member.s.patch(`/${l.id}`, { rev, ownerId: String(head.user._id) })).status).toBe(403);
      expect((await member.s.del(`/${l.id}`)).status).toBe(403);
    });

    test('an ordinary team member cannot edit', async () => {
      const l = await post(head);
      expect((await member.s.patch(`/${l.id}`, { rev: 0, title: 'x' })).status).toBe(403);
      expect((await member.s.post(`/${l.id}/checked`)).status).toBe(403);
      expect((await member.s.get(`/${l.id}/progress`)).status).toBe(403);
    });

    test('the owner must be able to see the lesson', async () => {
      expect((await head.s.post('', { title: 'x', audience: 'procurement', ownerId: String(outsider.user._id) })).status).toBe(400);
    });

    test('moving a lesson re-checks that its owner can still see it', async () => {
      const l = await post(admin, { ownerId: String(member.user._id) });
      expect((await admin.s.patch(`/${l.id}`, { rev: l.rev, audience: 'sales' })).status).toBe(400);
    });

    test('of two editors, the second is told, not overwritten', async () => {
      const l = await post(head);
      expect((await head.s.patch(`/${l.id}`, { rev: l.rev, title: 'First' })).status).toBe(200);
      expect((await admin.s.patch(`/${l.id}`, { rev: l.rev, title: 'Second' })).status).toBe(409);
      expect((await head.s.get(`/${l.id}`)).body.lesson.title).toBe('First');
    });

    test('goes stale after 90 days, and "checked" clears it', async () => {
      const l = await post(head);
      await StaffLesson.updateOne({ _id: l.id }, { lastCheckedAt: new Date(Date.now() - 91 * 86400000) });
      expect((await head.s.get(`/${l.id}`)).body.lesson.stale).toBe(true);
      const res = await head.s.post(`/${l.id}/checked`);
      expect(res.body.lesson.stale).toBe(false);
      expect(res.body.lesson.lastCheckedByName).toBe('Head');
    });
  });

  describe('finishing', () => {
    test('recorded once, keeps the first date, and shows in progress', async () => {
      const l = await post(head);
      const first = await member.s.put(`/${l.id}/done`, { done: true });
      expect(first.body.lesson.doneAt).toBeTruthy();
      const again = await member.s.put(`/${l.id}/done`, { done: true });
      expect(again.body.lesson.doneAt).toBe(first.body.lesson.doneAt);
      expect(await StaffLessonProgress.countDocuments({})).toBe(1);
      const list = (await member.s.get('')).body.lessons;
      expect(list[0].doneAt).toBeTruthy();
      expect((await head.s.get('')).body.lessons[0].doneAt).toBeNull();
      const { people } = (await head.s.get(`/${l.id}/progress`)).body;
      expect(people.find((p) => p.name === 'Member').doneAt).toBeTruthy();
      expect(people.find((p) => p.name === 'Head').doneAt).toBeNull();
      expect(people.some((p) => p.name === 'Outsider')).toBe(false);
    });

    test('two presses at once still record one row', async () => {
      const l = await post(head);
      const results = await Promise.all([member.s.put(`/${l.id}/done`, { done: true }), member.s.put(`/${l.id}/done`, { done: true })]);
      expect(await StaffLessonProgress.countDocuments({})).toBe(1);
      results.forEach((r) => expect(r.status).toBe(200));
    });

    test('can be undone', async () => {
      const l = await post(head);
      await member.s.put(`/${l.id}/done`, { done: true });
      expect((await member.s.put(`/${l.id}/done`, { done: false })).body.lesson.doneAt).toBeNull();
    });
  });

  test('cursor pages are complete and never overlap', async () => {
    const base = { audience: 'procurement', owner: head.user._id, createdBy: head.user._id, lastCheckedAt: new Date() };
    await StaffLesson.insertMany(Array.from({ length: 30 }, (_, i) => ({ ...base, title: `L${i}` })));
    const first = (await member.s.get('')).body;
    expect(first.lessons).toHaveLength(24);
    expect(first.lessons[0].body).toBeUndefined();
    const second = (await member.s.get(`?cursor=${first.nextCursor}`)).body;
    expect(second.lessons).toHaveLength(6);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.lessons, ...second.lessons].map((l) => l.id)).size).toBe(30);
    expect((await member.s.get('?cursor=rubbish')).status).toBe(400);
  });

  test('search treats punctuation as plain text', async () => {
    await post(head, { title: 'Refunds (cash)' });
    await post(head, { title: 'Stock' });
    expect((await member.s.get(`?q=${encodeURIComponent('(CASH')}`)).body.lessons.map((l) => l.title)).toEqual(['Refunds (cash)']);
  });

  describe('files', () => {
    const upload = async (who, id, contentType, bytes, size = bytes.length) => {
      const t = await who.s.post(`/${id}/upload-target`, { contentType, size });
      expect(t.status).toBe(200);
      r2.headObject.mockResolvedValueOnce({ key: t.body.key, bytes: size });
      r2.getObjectHead.mockResolvedValueOnce(bytes);
      return { key: t.body.key, res: await who.s.post(`/${id}/files`, { key: t.body.key, name: 'Week 1 training.anything' }) };
    };

    test('a video, a PDF and a PowerPoint are kept, with server-chosen names', async () => {
      const l = await post(head);
      expect((await upload(head, l.id, 'video/mp4', MP4)).res.body.lesson.files[0]).toMatchObject({ kind: 'video', name: 'Week 1 training.mp4' });
      await upload(head, l.id, 'application/pdf', PDF);
      const last = await upload(head, l.id, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', PPTX);
      expect(last.res.body.lesson.files.map((f) => f.kind)).toEqual(['video', 'pdf', 'slides']);
      expect(last.res.body.lesson.fileKinds).toEqual(['video', 'pdf', 'slides']);
    });

    test('a member cannot get an upload link', async () => {
      const l = await post(head);
      expect((await member.s.post(`/${l.id}/upload-target`, { contentType: 'application/pdf', size: 10 })).status).toBe(403);
    });

    test('types off the list are refused before any upload', async () => {
      const l = await post(head);
      expect((await head.s.post(`/${l.id}/upload-target`, { contentType: 'text/html', size: 10 })).status).toBe(400);
      expect(r2.presignPut).not.toHaveBeenCalled();
    });

    test('a page pretending to be a PDF is refused and deleted', async () => {
      const l = await post(head);
      const { key, res } = await upload(head, l.id, 'application/pdf', HTML);
      expect(res.status).toBe(400);
      expect(r2.deleteObject).toHaveBeenCalledWith(expect.objectContaining({ key }));
      expect((await head.s.get(`/${l.id}`)).body.lesson.files).toEqual([]);
    });

    test('the size limit is read from the store, not the browser', async () => {
      const l = await post(head);
      const t = await head.s.post(`/${l.id}/upload-target`, { contentType: 'application/pdf', size: 10 });
      r2.headObject.mockResolvedValueOnce({ bytes: 101 * 1024 * 1024 });
      expect((await head.s.post(`/${l.id}/files`, { key: t.body.key, name: 'a.pdf' })).status).toBe(400);
      expect(r2.deleteObject).toHaveBeenCalled();
    });

    test('an upload that never arrived cannot be attached', async () => {
      const l = await post(head);
      const t = await head.s.post(`/${l.id}/upload-target`, { contentType: 'application/pdf', size: 10 });
      r2.headObject.mockResolvedValueOnce(null);
      expect((await head.s.post(`/${l.id}/files`, { key: t.body.key, name: 'a.pdf' })).status).toBe(400);
    });

    test('a key minted for another lesson, or a made-up one, is refused', async () => {
      const a = await post(head);
      const b = await post(head);
      const t = await head.s.post(`/${a.id}/upload-target`, { contentType: 'application/pdf', size: 10 });
      expect((await head.s.post(`/${b.id}/files`, { key: t.body.key, name: 'a.pdf' })).status).toBe(400);
      expect((await head.s.post(`/${b.id}/files`, { key: 'chat/x/secret.pdf', name: 'a.pdf' })).status).toBe(400);
      expect(r2.headObject).not.toHaveBeenCalled();
    });

    test('attaching the same upload twice adds it once', async () => {
      const l = await post(head);
      const { key } = await upload(head, l.id, 'application/pdf', PDF);
      const again = await head.s.post(`/${l.id}/files`, { key, name: 'a.pdf' });
      expect(again.status).toBe(200);
      expect(again.body.lesson.files).toHaveLength(1);
    });

    test('a full lesson refuses more', async () => {
      const l = await post(head);
      const files = Array.from({ length: 30 }, (_, i) => ({ publicId: `autobacs/lessons/${l.id}/file-${String(i).padStart(16, '0')}.pdf`, kind: 'pdf', name: 'a.pdf', mime: 'application/pdf' }));
      await StaffLesson.updateOne({ _id: l.id }, { files });
      expect((await head.s.post(`/${l.id}/upload-target`, { contentType: 'application/pdf', size: 10 })).status).toBe(400);
    });

    test('links: PowerPoint downloads, PDF opens, video lasts longer, every link is uncached', async () => {
      const l = await post(head);
      const ppt = await upload(head, l.id, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', PPTX);
      const pdf = await upload(head, l.id, 'application/pdf', PDF);
      const vid = await upload(head, l.id, 'video/mp4', MP4);
      const nameOf = (x) => x.key.split('/').pop();
      r2.presignGet.mockClear();
      const res = await member.s.get(`/${l.id}/files/${nameOf(ppt)}`);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(r2.presignGet.mock.calls[0][0].downloadAs).toMatch(/\.pptx$/);
      await member.s.get(`/${l.id}/files/${nameOf(pdf)}`);
      expect(r2.presignGet.mock.calls[1][0]).toMatchObject({ downloadAs: undefined, contentType: 'application/pdf' });
      await member.s.get(`/${l.id}/files/${nameOf(vid)}`);
      expect(r2.presignGet.mock.calls[2][0].expiresIn).toBe(7200);
    });

    test('removing a file deletes it from storage; a member cannot', async () => {
      const l = await post(head);
      const { key } = await upload(head, l.id, 'application/pdf', PDF);
      const name = key.split('/').pop();
      expect((await member.s.del(`/${l.id}/files/${name}`)).status).toBe(403);
      r2.deleteObject.mockClear();
      expect((await head.s.del(`/${l.id}/files/${name}`)).body.lesson.files).toEqual([]);
      expect(r2.deleteObject).toHaveBeenCalledWith(expect.objectContaining({ key }));
    });
  });
});

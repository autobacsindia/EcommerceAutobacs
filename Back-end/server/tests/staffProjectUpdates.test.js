/**
 * Project updates (services/staffProjectUpdateService.js) and videos on tasks,
 * over HTTP.
 *
 * What must hold:
 *   - anyone who sees the project posts and reads updates; an outsider gets 404
 *     for the feed, the post and every file — the media is as private as the job
 *   - long text (up to 20,000 characters) is kept; over it is refused clearly
 *   - a file's type and BYTES are checked; a video over 40 MB is refused
 *   - a photo is served from private storage, a video is handed off to a
 *     short-lived private link (so phones can seek), never cached
 *   - a double-tapped post saves once; delete is for the poster, the owner or
 *     the admin, removes the files from storage, and is safe to repeat
 *   - an archived project takes no new updates
 *   - tasks now take videos on comments and on the task itself
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
const pushMock = {
  pushConfigured: () => false, publicKey: () => null, cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}), sendToUsers: async () => 0, sendTest: async () => ({ sent: 0 }),
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
const signed = [];
const urlMock = {
  providerOf: () => 'r2',
  r2PrivateUrl: async (opts) => { signed.push(opts); return `https://bucket.r2.test/${opts.key}?X-Amz-Signature=sig`; },
};
jest.unstable_mockModule('../services/storage/privateAssetUrl.js', () => ({ ...urlMock, default: urlMock }));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: StaffTask } = await import('../models/StaffTask.js');
const { default: StaffTaskComment } = await import('../models/StaffTaskComment.js');
const { default: StaffProject } = await import('../models/StaffProject.js');
const { default: StaffProjectUpdate } = await import('../models/StaffProjectUpdate.js');
const DUE = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const BASE = '/api/v1';
const PW = 'SecurePass123!';
const MB = 1024 * 1024;
const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');
const MP4 = Buffer.concat([Buffer.from('000000186674797069736f6d0000020069736f6d', 'hex'), Buffer.alloc(64)]);
const padTo = (head, size) => Buffer.concat([head, Buffer.alloc(size - head.length)]);
const png = (name = 'photo.png') => ({ buffer: PNG, name, type: 'image/png' });
const mp4 = (name = 'clip.mp4', buffer = MP4) => ({ buffer, name, type: 'video/mp4' });

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
    raw: (url) => agent.get(url).redirects(0),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    del: (url) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf),
    upload: (url, { fields = {}, files = [] }) => {
      let r = agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      for (const f of files) r = r.attach('files', f.buffer, { filename: f.name, contentType: f.type });
      return r;
    },
  };
}
let n = 0;
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase()}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, id: String(user._id), session: await signIn(email) };
};

describe('Project updates and task videos', () => {
  const savedProvider = process.env.STORAGE_PROVIDER;
  beforeAll(async () => {
    process.env.STORAGE_PROVIDER = 'r2';
    await dbHandler.connect();
    await StaffTask.init(); await StaffTaskComment.init(); await StaffProject.init(); await StaffProjectUpdate.init();
  });
  afterAll(async () => {
    if (savedProvider === undefined) delete process.env.STORAGE_PROVIDER; else process.env.STORAGE_PROVIDER = savedProvider;
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  afterEach(async () => { await dbHandler.clearDatabase(); stored.clear(); signed.length = 0; });

  let admin, owner, member, outsider, projectId;
  const path = () => `/staff/tasks/projects/${projectId}/updates`;
  beforeEach(async () => {
    admin = await makeUser('Vyshnav', 'admin', undefined);
    owner = await makeUser('Nevin', 'staff', { team: 'operations', isHead: true, active: true });
    member = await makeUser('Ravi', 'staff', { team: 'operations', isHead: false, active: true });
    outsider = await makeUser('Bala', 'staff', { team: 'sales', isHead: false, active: true });
    const res = await owner.session.post('/staff/tasks/projects', { name: 'Hilux fitting', memberIds: [member.id] });
    expect(res.status).toBe(201);
    projectId = res.body.project.id;
  });

  describe('text', () => {
    it('a long update (20,000 characters) is kept whole; over it is refused with a clear message', async () => {
      const long = 'a'.repeat(20000);
      const ok = await member.session.post(path(), { text: `<p>${long}</p>`, clientId: 'long-update-01' });
      expect(ok.status).toBe(201);
      expect(ok.body.update.text).toBe(`<p>${long}</p>`);
      const over = await member.session.post(path(), { text: `<p>${long}b</p>` });
      expect(over.status).toBe(400);
      expect(over.body.message).toMatch(/This update is too long \(over 20,000 characters\) — please split it into two/);
      // A huge payload of empty markup is refused before it is parsed.
      expect((await member.session.post(path(), { text: `<p>${'<b></b>'.repeat(20000)}x</p>` })).status).toBe(400);
    });

    it('formatting is cleaned; an empty update is refused', async () => {
      const res = await member.session.post(path(), { text: '<p>Bumper <strong>fitted</strong><script>x()</script></p>' });
      expect(res.status).toBe(201);
      expect(res.body.update).toMatchObject({ text: '<p>Bumper <strong>fitted</strong></p>', by: 'Ravi', mine: true, canDelete: true, files: [] });
      const empty = await member.session.post(path(), { text: '<p> </p>' });
      expect(empty.status).toBe(400);
      expect(empty.body.message).toMatch(/Write an update or add a photo or video/);
    });

    it('a double-tapped post (same clientId) saves once', async () => {
      const body = { text: 'Done', clientId: 'double-tap-0001' };
      // At the same moment: whichever saves first wins, the other finds it.
      const [a, b] = await Promise.all([member.session.post(path(), body), member.session.post(path(), body)]);
      expect([a.status, b.status]).toEqual(expect.arrayContaining([201]));
      expect([200, 201]).toContain(a.status);
      expect([200, 201]).toContain(b.status);
      expect(a.body.update.id).toBe(b.body.update.id);
      // A retry later: the same update, nothing new stored.
      const again = await member.session.post(path(), body);
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ duplicate: true, update: { id: a.body.update.id } });
      expect(await StaffProjectUpdate.countDocuments()).toBe(1);
    });

    it('lists newest first, 20 a page, with a cursor to the older ones', async () => {
      for (let i = 0; i < 22; i += 1) {
        expect((await member.session.post(path(), { text: `u${i}` })).status).toBe(201);
      }
      const first = await owner.session.get(path());
      expect(first.status).toBe(200);
      expect(first.headers['cache-control']).toMatch(/no-store/);
      expect(first.body.updates).toHaveLength(20);
      expect(first.body.updates[0].text).toBe('u21');
      expect(first.body.updates[0]).toMatchObject({ mine: false, canDelete: true }); // the owner may delete
      const second = await owner.session.get(`${path()}?before=${first.body.nextBefore}`);
      expect(second.body.updates.map((u) => u.text)).toEqual(['u1', 'u0']);
      expect(second.body.nextBefore).toBeNull();
      expect((await owner.session.get(`${path()}?before=nope`)).status).toBe(400);
    });
  });

  describe('photos and videos', () => {
    it('a photo and a video attach to an update and show on it', async () => {
      const res = await member.session.upload(path(), { fields: { text: 'Before and after', clientId: 'media-0000001' }, files: [png(), mp4()] });
      expect(res.status).toBe(201);
      const { files } = res.body.update;
      expect(files.map((f) => [f.kind, f.name, f.mime])).toEqual([['image', 'photo.png', 'image/png'], ['video', 'clip.mp4', 'video/mp4']]);
      expect(files[0].url).toMatch(new RegExp(`^/api/v1/staff/tasks/projects/${projectId}/files/\\d{13}-[a-f0-9]{8}-photo\\.png$`));
      expect([...stored.keys()].every((k) => k.startsWith(`projects/${projectId}/`))).toBe(true);
      const listed = (await owner.session.get(path())).body.updates[0];
      expect(listed.files).toEqual(files);
    });

    it('a photo is served privately to members; a video redirects to a short-lived private link, never cached', async () => {
      const { files } = (await member.session.upload(path(), { files: [png(), mp4()] })).body.update;
      const photo = await owner.session.raw(files[0].url);
      expect(photo.status).toBe(200);
      expect(photo.headers['content-type']).toBe('image/png');
      expect(photo.headers['cache-control']).toBe('private, max-age=86400');
      expect(Buffer.compare(photo.body, PNG)).toBe(0);

      const video = await owner.session.raw(files[1].url);
      expect(video.status).toBe(302);
      expect(video.headers.location).toMatch(/^https:\/\/bucket\.r2\.test\/projects\/.+\.mp4\?X-Amz-Signature=sig$/);
      expect(video.headers['cache-control']).toBe('private, no-store');
      expect(signed[0]).toMatchObject({ contentType: 'video/mp4', ttlSeconds: 3600 });
      expect(signed[0].downloadAs).toBeUndefined();
      await owner.session.raw(`${files[1].url}?download=1`);
      expect(signed[1].downloadAs).toBe('clip.mp4');
    });

    it('an outsider cannot read the feed, post, or open any file — not even with the link', async () => {
      const { files } = (await member.session.upload(path(), { files: [png(), mp4()] })).body.update;
      expect((await outsider.session.get(path())).status).toBe(404);
      expect((await outsider.session.post(path(), { text: 'hi' })).status).toBe(404);
      expect((await outsider.session.upload(path(), { files: [png()] })).status).toBe(404);
      for (const f of files) expect((await outsider.session.raw(f.url)).status).toBe(404);
      expect(signed).toHaveLength(0);
      // A name outside the project's folder never resolves.
      expect((await owner.session.raw(`${BASE}/staff/tasks/projects/${projectId}/files/..%2F..%2Ftasks%2Fx.png`)).status).toBe(404);
    });

    it('refuses a wrong type, bytes that lie about their type, and a video over 40 MB', async () => {
      const exe = await member.session.upload(path(), { files: [{ buffer: Buffer.from('MZ\x90\x00'), name: 'x.exe', type: 'application/x-msdownload' }] });
      expect(exe.status).toBe(400);
      const fake = await member.session.upload(path(), { files: [{ buffer: Buffer.from('not a video at all'), name: 'clip.mp4', type: 'video/mp4' }] });
      expect(fake.status).toBe(400);
      const big = await member.session.upload(path(), { files: [mp4('long.mp4', padTo(MP4, 40 * MB + 1))] });
      expect([400, 413]).toContain(big.status);
      expect(await StaffProjectUpdate.countDocuments()).toBe(0);
      expect(stored.size).toBe(0);
    });
  });

  describe('delete', () => {
    it('the poster, the owner or the admin deletes; another member cannot; files leave storage; repeat is fine', async () => {
      const mine = (await member.session.upload(path(), { fields: { text: 'mine' }, files: [png()] })).body.update;
      const byOwner = (await owner.session.post(path(), { text: 'owner’s' })).body.update;
      expect(stored.size).toBe(1);
      expect((await member.session.del(`${path()}/${byOwner.id}`)).status).toBe(403);
      const gone = await member.session.del(`${path()}/${mine.id}`);
      expect(gone.status).toBe(200);
      expect(gone.body.update).toMatchObject({ deleted: true, text: '', files: [], canDelete: false });
      expect(stored.size).toBe(0);
      expect((await owner.session.raw(mine.files[0].url)).status).toBe(404);
      // The words stay in the record.
      expect((await StaffProjectUpdate.findById(mine.id).lean()).text).toBe('mine');
      expect((await member.session.del(`${path()}/${mine.id}`)).status).toBe(200);
      expect((await admin.session.del(`${path()}/${byOwner.id}`)).status).toBe(200);
      expect((await outsider.session.del(`${path()}/${byOwner.id}`)).status).toBe(404);
    });

    it('an archived project takes no new updates', async () => {
      await StaffProject.updateOne({ _id: projectId }, { archivedAt: new Date() });
      // Archived projects are hidden from members, so the post finds nothing.
      expect([404, 409]).toContain((await owner.session.post(path(), { text: 'late' })).status);
      expect(await StaffProjectUpdate.countDocuments()).toBe(0);
    });
  });

  describe('videos on tasks', () => {
    let taskId;
    beforeEach(async () => {
      const res = await owner.session.post('/staff/tasks', { dueOn: DUE, title: 'Fit roof rack', assigneeId: member.id });
      expect(res.status).toBe(201);
      taskId = res.body.task.id;
    });

    it('a comment and the task itself take a video; members get a private link, outsiders 404', async () => {
      const c = await member.session.upload(`/staff/tasks/${taskId}/comments`, { fields: { text: 'Done, see video' }, files: [mp4()] });
      expect(c.status).toBe(201);
      expect(c.body.comment.files[0]).toMatchObject({ kind: 'video', mime: 'video/mp4', name: 'clip.mp4' });
      const t = await member.session.upload(`/staff/tasks/${taskId}/files`, { files: [mp4('walkround.mp4')] });
      expect(t.status).toBe(200);
      const file = t.body.task.files.find((f) => f.name === 'walkround.mp4');
      expect(file.kind).toBe('video');
      const play = await owner.session.raw(c.body.comment.files[0].url);
      expect(play.status).toBe(302);
      expect(play.headers.location).toMatch(new RegExp(`tasks/${taskId}/.+\\.mp4`));
      expect((await outsider.session.raw(file.url)).status).toBe(404);
    });

    it('a long comment (20,000 characters) is kept', async () => {
      const long = 'b'.repeat(20000);
      const res = await member.session.post(`/staff/tasks/${taskId}/comments`, { text: long });
      expect(res.status).toBe(201);
      expect(res.body.comment.text.length).toBeGreaterThanOrEqual(20000);
    });
  });
});

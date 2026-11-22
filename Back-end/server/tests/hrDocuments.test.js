/**
 * HR employee documents (docs/ADR-hr-system.md §4 Documents).
 *
 * What must hold:
 *   - bytes go to the PRIVATE bucket only; no private storage → 503, never a public fallback
 *   - only real PDFs/photos within the size cap; the bytes must match the declared type
 *   - scope `documents`: self + HR + admin; a team head and other employees get 404
 *     (the same answer as a document that doesn't exist)
 *   - reads are 5-minute presigned URLs minted after the access check
 *   - delete is HR/admin only, soft, audited, and a second delete is a 404
 *   - a failed DB write removes the stored object (no orphaned identity papers)
 *   - no token → 401
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
const pushMock = {
  pushConfigured: () => false, publicKey: () => null, cleanSubscription: (x) => x,
  subscribe: async () => ({}), unsubscribe: async () => ({}), sendToUsers: async () => 0, sendTest: async () => ({ sent: 0 }),
};
jest.unstable_mockModule('../services/pushService.js', () => ({ ...pushMock, default: pushMock }));

// Private storage: an in-memory bucket so we can assert what was stored and removed.
// Plain functions + call logs (jest.config resets jest.fn implementations per test).
const bucket = new Map();
const calls = { put: [], del: [], url: [] };
const putPrivateAsset = async ({ buffer, folder, basename }) => {
  const key = `${folder}/${basename}`;
  calls.put.push(key);
  bucket.set(key, buffer);
  return { publicId: key, provider: 'r2', bytes: buffer.length, resourceType: 'raw', url: '' };
};
const deletePrivateAsset = async ({ publicId }) => { calls.del.push(publicId); return bucket.delete(publicId); };
jest.unstable_mockModule('../services/storage/privateUploads.js', () => ({
  putPrivateAsset, deletePrivateAsset, readPrivateAsset: async () => Buffer.alloc(0), resourceTypeFor: () => 'raw',
  default: { putPrivateAsset, deletePrivateAsset },
}));
const r2PrivateUrl = async (opts) => { calls.url.push(opts); return `https://private.example.test/${opts.key}?X-Amz-Expires=${opts.ttlSeconds}`; };
jest.unstable_mockModule('../services/storage/privateAssetUrl.js', () => ({
  r2PrivateUrl, providerOf: () => 'r2', default: { r2PrivateUrl, providerOf: () => 'r2' },
}));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: EmployeeDocument } = await import('../models/hr/EmployeeDocument.js');
const { default: HrAuditLog } = await import('../models/hr/HrAuditLog.js');
const { loadHrModels } = await import('../scripts/create-hr-indexes.js');
const docs = await import('../services/hr/documents/index.js');

const PW = 'SecurePass123!';
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);

let n = 0;
async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PW });
  expect(res.status).toBe(200);
  const x = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  const csrf = x ? x.split(';')[0].split('=')[1] : '';
  return {
    get: (u) => agent.get(u),
    post: (u) => agent.post(u).set('X-XSRF-TOKEN', csrf),
    delete: (u) => agent.delete(u).set('X-XSRF-TOKEN', csrf),
  };
}
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase().replace(/\s/g, '')}${n}@autobacs.test`;
  const user = await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return { user, agent: await signIn(email), id: String(user._id) };
};
const team = (t, x = {}) => ({ team: t, active: true, ...x });

describe('HR documents API', () => {
  const prevProvider = process.env.STORAGE_PROVIDER;
  beforeAll(async () => {
    process.env.STORAGE_PROVIDER = 'r2';
    await dbHandler.connect();
    await Promise.all((await loadHrModels()).map((M) => M.init()));
  });
  afterAll(async () => {
    if (prevProvider === undefined) delete process.env.STORAGE_PROVIDER; else process.env.STORAGE_PROVIDER = prevProvider;
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  let admin; let hr; let alice; let bob; let head; let aliceP; let bobP;
  beforeEach(async () => {
    process.env.STORAGE_PROVIDER = 'r2';
    bucket.clear();
    for (const k of Object.keys(calls)) calls[k] = [];
    admin = await makeUser('Admin', 'admin');
    hr = await makeUser('Hema HR', 'staff', team('hr'));
    alice = await makeUser('Alice', 'staff', team('sales'));
    bob = await makeUser('Bob', 'staff', team('sales'));
    head = await makeUser('Sales Head', 'staff', team('sales', { isHead: true }));
    aliceP = (await hr.agent.post('/api/v1/hr/employees').send({ name: 'Alice', user: alice.id })).body.employee;
    bobP = (await hr.agent.post('/api/v1/hr/employees').send({ name: 'Bob', user: bob.id })).body.employee;
  });

  const upload = (who, employeeId, { buf = PDF, name = 'pan.pdf', type = 'application/pdf', kind = 'pan' } = {}) => {
    const r = who.agent.post(`/api/v1/hr/employees/${employeeId}/documents`);
    if (kind) r.field('kind', kind);
    return r.attach('file', buf, { filename: name, contentType: type });
  };

  test('no token → 401', async () => {
    expect((await request(app).get(`/api/v1/hr/employees/${aliceP.id}/documents`)).status).toBe(401);
    expect((await request(app).get(`/api/v1/hr/documents/${new mongoose.Types.ObjectId()}/url`)).status).toBe(401);
  });

  test('an employee uploads their own document to the private bucket and lists it', async () => {
    const r = await upload(alice, aliceP.id, { name: '../../etc/My PAN!.pdf' });
    expect(r.status).toBe(201);
    expect(r.body.document).toMatchObject({ kind: 'pan', mimeType: 'application/pdf', sizeBytes: PDF.length, uploadedBy: alice.id });
    expect(r.body.document.fileName).not.toMatch(/[/!]/);
    expect(r.body.document.storageKey).toBeUndefined();
    const [key] = [...bucket.keys()];
    expect(key.startsWith(`hr/employees/${aliceP.id}/documents/`)).toBe(true);
    const list = await alice.agent.get(`/api/v1/hr/employees/${aliceP.id}/documents`);
    expect(list.body.items.map((d) => d.id)).toEqual([r.body.document.id]);
    expect(await HrAuditLog.countDocuments({ action: 'document.uploaded', subject: aliceP.id })).toBe(1);
  });

  test('HR and admin upload for anyone; PNG photos are fine', async () => {
    expect((await upload(hr, bobP.id, { kind: 'offer_letter' })).status).toBe(201);
    expect((await upload(admin, bobP.id, { buf: PNG, name: 'photo.png', type: 'image/png', kind: 'photo' })).status).toBe(201);
    expect((await hr.agent.get(`/api/v1/hr/employees/${bobP.id}/documents`)).body.items).toHaveLength(2);
  });

  test('employee A cannot list, upload to or open employee B\'s documents (404, like a missing one)', async () => {
    const d = (await upload(hr, bobP.id)).body.document;
    const missing = new mongoose.Types.ObjectId();
    for (const r of [
      await alice.agent.get(`/api/v1/hr/employees/${bobP.id}/documents`),
      await upload(alice, bobP.id),
      await alice.agent.get(`/api/v1/hr/documents/${d.id}/url`),
      await alice.agent.get(`/api/v1/hr/documents/${missing}/url`),
      await alice.agent.get('/api/v1/hr/documents/not-an-id/url'),
    ]) {
      expect(r.status).toBe(404);
      expect(r.body.url).toBeUndefined();
    }
    expect(calls.url).toEqual([]);
    expect(bucket.size).toBe(1);
  });

  test('a team head sees none of the team\'s documents', async () => {
    const d = (await upload(alice, aliceP.id)).body.document;
    expect((await head.agent.get(`/api/v1/hr/employees/${aliceP.id}/documents`)).status).toBe(404);
    expect((await head.agent.get(`/api/v1/hr/documents/${d.id}/url`)).status).toBe(404);
    expect((await upload(head, aliceP.id)).status).toBe(404);
  });

  test('reading gives a 5-minute presigned URL, not stored, not cached', async () => {
    const d = (await upload(alice, aliceP.id)).body.document;
    for (const who of [alice, hr, admin]) {
      const r = await who.agent.get(`/api/v1/hr/documents/${d.id}/url`);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ expiresInSeconds: 300, fileName: d.fileName, mimeType: 'application/pdf' });
      expect(r.headers['cache-control']).toBe('no-store');
    }
    expect(calls.url.every((o) => o.ttlSeconds === 300 && o.key.startsWith(`hr/employees/${aliceP.id}/`))).toBe(true);
  });

  test('fake, wrong-type, oversized, kind-less files are refused and nothing is stored', async () => {
    const cases = [
      { buf: EXE, name: 'pan.pdf', type: 'application/pdf' }, // renamed .exe
      { buf: PDF, name: 'pan.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { buf: PDF, name: 'x.html', type: 'text/html' },
      { buf: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(docs.HR_DOCUMENT_MAX_BYTES)]) },
      { kind: 'passport_scan' },
      { kind: '' },
    ];
    for (const c of cases) {
      const r = await upload(alice, aliceP.id, c);
      expect([c.name || c.kind, r.status]).toEqual([c.name || c.kind, 400]);
    }
    expect(bucket.size).toBe(0);
    expect(await EmployeeDocument.countDocuments()).toBe(0);
  });

  test('without private storage the upload is refused (503), never published', async () => {
    process.env.STORAGE_PROVIDER = 'cloudinary';
    expect((await upload(alice, aliceP.id)).status).toBe(503);
    expect(calls.put).toEqual([]);
  });

  test('delete: HR/admin only, soft, audited; then gone from the list and unreadable; a second delete is 404', async () => {
    const d = (await upload(alice, aliceP.id)).body.document;
    expect((await alice.agent.delete(`/api/v1/hr/documents/${d.id}`)).status).toBe(403);
    const del = await hr.agent.delete(`/api/v1/hr/documents/${d.id}`).send({ reason: 'blurred scan' });
    expect(del.status).toBe(200);
    expect((await hr.agent.delete(`/api/v1/hr/documents/${d.id}`)).status).toBe(404);
    const raw = await EmployeeDocument.findById(d.id).lean();
    expect(raw).toMatchObject({ deletedBy: hr.user._id });
    expect(raw.deletedAt).toBeInstanceOf(Date);
    expect(bucket.size).toBe(1); // soft: the object stays for the record
    expect((await alice.agent.get(`/api/v1/hr/employees/${aliceP.id}/documents`)).body.items).toEqual([]);
    expect((await hr.agent.get(`/api/v1/hr/documents/${d.id}/url`)).status).toBe(404);
    expect(await HrAuditLog.countDocuments({ action: 'document.deleted', entityId: d.id })).toBe(1);
  });

  test('if the row cannot be saved, the stored object is removed', async () => {
    const employee = { _id: new mongoose.Types.ObjectId(aliceP.id), status: 'active' };
    const spy = jest.spyOn(EmployeeDocument, 'create').mockRejectedValueOnce(new Error('db down'));
    await expect(docs.uploadDocument(hr.user, employee, {
      buffer: PDF, size: PDF.length, mimetype: 'application/pdf', originalname: 'pan.pdf',
    }, { kind: 'pan' })).rejects.toThrow('db down');
    spy.mockRestore();
    expect(calls.del).toHaveLength(1);
    expect(bucket.size).toBe(0);
  });

  test('lists page by keyset with no repeats', async () => {
    const ids = [];
    for (let i = 0; i < 5; i += 1) ids.push((await upload(hr, aliceP.id, { kind: 'other' })).body.document.id);
    const seen = [];
    let cursor = null;
    do {
      const r = await alice.agent.get(`/api/v1/hr/employees/${aliceP.id}/documents?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...r.body.items.map((d) => d.id));
      cursor = r.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual([...ids].reverse());
  });
});

/**
 * Careers management is open to HR as well as admin (/api/v1/careers/admin/*).
 *
 * What must hold:
 *   - an ACTIVE hr-team staff member can list/create/update/delete postings,
 *     manage categories, and read/update applications
 *   - admin still can (through the full `admin` gate)
 *   - other staff teams, an INACTIVE hr member, and a customer get 403
 *   - no session is a 401 (auth failure is never a 200)
 *   - the public list reflects an HR write (the `careers` cache tag is purged)
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
const invalidateCache = jest.fn();
const realCache = await import('../middleware/cacheMiddleware.js');
jest.unstable_mockModule('../middleware/cacheMiddleware.js', () => ({ ...realCache, invalidateCache }));

const request = (await import('supertest')).default;
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: JobApplication } = await import('../models/JobApplication.js');

const PW = 'SecurePass123!';
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
    patch: (u) => agent.patch(u).set('X-XSRF-TOKEN', csrf),
    put: (u) => agent.put(u).set('X-XSRF-TOKEN', csrf),
    delete: (u) => agent.delete(u).set('X-XSRF-TOKEN', csrf),
  };
}
const makeUser = async (name, role, staff) => {
  n += 1;
  const email = `${name.toLowerCase().replace(/\s/g, '')}${n}@autobacs.test`;
  await User.create({ name, email, role, staff, phone: '9876543210', passwordHash: await bcrypt.hash(PW, 4) });
  return signIn(email);
};

const BASE = '/api/v1/careers/admin';
let hr; let admin; let sales; let hrInactive; let customer;

beforeAll(async () => { await dbHandler.connect(); });
// tests/setup.js wipes the database after every test, so users are per-test.
beforeEach(async () => {
  hr = await makeUser('Hira HR', 'staff', { team: 'hr', active: true });
  admin = await makeUser('Ada Admin', 'admin');
  sales = await makeUser('Sam Sales', 'staff', { team: 'sales', active: true });
  hrInactive = await makeUser('Old HR', 'staff', { team: 'hr', active: false });
  customer = await makeUser('Cara Customer', 'customer');
});
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

const newApplication = () => JobApplication.create({
  roleTitle: 'Service Advisor', fullName: 'Asha Applicant', city: 'Pune',
  email: 'asha@example.test', whatYouBring: 'Ten years at a workshop.',
});

describe('HR can manage careers', () => {
  test('postings: create → list → read → update → delete, with cache purged on each write', async () => {
    invalidateCache.mockClear();
    const created = await hr.post(`${BASE}/postings`).send({ title: 'Service Advisor', department: 'Workshop', status: 'open' });
    expect(created.status).toBe(201);
    const id = created.body.posting._id;
    expect(invalidateCache).toHaveBeenCalledWith('careers');

    const list = await hr.get(`${BASE}/postings`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain('Service Advisor');

    expect((await hr.get(`${BASE}/postings/${id}`)).status).toBe(200);

    invalidateCache.mockClear();
    const updated = await hr.put(`${BASE}/postings/${id}`).send({ title: 'Senior Service Advisor' });
    expect(updated.status).toBe(200);
    expect(updated.body.posting.title).toBe('Senior Service Advisor');
    expect(invalidateCache).toHaveBeenCalledWith('careers');

    const pub = await request(app).get('/api/v1/careers/postings');
    expect(pub.status).toBe(200);
    expect(JSON.stringify(pub.body)).toContain('Senior Service Advisor');

    invalidateCache.mockClear();
    expect((await hr.delete(`${BASE}/postings/${id}`)).status).toBe(200);
    expect(invalidateCache).toHaveBeenCalledWith('careers');
  });

  test('categories: list and create', async () => {
    const created = await hr.post(`${BASE}/categories`).send({ name: 'Workshop' });
    expect(created.status).toBe(201);
    const list = await hr.get(`${BASE}/categories`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain('Workshop');
  });

  test('applications: list, read and move status', async () => {
    const appDoc = await newApplication();
    const list = await hr.get(`${BASE}/applications`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain('Asha Applicant');

    const one = await hr.get(`${BASE}/applications/${appDoc._id}`);
    expect(one.status).toBe(200);

    const moved = await hr.patch(`${BASE}/applications/${appDoc._id}`).send({ status: 'reviewing' });
    expect(moved.status).toBe(200);
    expect(moved.body.application.status).toBe('reviewing');
  });
});

describe('admin still can', () => {
  test('list postings and applications, create a posting', async () => {
    expect((await admin.get(`${BASE}/postings`)).status).toBe(200);
    expect((await admin.get(`${BASE}/applications`)).status).toBe(200);
    const created = await admin.post(`${BASE}/postings`).send({ title: 'Parts Lead', department: 'Parts' });
    expect(created.status).toBe(201);
  });
});

describe('everyone else is blocked', () => {
  const blocked = () => [
    ['sales staff', sales], ['inactive HR', hrInactive], ['customer', customer],
  ];

  test('other staff, inactive HR and customers get 403 on reads and writes', async () => {
    const appDoc = await newApplication();
    for (const [, who] of blocked()) {
      expect((await who.get(`${BASE}/postings`)).status).toBe(403);
      expect((await who.post(`${BASE}/postings`).send({ title: 'X', department: 'Y' })).status).toBe(403);
      expect((await who.get(`${BASE}/applications`)).status).toBe(403);
      expect((await who.get(`${BASE}/applications/${appDoc._id}`)).status).toBe(403);
      expect((await who.patch(`${BASE}/applications/${appDoc._id}`).send({ status: 'hired' })).status).toBe(403);
      expect((await who.get(`${BASE}/categories`)).status).toBe(403);
    }
    expect((await JobApplication.findById(appDoc._id).lean()).status).toBe('new');
  });

  test('no session is a 401', async () => {
    expect((await request(app).get(`${BASE}/postings`)).status).toBe(401);
    expect((await request(app).get(`${BASE}/applications`)).status).toBe(401);
  });
});

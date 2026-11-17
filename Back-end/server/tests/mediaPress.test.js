import request from 'supertest';
import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';

// The home page's "As featured in" strip is a cached server fetch; every press
// write must ask the storefront to refresh it, or it lingers for the ISR window.
const revalidateFrontendTags = jest.fn();
jest.unstable_mockModule('../services/frontendRevalidator.js', () => ({
  revalidateFrontendTags,
  default: { revalidateFrontendTags },
}));

const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const { default: User } = await import('../models/User.js');
const { default: PressCoverage } = await import('../models/PressCoverage.js');
const dbHandler = await import('./db-handler.js');

const BASE = '/api/v1';

/** Extract the XSRF-TOKEN value from a set-cookie header array. */
function extractCsrfFromSetCookie(setCookieHeader = []) {
  const xsrfCookie = setCookieHeader.find((c) => c.startsWith('XSRF-TOKEN='));
  if (!xsrfCookie) return '';
  return xsrfCookie.split(';')[0].split('=')[1];
}

describe('Press coverage API', () => {
  let agent;
  let csrfToken;

  const testAdmin = {
    name: 'Press Admin',
    email: 'pressadmin@example.com',
    password: 'SecurePass123!',
    role: 'admin',
  };

  beforeAll(async () => { await dbHandler.connect(); });
  afterEach(async () => { await dbHandler.clearDatabase(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });

  beforeEach(async () => {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(testAdmin.password, salt);
    await User.create({ name: testAdmin.name, email: testAdmin.email, passwordHash, role: testAdmin.role });

    agent = request.agent(app);
    await agent.get('/ping');
    const loginRes = await agent.post(`${BASE}/auth/login`).send({ email: testAdmin.email, password: testAdmin.password });

    csrfToken = extractCsrfFromSetCookie(loginRes.headers['set-cookie'] || []);
    if (!csrfToken && agent.jar?.getCookiesSync) {
      const jarCookie = agent.jar.getCookiesSync('http://127.0.0.1').find((c) => c.key === 'XSRF-TOKEN');
      csrfToken = jarCookie ? jarCookie.value : '';
    }
  });

  it('public /media/press returns only published items, featured first', async () => {
    await PressCoverage.create({ publication: 'Draft Pub', headline: 'Hidden', url: 'https://x.com/1', status: 'draft' });
    await PressCoverage.create({ publication: 'Normal Pub', headline: 'Normal', url: 'https://x.com/2', status: 'published', order: 5 });
    await PressCoverage.create({ publication: 'Top Pub', headline: 'Featured', url: 'https://x.com/3', status: 'published', featured: true, order: 9 });

    const res = await request(app).get(`${BASE}/media/press`).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);              // draft excluded
    expect(res.body.data[0].headline).toBe('Featured'); // featured sorts first
  });

  it('admin can create a press item', async () => {
    const res = await agent
      .post(`${BASE}/media/admin/press`)
      .set('X-XSRF-TOKEN', csrfToken)
      .send({ publication: 'Business Standard', headline: 'Autobacs crosses $1M', url: 'https://bs.com/a', date: 'MAR 24, 2025' })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.publication).toBe('Business Standard');
    expect(await PressCoverage.countDocuments()).toBe(1);
  });

  it('admin create requires publication, headline and url', async () => {
    const res = await agent
      .post(`${BASE}/media/admin/press`)
      .set('X-XSRF-TOKEN', csrfToken)
      .send({ publication: 'Only Pub' })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('admin can update and delete a press item', async () => {
    const item = await PressCoverage.create({ publication: 'P', headline: 'Old', url: 'https://x.com/9' });

    const upd = await agent
      .put(`${BASE}/media/admin/press/${item._id}`)
      .set('X-XSRF-TOKEN', csrfToken)
      .send({ headline: 'New headline', featured: true })
      .expect(200);
    expect(upd.body.data.headline).toBe('New headline');
    expect(upd.body.data.featured).toBe(true);

    await agent.delete(`${BASE}/media/admin/press/${item._id}`).set('X-XSRF-TOKEN', csrfToken).expect(200);
    expect(await PressCoverage.countDocuments()).toBe(0);
  });

  it('every press write refreshes the home page strip (create, edit, delete)', async () => {
    revalidateFrontendTags.mockClear();
    const created = await agent
      .post(`${BASE}/media/admin/press`)
      .set('X-XSRF-TOKEN', csrfToken)
      .send({ publication: 'CEO Times', headline: 'H', url: 'https://x.com/r' })
      .expect(201);
    await agent.put(`${BASE}/media/admin/press/${created.body.data._id}`).set('X-XSRF-TOKEN', csrfToken).send({ featured: true }).expect(200);
    await agent.delete(`${BASE}/media/admin/press/${created.body.data._id}`).set('X-XSRF-TOKEN', csrfToken).expect(200);

    expect(revalidateFrontendTags).toHaveBeenCalledTimes(3);
    for (const [tags] of revalidateFrontendTags.mock.calls) expect(tags).toEqual(['home:press']);
  });

  it('a failed write (validation / not found) does not fire a refresh', async () => {
    revalidateFrontendTags.mockClear();
    await agent.post(`${BASE}/media/admin/press`).set('X-XSRF-TOKEN', csrfToken).send({ publication: 'Only' }).expect(400);
    await agent.put(`${BASE}/media/admin/press/507f1f77bcf86cd799439011`).set('X-XSRF-TOKEN', csrfToken).send({ headline: 'x' }).expect(404);
    expect(revalidateFrontendTags).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated admin access', async () => {
    await request(app).get(`${BASE}/media/admin/press`).expect(401);
  });
});

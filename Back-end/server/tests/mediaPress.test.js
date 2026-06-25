import request from 'supertest';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import PressCoverage from '../models/PressCoverage.js';
import * as dbHandler from './db-handler.js';

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
    password: 'password123',
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

  it('rejects unauthenticated admin access', async () => {
    await request(app).get(`${BASE}/media/admin/press`).expect(401);
  });
});

/**
 * GET /api/v1/admin/overview over HTTP: admins only, and the `date` query is
 * validated server-side (a future or invalid date is a 400, not today's numbers).
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import User from '../models/User.js';
import * as dbHandler from './db-handler.js';

const PASSWORD = 'SecurePass123!';
const istDay = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600e3 + offsetDays * 864e5).toISOString().slice(0, 10);

async function tokenFor(role, email) {
  await User.create({ name: role, email, passwordHash: await bcrypt.hash(PASSWORD, 4), role });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='));
  return cookie ? cookie.split(';')[0].slice('accessToken='.length) : res.body.accessToken;
}

describe('GET /api/v1/admin/overview', () => {
  let adminToken;
  beforeAll(() => dbHandler.connect());
  beforeEach(async () => { adminToken = await tokenFor('admin', 'ov-admin@example.com'); });
  afterEach(() => dbHandler.clearDatabase());
  afterAll(async () => {
    await dbHandler.closeDatabase();
    cronService?.shutdown?.();
    adaptiveThrottlingService?.shutdown?.();
  });

  const get = (token, query = '') => request(app).get(`/api/v1/admin/overview${query}`).set('Authorization', `Bearer ${token}`);

  it('needs a login, and an admin', async () => {
    await request(app).get('/api/v1/admin/overview').expect(401);
    const customer = await tokenFor('customer', 'ov-customer@example.com');
    await get(customer).expect(403);
    await get(customer, `?date=${istDay(-1)}`).expect(403);
  });

  it('serves today by default and a past day on request, never cached', async () => {
    const today = await get(adminToken).expect(200);
    expect(today.body.day).toMatchObject({ date: istDay(), isToday: true });
    expect(today.headers['cache-control']).toBe('private, no-store');
    const past = await get(adminToken, `?date=${istDay(-3)}`).expect(200);
    expect(past.body.day).toMatchObject({ date: istDay(-3), isToday: false });
  });

  it('rejects a future or invalid date with a 400', async () => {
    await get(adminToken, `?date=${istDay(1)}`).expect(400);
    await get(adminToken, '?date=2026-02-30').expect(400);
    await get(adminToken, '?date=yesterday').expect(400);
    await get(adminToken, `?date=${istDay(-1)}&date=${istDay(-2)}`).expect(400);
  });
});

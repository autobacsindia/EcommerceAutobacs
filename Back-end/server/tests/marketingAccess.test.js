/**
 * Marketing team access (adminOrMarketing).
 *
 * The boundary a click-through misses: marketing staff can read and edit the
 * marketing areas (coupons, campaigns, spin-to-win, banners, page SEO, blog,
 * leads, consultations) but cannot DELETE company records, cannot upload into
 * catalogue folders, and no other team gets in at all. A deactivated marketer
 * is locked out like anyone else.
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { jest } from '@jest/globals';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import emailHandler from '../services/emailHandler.js';

const BASE = '/api/v1';
const PASSWORD = 'SecurePass123!';
const FAKE_ID = new mongoose.Types.ObjectId().toString();

const csrfFrom = (res) => {
  const xsrf = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return xsrf ? xsrf.split(';')[0].split('=')[1] : '';
};

async function signIn(email) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password: PASSWORD });
  const csrf = csrfFrom(res);
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    del: (url) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf),
  };
}

async function createUser({ email, role = 'customer', staff }) {
  return User.create({
    name: email.split('@')[0], email, role, staff, phone: '9876543210',
    passwordHash: await bcrypt.hash(PASSWORD, 4),
  });
}

/** Every marketing-area list endpoint the panel reads. */
const MARKETING_READS = [
  '/coupons',
  '/campaigns',
  '/spin/admin/campaigns',
  '/promo-banners/admin',
  '/page-seo/admin',
  '/media/admin/articles',
  '/media/admin/press',
  '/leads',
  '/consultation/admin',
];

/** Deletes stay admin-only — staff never remove company records. */
const ADMIN_ONLY_DELETES = [
  `/coupons/${FAKE_ID}`,
  `/promo-banners/admin/${FAKE_ID}`,
  `/spin/admin/prizes/${FAKE_ID}`,
  `/media/admin/articles/${FAKE_ID}`,
  `/media/admin/press/${FAKE_ID}`,
  `/consultation/admin/${FAKE_ID}`,
  `/campaigns/${FAKE_ID}/product-tiers/T1`,
];

describe('Marketing team access', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  beforeEach(() => {
    jest.spyOn(emailHandler, 'sendEmail').mockResolvedValue({ success: true });
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await dbHandler.clearDatabase();
  });

  const marketer = () => createUser({ email: 'mk@autobacs.test', role: 'staff', staff: { team: 'marketing' } });

  it('marketing staff can read every marketing area', async () => {
    await marketer();
    const s = await signIn('mk@autobacs.test');
    for (const url of MARKETING_READS) {
      const res = await s.get(url);
      expect({ url, status: res.status }).toEqual({ url, status: 200 });
    }
  });

  it('marketing staff can write — saves page SEO', async () => {
    await marketer();
    const s = await signIn('mk@autobacs.test');
    const res = await s.put('/page-seo/admin', { path: '/contact', seo: { metaTitle: 'Contact Autobacs' } });
    expect(res.status).toBe(200);
  });

  it('marketing staff cannot delete company records', async () => {
    await marketer();
    const s = await signIn('mk@autobacs.test');
    for (const url of ADMIN_ONLY_DELETES) {
      const res = await s.del(url);
      expect({ url, status: res.status }).toEqual({ url, status: 403 });
    }
  });

  it('marketing staff cannot reach admin-only areas outside marketing', async () => {
    await marketer();
    const s = await signIn('mk@autobacs.test');
    expect((await s.get('/dashboard/stats')).status).toBe(403);
  });

  it('other teams get 403 on every marketing area', async () => {
    await createUser({ email: 'ops@autobacs.test', role: 'staff', staff: { team: 'operations' } });
    const s = await signIn('ops@autobacs.test');
    for (const url of MARKETING_READS) {
      const res = await s.get(url);
      expect({ url, status: res.status }).toEqual({ url, status: 403 });
    }
  });

  it('a deactivated marketer is locked out', async () => {
    await createUser({ email: 'gone@autobacs.test', role: 'staff', staff: { team: 'marketing', active: false } });
    const s = await signIn('gone@autobacs.test');
    const res = await s.get('/coupons');
    expect([401, 403]).toContain(res.status);
  });

  it('customers get 403', async () => {
    await createUser({ email: 'cust@autobacs.test' });
    const s = await signIn('cust@autobacs.test');
    expect((await s.get('/coupons')).status).toBe(403);
  });

  it('admin can still read and is not blocked on deletes by the guard', async () => {
    await createUser({ email: 'boss@autobacs.test', role: 'admin' });
    const s = await signIn('boss@autobacs.test');
    for (const url of MARKETING_READS) {
      expect((await s.get(url)).status).toBe(200);
    }
    // Not found, not forbidden — the guard let the admin through.
    expect((await s.del(`/coupons/${FAKE_ID}`)).status).not.toBe(403);
  });

  describe('uploads', () => {
    it('marketing cannot sign uploads into catalogue folders', async () => {
      await marketer();
      const s = await signIn('mk@autobacs.test');
      for (const folder of ['products', 'brands', 'categories', 'vehicles', 'nonsense', undefined]) {
        const res = await s.post('/uploads/signature', { folder });
        expect({ folder, status: res.status }).toEqual({ folder, status: 403 });
      }
    });

    it('marketing may sign uploads into its own folders', async () => {
      await marketer();
      const s = await signIn('mk@autobacs.test');
      for (const folder of ['articles', 'media', 'promos', 'spin']) {
        const res = await s.post('/uploads/signature', { folder });
        expect({ folder, status: res.status }).not.toEqual({ folder, status: 403 });
      }
    });

    it('marketing cleanup ignores ids outside its folders', async () => {
      await marketer();
      const s = await signIn('mk@autobacs.test');
      const res = await s.post('/uploads/cleanup', {
        publicIds: [
          'autobacs/products/abc',
          'autobacs/media-evil/x',
          'autobacs/media/../products/abc',
          'other/thing',
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(0);
    });

    it('other teams cannot sign uploads at all', async () => {
      await createUser({ email: 'ops@autobacs.test', role: 'staff', staff: { team: 'operations' } });
      const s = await signIn('ops@autobacs.test');
      expect((await s.post('/uploads/signature', { folder: 'articles' })).status).toBe(403);
    });
  });
});

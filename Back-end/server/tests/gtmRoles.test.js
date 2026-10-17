/**
 * GTM roles (config/staff.js). The team stored as 'sales' is shown as GTM; its
 * members are leads (sell, as every sales member always could), executives or
 * customer support (sign in; tools to come).
 *
 * What must hold:
 *   - every existing member is a lead: nothing they could do changes
 *   - the GTM head (and admin) create leads, executives and support logins
 *   - only the GTM head and leads sell: orders, links, quotations, decisions
 *   - roles exist on GTM only
 *   - people read "GTM" everywhere: team label, role, chat space
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import StaffInvite from '../models/StaffInvite.js';
import emailHandler from '../services/emailHandler.js';

const BASE = '/api/v1';
const PASSWORD = 'SecurePass123!';

const csrfFrom = (res) => {
  const xsrf = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return xsrf ? xsrf.split(';')[0].split('=')[1] : '';
};

/** A signed-in browser: cookie jar + CSRF token + verb helpers. */
async function signIn(email, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email, password });
  const csrf = csrfFrom(res);
  return {
    login: res,
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    del: (url) => agent.delete(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf),
  };
}

/** An anonymous browser with a CSRF token, for the public invite endpoints. */
async function anonymous() {
  const agent = request.agent(app);
  const csrf = csrfFrom(await agent.get(`${BASE}/csrf-token`));
  return {
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
  };
}

async function createUser({ name, email, role = 'customer', staff }) {
  return User.create({
    name, email, role, staff, phone: '9876543210',
    passwordHash: await bcrypt.hash(PASSWORD, 4),
  });
}



import { gtmRoleOf, canSell, staffRoleLabel } from '../config/staff.js';

describe('GTM roles', () => {
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  beforeEach(() => { jest.spyOn(emailHandler, 'sendEmail').mockResolvedValue({ success: true }); });
  afterEach(async () => { jest.restoreAllMocks(); await dbHandler.clearDatabase(); });

  const PW = 'Temporary#2026';
  const create = (actor, body) => actor.post('/staff/accounts', { name: 'Person Name', phone: '9876543210', password: PW, ...body });

  let admin, head;
  beforeEach(async () => {
    await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' });
    admin = await signIn('owner@example.com');
    expect((await create(admin, { username: 'gtm.head', team: 'sales', isHead: true })).status).toBe(201);
    head = await signIn('gtm.head', PW);
  });

  describe('helpers', () => {
    const staffUser = (staff) => ({ role: 'staff', staff: { team: 'sales', active: true, ...staff } });
    it.each([
      [{ isHead: true }, 'head', true, 'GTM head'],
      [{}, 'lead', true, 'GTM lead'], // every member from before roles existed
      [{ subRole: 'lead' }, 'lead', true, 'GTM lead'],
      [{ subRole: 'executive' }, 'executive', false, 'GTM executive'],
      [{ subRole: 'support' }, 'support', false, 'Customer support'],
    ])('%p → %s', (staff, role, sells, label) => {
      const u = staffUser(staff);
      expect(gtmRoleOf(u)).toBe(role);
      expect(canSell(u)).toBe(sells);
      expect(staffRoleLabel(u)).toBe(label);
    });

    it('other teams and inactive staff have no GTM role and cannot sell', () => {
      expect(gtmRoleOf({ role: 'staff', staff: { team: 'procurement', active: true } })).toBeNull();
      expect(canSell({ role: 'staff', staff: { team: 'sales', active: false } })).toBe(false);
      expect(staffRoleLabel({ role: 'staff', staff: { team: 'accounts', active: true, isHead: true } })).toBe('Accounts head');
    });
  });

  describe('creating GTM logins', () => {
    it('the GTM head creates a lead, an executive and customer support', async () => {
      for (const [username, subRole] of [['lead.one', 'lead'], ['exec.one', 'executive'], ['support.one', 'support']]) {
        const res = await create(head, { username, subRole });
        expect(res.status).toBe(201);
        expect(res.body.member).toMatchObject({ team: 'sales', isHead: false, subRole });
      }
      const { body } = await head.get('/staff/team');
      expect(body.teamLabel).toBe('GTM');
      expect(body.members.map((m) => m.roleLabel).sort()).toEqual(['Customer support', 'GTM executive', 'GTM head', 'GTM lead']);
    });

    it('a role applies to GTM only, and must be a known one', async () => {
      expect((await create(admin, { username: 'proc.one', team: 'procurement', subRole: 'executive' })).status).toBe(400);
      expect((await create(head, { username: 'odd.one', subRole: 'manager' })).status).toBe(400);
    });

    it('a member created without a role is a lead', async () => {
      await create(head, { username: 'plain.one' });
      expect((await User.findOne({ username: 'plain.one' }).lean()).staff.subRole).toBeUndefined();
      const s = await signIn('plain.one', PW);
      expect(s.login.body.user.staff).toMatchObject({ gtmRole: 'lead', roleLabel: 'GTM lead', canSell: true, teamLabel: 'GTM' });
    });
  });

  describe('only the GTM head and leads sell', () => {
    it('an executive and customer support can sign in but cannot reach any selling tool', async () => {
      await create(head, { username: 'exec.one', subRole: 'executive' });
      await create(head, { username: 'support.one', subRole: 'support' });
      for (const username of ['exec.one', 'support.one']) {
        const s = await signIn(username, PW);
        expect(s.login.status).toBe(200);
        expect(s.login.body.user.staff).toMatchObject({ canSell: false });
        expect((await s.get('/staff/me')).status).toBe(200);
        expect((await s.get('/chat/channels')).status).toBe(200);
        expect((await s.get('/staff/sales/orders')).status).toBe(403);
        expect((await s.get('/staff/sales/products?q=seat')).status).toBe(403);
        expect((await s.post('/staff/sales/orders', {
          customer: { name: 'Caller', email: 'caller@example.com', phone: '9812345678' },
          shippingAddress: { addressLine1: '1 Road', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
          items: [{ product: '0'.repeat(24), quantity: 1 }],
        })).status).toBe(403);
        expect((await s.get('/staff/work?queue=decisions')).status).toBe(403);
        expect((await s.get('/staff/sales/quotations')).status).toBe(403);
        expect((await s.get('/staff/sales/orders/000000000000000000000000/quotation')).status).toBe(403);
      }
    });

    it('a lead keeps every selling tool', async () => {
      await create(head, { username: 'lead.one', subRole: 'lead' });
      const lead = await signIn('lead.one', PW);
      expect((await lead.get('/staff/sales/orders')).status).toBe(200);
      expect((await lead.get('/staff/sales/quotations')).status).toBe(200);
      expect((await lead.get('/staff/work?queue=decisions')).status).toBe(200);
      // Quotation-first: the old one-step "order + link" is retired.
      const old = await lead.post('/staff/sales/orders', {});
      expect(old.status).toBe(410);
      expect(old.body.message).toMatch(/Create a quotation first/);
    });
  });

  describe('people read GTM', () => {
    it('the team space is #gtm, described as the GTM team, and the name is reserved', async () => {
      const { body } = await admin.get('/chat/channels');
      const space = body.channels.find((c) => c.key === 'team:sales');
      expect(space).toMatchObject({ name: 'gtm', description: 'GTM team' });
      expect((await admin.post('/chat/channels', { name: 'gtm' })).status).toBe(409);
    });
  });
});

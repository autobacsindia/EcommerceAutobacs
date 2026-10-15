/**
 * Company accounts: staff logins the company owns (config/staff.js).
 *
 * What must hold:
 *   - an admin creates heads or members in any team; a head creates members of
 *     their own team only; nobody else creates anything
 *   - the person signs in with the username and the password they were given,
 *     and uses the panel straight away — no forced change
 *   - the password is the company's: the person cannot change it; an admin (or
 *     their head) changes it whenever needed, which ends every session at once
 *   - a Gmail (invite) account can never be reset by someone else, and its
 *     owner can still change their own
 *   - removing access blocks the username login outright, answered like a wrong
 *     password; the account and its history remain
 *   - no email ever goes to the internal company address, and forgot-password
 *     cannot reach a company account
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


describe('Company accounts', () => {
  let sendSpy;
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  beforeEach(() => {
    sendSpy = jest.spyOn(emailHandler, 'sendEmail').mockResolvedValue({ success: true });
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await dbHandler.clearDatabase();
  });

  const TEMP = 'Temporary#2026';
  const MINE = 'MyOwnSecret#88';
  const create = (actor, body) => actor.post('/staff/accounts', {
    name: 'Sam Kumar', phone: '9876543210', password: TEMP, ...body,
  });

  let admin;
  beforeEach(async () => {
    await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' });
    admin = await signIn('owner@example.com');
  });

  /** Create, then sign in with the username and the password the admin set. */
  async function onboard(actor, body) {
    expect((await create(actor, body)).status).toBe(201);
    const s = await signIn(body.username, TEMP);
    expect(s.login.status).toBe(200);
    return s;
  }

  describe('creating', () => {
    it('admin creates a company account; it has a username and no real email', async () => {
      const res = await create(admin, { username: 'Sam.Sales', team: 'sales' });
      expect(res.status).toBe(201);
      expect(res.body.member).toMatchObject({ username: 'sam.sales', companyAccount: true, email: '', team: 'sales', isHead: false });
      const user = await User.findOne({ username: 'sam.sales' }).lean();
      expect(user).toMatchObject({ role: 'staff', companyAccount: true, email: 'sam.sales@staff.autobacs.invalid' });
    });

    it('lists company accounts with their username in the team', async () => {
      await create(admin, { username: 'sam.sales', team: 'sales' });
      const { body } = await admin.get('/staff/team?team=sales');
      expect(body.members).toEqual([expect.objectContaining({ username: 'sam.sales', companyAccount: true, email: '' })]);
    });

    it('rejects a taken, malformed or email-shaped username', async () => {
      await create(admin, { username: 'sam.sales', team: 'sales' });
      expect((await create(admin, { username: 'SAM.SALES', team: 'sales' })).status).toBe(409);
      expect((await create(admin, { username: 'a', team: 'sales' })).status).toBe(400);
      expect((await create(admin, { username: 'sam@x.com', team: 'sales' })).status).toBe(400);
      expect((await create(admin, { username: '.sam', team: 'sales' })).status).toBe(400);
    });

    it('rejects a weak password', async () => {
      expect((await create(admin, { username: 'sam.sales', team: 'sales', password: 'short' })).status).toBe(400);
    });

    it('a head creates members of their own team only — never heads, never another team', async () => {
      const head = await onboard(admin, { username: 'hana.head', team: 'sales', isHead: true });
      expect((await create(head, { username: 'mem.one', team: 'sales' })).status).toBe(201);
      expect((await create(head, { username: 'mem.two' })).status).toBe(201); // pinned to their team
      expect((await User.findOne({ username: 'mem.two' }).lean()).staff.team).toBe('sales');
      expect((await create(head, { username: 'head.two', team: 'sales', isHead: true })).status).toBe(403);
      expect((await create(head, { username: 'proc.one', team: 'procurement' })).status).toBe(403);
    });

    it('a member or a customer cannot create accounts', async () => {
      const member = await onboard(admin, { username: 'mem.ber', team: 'sales' });
      expect((await create(member, { username: 'xavier' })).status).toBe(403);
      await createUser({ name: 'Cust', email: 'cust@example.com' });
      const customer = await signIn('cust@example.com');
      expect((await create(customer, { username: 'yusuf', team: 'sales' })).status).toBe(403);
    });
  });

  describe('signing in', () => {
    it('signs in with the username (any case) and the given password, and uses the panel at once', async () => {
      await create(admin, { username: 'sam.sales', team: 'sales' });
      const s = await signIn('Sam.Sales', TEMP);
      expect(s.login.status).toBe(200);
      expect(s.login.body.user).toMatchObject({ username: 'sam.sales', role: 'staff' });
      expect(s.login.body.user.mustChangePassword).toBeUndefined();
      expect((await s.get('/staff/team')).status).toBe(200);
      expect((await s.get('/chat/channels')).status).toBe(200);
    });

    it('cannot change their own password — the admin manages it', async () => {
      const s = await onboard(admin, { username: 'sam.sales', team: 'sales' });
      const res = await s.post('/staff/password', { currentPassword: TEMP, newPassword: MINE });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/managed by your administrator/);
      expect((await signIn('sam.sales', TEMP)).login.status).toBe(200);
    });

    it('a staff member on their own email can still change theirs', async () => {
      await createUser({ name: 'Ravi', email: 'ravi@gmail.com', role: 'staff', staff: { team: 'sales', isHead: false, active: true } });
      const ravi = await signIn('ravi@gmail.com');
      expect((await ravi.post('/staff/password', { currentPassword: PASSWORD, newPassword: MINE })).status).toBe(200);
      expect((await ravi.get('/staff/team')).status).toBe(200); // this session survives
      expect((await signIn('ravi@gmail.com', MINE)).login.status).toBe(200);
    });
  });

  describe('resetting someone else', () => {
    it('an admin change takes effect at once: old password dead, every session ended, new one works', async () => {
      const sam = await onboard(admin, { username: 'sam.sales', team: 'sales' });
      const { body } = await admin.get('/staff/team?team=sales');
      const res = await admin.post(`/staff/members/${body.members[0].id}/password`, { password: 'AdminChose#2026' });
      expect(res.status).toBe(200);

      expect((await sam.get('/staff/team')).status).toBe(401);
      expect((await signIn('sam.sales', TEMP)).login.status).toBe(401);
      const again = await signIn('sam.sales', 'AdminChose#2026');
      expect(again.login.status).toBe(200);
      expect((await again.get('/staff/team')).status).toBe(200);
    });

    it('a head resets members of their own team, but not a head or another team', async () => {
      const head = await onboard(admin, { username: 'hana.head', team: 'sales', isHead: true });
      await create(admin, { username: 'sam.sales', team: 'sales' });
      await create(admin, { username: 'other.head', team: 'sales', isHead: true });
      await create(admin, { username: 'pat.proc', team: 'procurement' });
      const id = async (username) => String((await User.findOne({ username }).lean())._id);

      expect((await head.post(`/staff/members/${await id('sam.sales')}/password`, { password: 'HeadChose#2026' })).status).toBe(200);
      expect((await head.post(`/staff/members/${await id('other.head')}/password`, { password: 'HeadChose#2026' })).status).toBe(403);
      expect((await head.post(`/staff/members/${await id('pat.proc')}/password`, { password: 'HeadChose#2026' })).status).toBe(403);
    });

    it('a Gmail (invite) staff account can never be reset by someone else', async () => {
      const gmail = await createUser({ name: 'Ravi', email: 'ravi@gmail.com', role: 'staff', staff: { team: 'sales', isHead: false, active: true } });
      const res = await admin.post(`/staff/members/${gmail._id}/password`, { password: 'AdminChose#2026' });
      expect(res.status).toBe(400);
      expect(await bcrypt.compare(PASSWORD, (await User.findById(gmail._id)).passwordHash)).toBe(true);
    });
  });

  describe('when someone leaves', () => {
    it('removing access blocks the username login like a wrong password, and keeps the account', async () => {
      const sam = await onboard(admin, { username: 'sam.sales', team: 'sales' });
      const user = await User.findOne({ username: 'sam.sales' }).lean();
      expect((await admin.post(`/staff/members/${user._id}/deactivate`)).status).toBe(200);

      expect((await sam.get('/staff/me')).status).toBe(401);
      const login = await signIn('sam.sales', TEMP);
      expect(login.login.status).toBe(401);
      expect(login.login.body.message).toBe((await signIn('sam.sales', 'not-the-password')).login.body.message);
      expect(await User.exists({ _id: user._id })).toBeTruthy();
    });
  });

  describe('email never reaches the internal address', () => {
    it('forgot-password for a company account sends nothing', async () => {
      await create(admin, { username: 'sam.sales', team: 'sales' });
      sendSpy.mockClear();
      const anon = await anonymous();
      const res = await anon.post('/auth/forgot-password', { email: 'sam.sales@staff.autobacs.invalid' });
      expect(res.status).toBeLessThan(500);
      expect(sendSpy).not.toHaveBeenCalled();
      expect((await User.findOne({ username: 'sam.sales' }).lean()).resetPasswordToken).toBeFalsy();
    });

    it('the mailer refuses an .invalid recipient without calling the provider', async () => {
      jest.restoreAllMocks();
      const before = emailHandler.isEnabled;
      emailHandler.isEnabled = true;
      const provider = jest.spyOn(emailHandler.client || { sendEmail: () => {} }, 'sendEmail');
      try {
        const res = await emailHandler.sendEmail({ to: 'sam@staff.autobacs.invalid', subject: 's', text: 't' });
        expect(res).toMatchObject({ success: false, skipped: true, retryable: false });
        expect(provider).not.toHaveBeenCalled();
      } finally {
        emailHandler.isEnabled = before;
      }
    });
  });

  describe('ordinary logins are unchanged', () => {
    it('email login still works, and a customer has no username login', async () => {
      await createUser({ name: 'Cust', email: 'cust@example.com' });
      expect((await signIn('cust@example.com')).login.status).toBe(200);
      expect((await signIn('cust', PASSWORD)).login.status).toBe(401);
    });
  });
});

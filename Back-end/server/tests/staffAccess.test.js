/**
 * Staff access over HTTP: invites, team scope, redemption and removal.
 *
 * The cases here are the capability boundaries a click-through misses: that a team
 * head cannot mint a head, act on another team or reach the admin API; that an
 * invite link works exactly once and dies with the person who sent it; and that
 * removing someone ends their sessions at once — refresh token included, not just
 * the access token.
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

describe('Staff access', () => {
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

  /** The raw token from the most recent invite email. */
  const lastInviteToken = () => {
    const { text } = sendSpy.mock.calls.at(-1)[0];
    return text.match(/staff-invite\?token=([a-f0-9]+)/)[1];
  };

  const invite = (actor, body) => actor.post('/staff/invites', {
    name: 'Test Person', phone: '9876543210', ...body,
  });

  /** Admin invites, the invitee accepts — returns a signed-in session for them. */
  async function onboard(actor, body) {
    const res = await invite(actor, body);
    expect(res.status).toBe(201);
    const accept = await (await anonymous()).post('/staff/invites/accept', { token: lastInviteToken(), password: PASSWORD });
    expect(accept.status).toBe(200);
    return signIn(body.email);
  }

  let admin;
  beforeEach(async () => {
    await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' });
    admin = await signIn('owner@example.com');
  });

  describe('admin → team head', () => {
    it('creates a head only after the invite link is redeemed', async () => {
      const res = await invite(admin, { email: 'head@example.com', team: 'sales', isHead: true });
      expect(res.status).toBe(201);
      expect(res.body.emailSent).toBe(true);
      // Nothing is granted at invite time.
      expect(await User.findOne({ email: 'head@example.com' })).toBeNull();

      const anon = await anonymous();
      const token = lastInviteToken();
      const verify = await anon.get(`/staff/invites/verify?token=${token}`);
      expect(verify.status).toBe(200);
      expect(verify.body.invite).toMatchObject({ email: 'head@example.com', teamLabel: 'Sales', isHead: true });

      const accept = await anon.post('/staff/invites/accept', { token, password: PASSWORD });
      expect(accept.status).toBe(200);

      const head = await User.findOne({ email: 'head@example.com' });
      expect(head.role).toBe('staff');
      expect(head.staff).toMatchObject({ team: 'sales', isHead: true, active: true });

      const session = await signIn('head@example.com');
      expect(session.login.body.user.staff).toEqual({ team: 'sales', teamLabel: 'Sales', isHead: true });
      const me = await session.get('/auth/me');
      expect(me.body.user.staff.team).toBe('sales');
    });

    it('stores only a hash of the invite token', async () => {
      await invite(admin, { email: 'head@example.com', team: 'sales', isHead: true });
      const row = await StaffInvite.findOne({ email: 'head@example.com' });
      expect(row.tokenHash).not.toBe(lastInviteToken());
    });

    it('refuses to put an administrator account on a team', async () => {
      await createUser({ name: 'Other admin', email: 'admin2@example.com', role: 'admin' });
      const res = await invite(admin, { email: 'admin2@example.com', team: 'sales' });
      expect(res.status).toBe(409);
    });
  });

  describe('invite links', () => {
    it('work exactly once', async () => {
      await invite(admin, { email: 'head@example.com', team: 'sales', isHead: true });
      const token = lastInviteToken();
      const anon = await anonymous();
      expect((await anon.post('/staff/invites/accept', { token, password: PASSWORD })).status).toBe(200);
      expect((await anon.post('/staff/invites/accept', { token, password: 'AnotherPass456!' })).status).toBe(400);
    });

    it('stop working once expired', async () => {
      await invite(admin, { email: 'head@example.com', team: 'sales', isHead: true });
      await StaffInvite.updateOne({ email: 'head@example.com' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const res = await (await anonymous()).post('/staff/invites/accept', { token: lastInviteToken(), password: PASSWORD });
      expect(res.status).toBe(400);
      expect(await User.findOne({ email: 'head@example.com' })).toBeNull();
    });

    it('stop working once withdrawn', async () => {
      const created = await invite(admin, { email: 'head@example.com', team: 'sales', isHead: true });
      const token = lastInviteToken();
      expect((await admin.del(`/staff/invites/${created.body.invite.id}`)).status).toBe(200);
      expect((await (await anonymous()).post('/staff/invites/accept', { token, password: PASSWORD })).status).toBe(400);
    });

    it('are superseded by a newer invite to the same address', async () => {
      await invite(admin, { email: 'head@example.com', team: 'sales', isHead: true });
      const oldToken = lastInviteToken();
      await invite(admin, { email: 'head@example.com', team: 'sales', isHead: true });
      expect((await (await anonymous()).post('/staff/invites/accept', { token: oldToken, password: PASSWORD })).status).toBe(400);
    });

    it("die with the head who sent them", async () => {
      const head = await onboard(admin, { email: 'head@example.com', team: 'sales', isHead: true });
      await invite(head, { email: 'rep@example.com' });
      const token = lastInviteToken();
      const headUser = await User.findOne({ email: 'head@example.com' });
      expect((await admin.post(`/staff/members/${headUser._id}/deactivate`)).status).toBe(200);

      const res = await (await anonymous()).post('/staff/invites/accept', { token, password: PASSWORD });
      expect(res.status).toBe(400);
      expect(await User.findOne({ email: 'rep@example.com' })).toBeNull();
    });

    it("turn an existing customer into staff without losing the account, and end its old sessions", async () => {
      const customer = await createUser({ name: 'Shopper', email: 'shopper@example.com' });
      const oldSession = await signIn('shopper@example.com');
      expect((await oldSession.get('/auth/me')).status).toBe(200);

      const res = await invite(admin, { email: 'shopper@example.com', team: 'accounts' });
      expect(res.body.existingAccount).toBe(true);
      await (await anonymous()).post('/staff/invites/accept', { token: lastInviteToken(), password: 'BrandNewPass789!' });

      const after = await User.findById(customer._id);
      expect(after.role).toBe('staff');
      expect(after.staff.team).toBe('accounts');
      expect((await oldSession.get('/auth/me')).status).toBe(401);
      expect((await signIn('shopper@example.com', 'BrandNewPass789!')).login.status).toBe(200);
    });
  });

  describe('team head scope', () => {
    let head;
    beforeEach(async () => {
      head = await onboard(admin, { email: 'head@example.com', team: 'sales', isHead: true });
    });

    it('can add members to their own team', async () => {
      await onboard(head, { email: 'rep@example.com' });
      const rep = await User.findOne({ email: 'rep@example.com' });
      expect(rep.staff).toMatchObject({ team: 'sales', isHead: false, active: true });

      const team = await head.get('/staff/team');
      expect(team.body.members.map((m) => m.email).sort()).toEqual(['head@example.com', 'rep@example.com']);
      expect(team.body.canManage).toBe(true);
    });

    it('cannot add a head', async () => {
      expect((await invite(head, { email: 'x@example.com', isHead: true })).status).toBe(403);
    });

    it('cannot add people to another team', async () => {
      expect((await invite(head, { email: 'x@example.com', team: 'accounts' })).status).toBe(403);
      expect((await head.get('/staff/team?team=accounts')).status).toBe(403);
    });

    it('cannot remove another head or themselves', async () => {
      await onboard(admin, { email: 'head2@example.com', team: 'accounts', isHead: true });
      const otherHead = await User.findOne({ email: 'head2@example.com' });
      const self = await User.findOne({ email: 'head@example.com' });
      expect((await head.post(`/staff/members/${otherHead._id}/deactivate`)).status).toBe(403);
      expect((await head.post(`/staff/members/${self._id}/deactivate`)).status).toBe(400);
    });

    it('cannot reach the admin API', async () => {
      expect((await head.get('/sales-reps')).status).toBe(403);
      expect((await head.get('/orders/refunds')).status).toBe(403);
    });
  });

  describe('members and customers', () => {
    it('a member can view their team but cannot add anyone', async () => {
      const head = await onboard(admin, { email: 'head@example.com', team: 'sales', isHead: true });
      const rep = await onboard(head, { email: 'rep@example.com' });
      const team = await rep.get('/staff/team');
      expect(team.status).toBe(200);
      expect(team.body.canManage).toBe(false);
      expect((await invite(rep, { email: 'x@example.com' })).status).toBe(403);
    });

    it('a customer is shut out of the staff panel', async () => {
      await createUser({ name: 'Shopper', email: 'shopper@example.com' });
      const shopper = await signIn('shopper@example.com');
      expect((await shopper.get('/staff/me')).status).toBe(403);
      expect((await shopper.get('/staff/team?team=sales')).status).toBe(403);
    });

    it('an anonymous caller is shut out', async () => {
      expect((await (await anonymous()).get('/staff/team')).status).toBe(401);
    });
  });

  describe('removing access', () => {
    it('signs the person out everywhere at once and leaves an ordinary account', async () => {
      const head = await onboard(admin, { email: 'head@example.com', team: 'sales', isHead: true });
      const rep = await onboard(head, { email: 'rep@example.com' });
      expect((await rep.get('/staff/me')).status).toBe(200);

      const repUser = await User.findOne({ email: 'rep@example.com' });
      expect((await head.post(`/staff/members/${repUser._id}/deactivate`)).status).toBe(200);

      // The live access token is dead…
      expect((await rep.get('/staff/me')).status).toBe(401);
      // …and so is the refresh token, which could otherwise mint a new one.
      expect((await rep.post('/auth/refresh')).status).toBe(401);

      const after = await User.findById(repUser._id);
      expect(after.role).toBe('customer');
      expect(after.staff.active).toBe(false);

      // Signing in again gives a customer account with no staff panel.
      const again = await signIn('rep@example.com');
      expect(again.login.status).toBe(200);
      expect(again.login.body.user.staff).toBeNull();
      expect((await again.get('/staff/me')).status).toBe(403);
    });
  });
});

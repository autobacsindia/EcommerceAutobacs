/**
 * Admin edits a team member (PUT /staff/members/:id).
 *
 *   - name / mobile: saved, the person stays signed in
 *   - team / head / GTM role: saved, every session ends (new permissions apply)
 *   - username (company login): moves the login; the old one stops working
 *   - only an admin may edit; a removed member cannot be edited
 *   - "delete" = remove access: hidden from the team, can no longer sign in
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import emailHandler from '../services/emailHandler.js';

const BASE = '/api/v1';
const PASSWORD = 'SecurePass123!';
const csrfFrom = (res) => {
  const xsrf = (res.headers['set-cookie'] || []).find((c) => c.startsWith('XSRF-TOKEN='));
  return xsrf ? xsrf.split(';')[0].split('=')[1] : '';
};
async function signIn(login, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post(`${BASE}/auth/login`).send({ email: login, password });
  const csrf = csrfFrom(res);
  return {
    login: res,
    get: (url) => agent.get(`${BASE}${url}`),
    post: (url, body = {}) => agent.post(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
    put: (url, body = {}) => agent.put(`${BASE}${url}`).set('X-XSRF-TOKEN', csrf).send(body),
  };
}

describe('Admin edits team members', () => {
  let admin;
  beforeAll(async () => { await dbHandler.connect(); });
  afterAll(async () => {
    await dbHandler.closeDatabase();
    if (cronService?.shutdown) cronService.shutdown();
    if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
  });
  beforeEach(async () => {
    jest.spyOn(emailHandler, 'sendEmail').mockResolvedValue({ success: true });
    await User.create({ name: 'Owner', email: 'owner@autobacs.test', role: 'admin', phone: '9876543210', passwordHash: await bcrypt.hash(PASSWORD, 4) });
    admin = await signIn('owner@autobacs.test');
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await dbHandler.clearDatabase();
  });

  const companyLogin = async (body = {}) => {
    const res = await admin.post('/staff/accounts', {
      name: 'Midhun Biju', username: 'midhun.operations', phone: '9895470305', password: PASSWORD, team: 'operations', ...body,
    });
    expect(res.status).toBe(201);
    return res.body.member;
  };

  it('name and mobile change without signing the person out', async () => {
    const m = await companyLogin();
    const person = await signIn('midhun.operations');
    const res = await admin.put(`/staff/members/${m.id}`, { name: 'Midhun B', phone: '98954 70306' });
    expect(res.status).toBe(200);
    expect(res.body.member).toMatchObject({ name: 'Midhun B', phone: '9895470306' });
    expect((await person.get('/staff/me')).status).toBe(200);
  });

  it('moving to another team / making head signs them out; they come back with the new role', async () => {
    const m = await companyLogin();
    const person = await signIn('midhun.operations');
    const res = await admin.put(`/staff/members/${m.id}`, { team: 'procurement', isHead: true });
    expect(res.body.member).toMatchObject({ team: 'procurement', isHead: true });
    expect((await person.get('/staff/me')).status).toBe(401);
    const again = await signIn('midhun.operations');
    expect(again.login.body.user.staff).toMatchObject({ team: 'procurement', isHead: true });
  });

  it('a GTM role applies to GTM only and is cleared for a head', async () => {
    const m = await companyLogin({ team: 'sales', username: 'asha.gtm', subRole: 'executive' });
    expect((await admin.put(`/staff/members/${m.id}`, { subRole: 'support' })).body.member.subRole).toBe('support');
    expect((await admin.put(`/staff/members/${m.id}`, { isHead: true })).body.member.subRole).toBeNull();
    expect((await admin.put(`/staff/members/${m.id}`, { team: 'accounts', isHead: false })).body.member.subRole).toBeNull();
  });

  it('a new username moves the login; the old one stops working', async () => {
    const m = await companyLogin();
    const res = await admin.put(`/staff/members/${m.id}`, { username: 'midhun.ops' });
    expect(res.status).toBe(200);
    expect((await signIn('midhun.ops')).login.status).toBe(200);
    expect((await signIn('midhun.operations')).login.status).toBe(401);
    const saved = await User.findById(m.id).lean();
    expect(saved.email).toBe('midhun.ops@staff.autobacs.invalid');
  });

  it('refuses a username someone else has', async () => {
    const a = await companyLogin();
    await companyLogin({ name: 'Akash CT', username: 'akash.operations' });
    expect((await admin.put(`/staff/members/${a.id}`, { username: 'akash.operations' })).status).toBe(409);
  });

  it('only an admin may edit — not a team head', async () => {
    await companyLogin({ name: 'Head', username: 'ops.head', isHead: true });
    const m = await companyLogin();
    const head = await signIn('ops.head');
    expect((await head.put(`/staff/members/${m.id}`, { name: 'Changed' })).status).toBe(403);
  });

  it('"delete" (remove access) hides them from the team and blocks sign-in; history stays on the account', async () => {
    const m = await companyLogin();
    expect((await admin.post(`/staff/members/${m.id}/deactivate`)).status).toBe(200);
    const team = await admin.get('/staff/team?team=operations');
    expect(team.body.members.map((x) => x.id)).not.toContain(m.id);
    expect((await signIn('midhun.operations')).login.status).not.toBe(200);
    expect(await User.exists({ _id: m.id })).toBeTruthy(); // kept: orders, chats, approvals still name them
    expect((await admin.put(`/staff/members/${m.id}`, { name: 'Someone Else' })).status).toBe(404);
  });
});

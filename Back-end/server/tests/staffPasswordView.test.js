/**
 * Looking up staff passwords in the team panel (staffService.getMemberPassword):
 * the owner's decision to keep an encrypted copy of every staff password.
 *
 * What must hold:
 *   - the admin sees any staff member's current password; a head sees their own
 *     team's members only — not another head, not their own, not another team;
 *     members, customers and anonymous callers see nothing
 *   - it is the CURRENT password: after Change password, after the person changes
 *     their own, after accepting an invite with their own choice
 *   - a password set before this existed, or changed some other way since, reads
 *     "not saved" — never a stale value
 *   - the copy is stored encrypted, never sent in any list, removed when access is
 *     removed; every look-up is audit-logged and not cached
 */

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';
import { app, cronService, adaptiveThrottlingService } from '../app.js';
import * as dbHandler from './db-handler.js';
import User from '../models/User.js';
import StaffInvite from '../models/StaffInvite.js';
import emailHandler from '../services/emailHandler.js';
import AuditLog from '../models/AuditLog.js';

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



describe('Seeing staff passwords', () => {
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
  const create = (actor, body) => actor.post('/staff/accounts', { name: 'Sam Kumar', phone: '9876543210', password: TEMP, ...body });
  const idOf = async (username) => String((await User.findOne({ username }).lean())._id);
  const look = (actor, id) => actor.get(`/staff/members/${id}/password`);

  let admin;
  beforeEach(async () => {
    await createUser({ name: 'Owner', email: 'owner@example.com', role: 'admin' });
    admin = await signIn('owner@example.com');
  });

  it('the admin sees the password a login was created with, and the new one after Change password', async () => {
    expect((await create(admin, { username: 'sam.sales', team: 'sales' })).status).toBe(201);
    const id = await idOf('sam.sales');

    let res = await look(admin, id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ password: TEMP, reason: null });
    expect(res.headers['cache-control']).toBe('no-store');

    await admin.post(`/staff/members/${id}/password`, { password: 'AdminChose#2026' });
    res = await look(admin, id);
    expect(res.body.password).toBe('AdminChose#2026');
    // And it really is the login password.
    expect((await signIn('sam.sales', res.body.password)).login.status).toBe(200);
  });

  it('a head sees their own team\'s members only — not a head, not themselves, not another team', async () => {
    await create(admin, { username: 'hana.head', team: 'sales', isHead: true });
    const head = await signIn('hana.head', TEMP);
    await create(admin, { username: 'sam.sales', team: 'sales' });
    await create(admin, { username: 'other.head', team: 'sales', isHead: true });
    await create(admin, { username: 'pat.proc', team: 'procurement' });

    expect((await look(head, await idOf('sam.sales'))).body.password).toBe(TEMP);
    for (const u of ['other.head', 'hana.head', 'pat.proc']) {
      expect((await look(head, await idOf(u))).status).toBe(403);
    }
    // The admin sees heads too.
    expect((await look(admin, await idOf('hana.head'))).body.password).toBe(TEMP);
  });

  it('members, customers and anonymous callers see nothing', async () => {
    await create(admin, { username: 'sam.sales', team: 'sales' });
    await create(admin, { username: 'tia.sales', team: 'sales' });
    const member = await signIn('tia.sales', TEMP);
    await createUser({ name: 'Cust', email: 'cust@example.com' });
    const customer = await signIn('cust@example.com');
    const id = await idOf('sam.sales');

    expect((await look(member, id)).status).toBe(403);
    expect((await look(customer, id)).status).toBe(403);
    expect([401, 403]).toContain((await request(app).get(`${BASE}/staff/members/${id}/password`)).status);
  });

  it('the team list says whose password each person may see', async () => {
    await create(admin, { username: 'hana.head', team: 'sales', isHead: true });
    await create(admin, { username: 'sam.sales', team: 'sales' });
    const head = await signIn('hana.head', TEMP);
    const member = await signIn('sam.sales', TEMP);
    const flags = async (s, q = '') => Object.fromEntries((await s.get(`/staff/team${q}`)).body.members.map((m) => [m.username, m.canViewPassword]));

    expect(await flags(admin, '?team=sales')).toEqual({ 'hana.head': true, 'sam.sales': true });
    expect(await flags(head)).toEqual({ 'hana.head': false, 'sam.sales': true });
    expect(await flags(member)).toEqual({ 'hana.head': false, 'sam.sales': false });
  });

  it('a password the person chose themselves is shown too — on accepting an invite and on changing it', async () => {
    expect((await admin.post('/staff/invites', { name: 'Ravi', phone: '9876543210', email: 'ravi@gmail.com', team: 'sales' })).status).toBe(201);
    const token = sendSpy.mock.calls.at(-1)[0].text.match(/staff-invite\?token=([a-f0-9]+)/)[1];
    expect((await (await anonymous()).post('/staff/invites/accept', { token, password: 'RaviChose#2026' })).status).toBe(200);
    const id = String((await User.findOne({ email: 'ravi@gmail.com' }).lean())._id);
    expect((await look(admin, id)).body.password).toBe('RaviChose#2026');

    const ravi = await signIn('ravi@gmail.com', 'RaviChose#2026');
    expect((await ravi.post('/staff/password', { currentPassword: 'RaviChose#2026', newPassword: 'RaviNewer#2027' })).status).toBe(200);
    expect((await look(admin, id)).body.password).toBe('RaviNewer#2027');
  });

  it('set before this existed, or changed some other way since: "not saved" — never a stale password', async () => {
    const old = await createUser({ name: 'Old', email: 'old@gmail.com', role: 'staff', staff: { team: 'sales', isHead: false, active: true } });
    expect((await look(admin, String(old._id))).body).toEqual({ success: true, password: null, reason: 'not_saved' });

    await create(admin, { username: 'sam.sales', team: 'sales' });
    const id = await idOf('sam.sales');
    await User.updateOne({ _id: id }, { $set: { passwordHash: await bcrypt.hash('ChangedElsewhere#1', 4) } });
    expect((await look(admin, id)).body).toMatchObject({ password: null, reason: 'not_saved' });
  });

  it('stored encrypted, never in a list, removed when access is removed; every look-up is logged', async () => {
    await create(admin, { username: 'sam.sales', team: 'sales' });
    const id = await idOf('sam.sales');
    const stored = (await User.findById(id).select('+staffPasswordView').lean()).staffPasswordView;
    expect(stored).toMatch(/^enc:v1:/);
    expect(stored).not.toContain(TEMP);
    const list = await admin.get('/staff/team?team=sales');
    expect(JSON.stringify(list.body)).not.toContain(TEMP);
    expect(JSON.stringify(list.body)).not.toContain('enc:v1');
    expect(JSON.stringify((await User.findById(id)).toJSON())).not.toContain('enc:v1');

    await look(admin, id);
    await new Promise((r) => setTimeout(r, 50)); // the audit write is fire-and-forget
    expect(await AuditLog.countDocuments({ action: 'READ_SENSITIVE', resourceId: id })).toBeGreaterThanOrEqual(1);

    expect((await admin.post(`/staff/members/${id}/deactivate`)).status).toBe(200);
    expect((await User.findById(id).select('+staffPasswordView').lean()).staffPasswordView).toBeUndefined();
    expect((await look(admin, id)).status).toBe(404);
  });
});

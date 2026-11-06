/**
 * The GTM leads sheet over HTTP (/api/v1/staff/leads): who gets in, the follow-up
 * race (two people at once → one owner), double clicks, release / reassign rules,
 * who sees phone numbers, keyset pages, and that admin's CRM sees the same history.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Lead } = await import('../models/Lead.js');

const BASE = '/api/v1';
const DAY = 24 * 60 * 60 * 1000;

jest.setTimeout(120000);
beforeAll(async () => { await dbHandler.connect(); });
afterEach(async () => { await dbHandler.clearDatabase(); });
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

let n = 0;
async function login(role, staff, name) {
  n += 1;
  const email = `u${n}@autobacs.test`;
  const password = 'SecurePass123!';
  const user = await User.create({
    name: name || `User ${n}`, email, phone: '9000000001', passwordHash: await bcrypt.hash(password, 10), role,
    ...(staff && { staff: { active: true, isHead: false, ...staff } }),
  });
  const res = await request(app).post(`${BASE}/auth/login`).send({ email, password });
  const token = (res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken='))
    .split(';')[0].slice('accessToken='.length);
  return { token, user };
}
const as = (who) => ({ Authorization: `Bearer ${who.token}` });
const gtmLead = (name) => login('staff', { team: 'sales', subRole: 'lead' }, name);
const gtmHead = (name) => login('staff', { team: 'sales', isHead: true }, name);

let k = 0;
async function makeLead(over = {}) {
  k += 1;
  return Lead.create({
    name: `Customer ${k}`, phone: `98765${String(k).padStart(5, '0')}`, email: `c${k}@mail.test`,
    identityKey: `phone:98765${String(k).padStart(5, '0')}`,
    primarySource: 'payment_failed', status: 'new', leadScore: 50,
    sources: [{ type: 'payment_failed', snapshot: { total: 18400, itemCount: 2 } }],
    ...over,
  });
}

describe('who gets in', () => {
  it('401 without a login', async () => {
    const lead = await makeLead();
    await request(app).get(`${BASE}/staff/leads`).expect(401);
    // A cookie-less POST is stopped even earlier, by the CSRF guard (403). Either way: refused, nothing changes.
    const post = await request(app).post(`${BASE}/staff/leads/${lead._id}/follow-up`);
    expect([401, 403]).toContain(post.status);
    expect(post.body.success).not.toBe(true);
    await request(app).post(`${BASE}/staff/leads/${lead._id}/follow-up`).set({ Authorization: 'Bearer not-a-token' }).expect(401);
    expect((await Lead.findById(lead._id)).assignedRep).toBeNull();
  });

  it('403 for customers and for other teams', async () => {
    const lead = await makeLead();
    const customer = await login('customer');
    const procurement = await login('staff', { team: 'procurement' });
    await request(app).get(`${BASE}/staff/leads`).set(as(customer)).expect(403);
    await request(app).get(`${BASE}/staff/leads`).set(as(procurement)).expect(403);
    await request(app).post(`${BASE}/staff/leads/${lead._id}/follow-up`).set(as(procurement)).expect(403);
  });

  it('GTM executives see the sheet but cannot follow up', async () => {
    const lead = await makeLead();
    const exec = await login('staff', { team: 'sales', subRole: 'executive' });
    const list = await request(app).get(`${BASE}/staff/leads`).set(as(exec)).expect(200);
    expect(list.body.leads).toHaveLength(1);
    expect(list.body.you).toMatchObject({ canFollowUp: false, canReassign: false });
    await request(app).post(`${BASE}/staff/leads/${lead._id}/follow-up`).set(as(exec)).expect(403);
    expect((await Lead.findById(lead._id)).assignedRep).toBeNull();
  });

  it('a deactivated GTM login is refused', async () => {
    const gone = await login('staff', { team: 'sales', active: false });
    await request(app).get(`${BASE}/staff/leads`).set(as(gone)).expect(403);
  });

  it('rejects a malformed lead id with 400', async () => {
    const priya = await gtmLead();
    await request(app).post(`${BASE}/staff/leads/not-an-id/follow-up`).set(as(priya)).expect(400);
    await request(app).get(`${BASE}/staff/leads/${new mongoose.Types.ObjectId()}`).set(as(priya)).expect(404);
  });
});

describe('follow up', () => {
  it('two people clicking at the same moment: exactly one owner, one history line', async () => {
    const lead = await makeLead();
    const priya = await gtmLead('Priya');
    const arjun = await gtmLead('Arjun');
    const clicks = await Promise.all([priya, arjun, priya, arjun, priya, arjun].map((who) =>
      request(app).post(`${BASE}/staff/leads/${lead._id}/follow-up`).set(as(who))));

    const claimed = clicks.filter((r) => r.body.outcome === 'claimed');
    expect(claimed).toHaveLength(1);
    const winner = claimed[0].body.lead.followingUp.name;
    for (const r of clicks) {
      // Everyone ends up looking at the same owner — the loser gets a 409 with the row, not an error page.
      expect(r.body.lead.followingUp.name).toBe(winner);
      expect(['claimed', 'already_yours', 'taken']).toContain(r.body.outcome);
      if (r.body.outcome === 'taken') {
        expect(r.status).toBe(409);
        expect(r.body.message).toBe(`${winner} is already following up on this lead.`);
      } else expect(r.status).toBe(200);
    }
    const saved = await Lead.findById(lead._id).populate('assignedRep');
    expect(saved.assignedRep.name).toBe(winner);
    expect(saved.activities.filter((a) => a.type === 'claim')).toHaveLength(1);
  });

  it('a double click by the same person is one claim', async () => {
    const lead = await makeLead();
    const priya = await gtmLead('Priya');
    const first = await request(app).post(`${BASE}/staff/leads/${lead._id}/follow-up`).set(as(priya)).expect(200);
    const second = await request(app).post(`${BASE}/staff/leads/${lead._id}/follow-up`).set(as(priya)).expect(200);
    expect(first.body.outcome).toBe('claimed');
    expect(second.body.outcome).toBe('already_yours');
    expect(second.body.lead.followingUp).toMatchObject({ name: 'Priya', mine: true });
    expect((await Lead.findById(lead._id)).activities).toHaveLength(1);
  });

  it('a closed lead cannot be taken', async () => {
    const lead = await makeLead({ status: 'lost' });
    const priya = await gtmLead();
    const res = await request(app).post(`${BASE}/staff/leads/${lead._id}/follow-up`).set(as(priya)).expect(409);
    expect(res.body.outcome).toBe('closed');
    expect((await Lead.findById(lead._id)).assignedRep).toBeNull();
  });

  it('admin sees the claim in the admin CRM history', async () => {
    const lead = await makeLead();
    const priya = await gtmLead('Priya');
    const admin = await login('admin');
    await request(app).post(`${BASE}/staff/leads/${lead._id}/follow-up`).set(as(priya)).expect(200);
    const res = await request(app).get(`${BASE}/leads/${lead._id}`).set(as(admin)).expect(200);
    expect(res.body.lead.assignedRep.name).toBe('Priya');
    expect(res.body.lead.activities.map((a) => [a.type, a.rep?.name])).toContainEqual(['claim', 'Priya']);
  });
});

describe('phone and e-mail', () => {
  it('only the person following up, the GTM head and admin see them', async () => {
    const lead = await makeLead();
    const priya = await gtmLead('Priya');
    const arjun = await gtmLead('Arjun');
    const head = await gtmHead('Head');
    const admin = await login('admin');
    const contactFor = async (who) => (await request(app).get(`${BASE}/staff/leads/${lead._id}`).set(as(who)).expect(200)).body.lead.contact;

    expect(await contactFor(priya)).toBeNull(); // free lead: a GTM lead sees no number yet
    expect(await contactFor(head)).toMatchObject({ phone: lead.phone });
    await request(app).post(`${BASE}/staff/leads/${lead._id}/follow-up`).set(as(priya)).expect(200);
    expect(await contactFor(priya)).toMatchObject({ phone: lead.phone, email: lead.email });
    expect(await contactFor(arjun)).toBeNull();
    expect(await contactFor(admin)).toMatchObject({ phone: lead.phone });

    const list = await request(app).get(`${BASE}/staff/leads`).set(as(arjun)).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(lead.phone);
  });
});

describe('release and reassign', () => {
  it('only the owner (or head/admin) can let go; it is logged and idempotent', async () => {
    const lead = await makeLead();
    const priya = await gtmLead('Priya');
    const arjun = await gtmLead('Arjun');
    await request(app).post(`${BASE}/staff/leads/${lead._id}/follow-up`).set(as(priya)).expect(200);
    await request(app).post(`${BASE}/staff/leads/${lead._id}/release`).set(as(arjun)).expect(403);
    const res = await request(app).post(`${BASE}/staff/leads/${lead._id}/release`).set(as(priya)).expect(200);
    expect(res.body.outcome).toBe('released');
    expect(res.body.lead.followingUp).toBeNull();
    const again = await request(app).post(`${BASE}/staff/leads/${lead._id}/release`).set(as(priya)).expect(200);
    expect(again.body.outcome).toBe('already_free');

    const detail = await request(app).get(`${BASE}/staff/leads/${lead._id}`).set(as(arjun)).expect(200);
    expect(detail.body.lead.history.map((h) => h.notes)).toEqual(['Priya stopped following up', 'Following up']);
    // Free again: Arjun can now take it.
    await request(app).post(`${BASE}/staff/leads/${lead._id}/follow-up`).set(as(arjun)).expect(200);
  });

  it('only the GTM head or admin can reassign, and only to a GTM seller', async () => {
    const lead = await makeLead();
    const priya = await gtmLead('Priya');
    const arjun = await gtmLead('Arjun');
    const exec = await login('staff', { team: 'sales', subRole: 'executive' });
    const head = await gtmHead('Head');
    await request(app).post(`${BASE}/staff/leads/${lead._id}/follow-up`).set(as(priya)).expect(200);

    await request(app).post(`${BASE}/staff/leads/${lead._id}/reassign`).set(as(priya)).send({ userId: String(arjun.user._id) }).expect(403);
    await request(app).post(`${BASE}/staff/leads/${lead._id}/reassign`).set(as(head)).send({ userId: String(exec.user._id) }).expect(400);
    const res = await request(app).post(`${BASE}/staff/leads/${lead._id}/reassign`).set(as(head)).send({ userId: String(arjun.user._id) }).expect(200);
    expect(res.body.lead.followingUp.name).toBe('Arjun');
    const saved = await Lead.findById(lead._id);
    expect(saved.activities.at(-1)).toMatchObject({ type: 'assignment', notes: 'Moved from Priya to Arjun' });

    const people = await request(app).get(`${BASE}/staff/leads/people`).set(as(head)).expect(200);
    expect(people.body.sellers.map((s) => s.name).sort()).toEqual(['Arjun', 'Head', 'Priya']);
    const notHead = await request(app).get(`${BASE}/staff/leads/people`).set(as(priya)).expect(200);
    expect(notHead.body.sellers).toBeUndefined();
  });
});

describe('the list', () => {
  it('keyset pages: no row repeated or skipped, even with equal scores', async () => {
    for (let i = 0; i < 45; i += 1) await makeLead({ leadScore: [80, 50, 50, 20][i % 4] });
    const priya = await gtmLead();
    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const res = await request(app).get(`${BASE}/staff/leads`).query(cursor ? { cursor } : {}).set(as(priya)).expect(200);
      pages += 1;
      expect(res.body.leads.length).toBeLessThanOrEqual(20);
      seen.push(...res.body.leads);
      cursor = res.body.nextCursor;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen.map((l) => l.id)).size).toBe(45);
    const scores = seen.map((l) => l.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('a garbage cursor starts again from the top instead of failing', async () => {
    await makeLead();
    const priya = await gtmLead();
    const res = await request(app).get(`${BASE}/staff/leads`).query({ cursor: 'garbage' }).set(as(priya)).expect(200);
    expect(res.body.leads).toHaveLength(1);
  });

  it('filters: free / mine / by person, open only by default, sign-ups left out, search', async () => {
    const a = await makeLead({ name: 'Ravi Kumar' });
    const b = await makeLead({ name: 'Sita Mehta' });
    await makeLead({ status: 'won' });
    await makeLead({ primarySource: 'dormant_user', sources: [{ type: 'dormant_user' }] });
    const priya = await gtmLead('Priya');
    const arjun = await gtmLead('Arjun');
    await request(app).post(`${BASE}/staff/leads/${a._id}/follow-up`).set(as(priya)).expect(200);
    const ids = async (who, q) => (await request(app).get(`${BASE}/staff/leads`).query(q).set(as(who)).expect(200)).body.leads.map((l) => l.id).sort();

    expect(await ids(arjun, {})).toEqual([String(a._id), String(b._id)].sort());
    expect(await ids(arjun, { view: 'free' })).toEqual([String(b._id)]);
    expect(await ids(arjun, { view: 'mine' })).toEqual([]);
    expect(await ids(priya, { view: 'mine' })).toEqual([String(a._id)]);
    const repId = (await request(app).get(`${BASE}/staff/leads/people`).set(as(arjun))).body.people.find((p) => p.name === 'Priya').repId;
    expect(await ids(arjun, { view: 'person', rep: repId })).toEqual([String(a._id)]);
    expect(await ids(arjun, { status: 'won' })).toHaveLength(1);
    expect(await ids(arjun, { q: 'sita' })).toEqual([String(b._id)]);
    expect(await ids(arjun, { q: `+91 ${b.phone.slice(0, 5)} ${b.phone.slice(5)}` })).toEqual([String(b._id)]);
    await request(app).get(`${BASE}/staff/leads`).query({ view: 'person' }).set(as(arjun)).expect(400);
  });

  it('tags a followed-up lead with no update for a week (but keeps the owner)', async () => {
    const lead = await makeLead();
    const priya = await gtmLead('Priya');
    await request(app).post(`${BASE}/staff/leads/${lead._id}/follow-up`).set(as(priya)).expect(200);
    await Lead.updateOne({ _id: lead._id }, { $set: { 'activities.0.at': new Date(Date.now() - 9 * DAY) } });
    const res = await request(app).get(`${BASE}/staff/leads`).set(as(priya)).expect(200);
    expect(res.body.leads[0]).toMatchObject({ quietDays: 9, followingUp: { name: 'Priya' } });
  });
});

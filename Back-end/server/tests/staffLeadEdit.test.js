/**
 * PATCH /staff/leads/:id — fix a website lead's name, phone or e-mail.
 *
 * Who: the person following up, the GTM head, admin (the people who see the
 * phone). Others → 403. Every edit is logged in `Lead.edits` (not `activities`,
 * so the quiet tag is untouched), shows in the history, and never changes
 * `identityKey`. Two people editing at once → the second gets 409.
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: Lead } = await import('../models/Lead.js');
const { cleanLeadDetail } = await import('../services/teamLeadService.js');
const { default: leadRepository } = await import('../repositories/leadRepository.js');

const BASE = '/api/v1';

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

async function makeLead(over = {}) {
  return Lead.create({
    name: 'Rahul K', phone: '9876500001', email: 'rahul@mail.test', identityKey: 'email:rahul@mail.test',
    primarySource: 'payment_failed', status: 'new', leadScore: 50,
    sources: [{ type: 'payment_failed', snapshot: { total: 18400, itemCount: 2 } }],
    ...over,
  });
}
const patch = (who, id, body) => request(app).patch(`${BASE}/staff/leads/${id}`).set(as(who)).send(body);
const follow = (who, id) => request(app).post(`${BASE}/staff/leads/${id}/follow-up`).set(as(who)).expect(200);

describe('PATCH /staff/leads/:id', () => {
  it('the person following up fixes the name and phone; logged as an edit, identityKey kept', async () => {
    const priya = await gtmLead('Priya');
    const lead = await makeLead();
    await follow(priya, lead._id);
    const activitiesBefore = (await Lead.findById(lead._id).lean()).activities.length;

    const res = await patch(priya, lead._id, { name: 'Rahul Kumar', phone: '+91 91234 56789', seen: { name: 'Rahul K', phone: '9876500001' } });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('saved');
    expect(res.body.lead).toMatchObject({ name: 'Rahul Kumar', contact: { phone: '9123456789', email: 'rahul@mail.test', name: 'Rahul Kumar' } });

    const fresh = await Lead.findById(lead._id).lean();
    expect(fresh.identityKey).toBe('email:rahul@mail.test');
    expect(fresh.activities).toHaveLength(activitiesBefore); // an edit is not a follow-up
    expect(fresh.edits).toHaveLength(1);
    expect(fresh.edits[0].changes).toEqual([
      { field: 'Name', from: 'Rahul K', to: 'Rahul Kumar' },
      { field: 'Phone', from: '9876500001', to: '9123456789' },
    ]);

    const detail = await request(app).get(`${BASE}/staff/leads/${lead._id}`).set(as(priya)).expect(200);
    expect(detail.body.lead.history[0]).toMatchObject({ type: 'edit', label: 'Details edited', who: 'Priya' });
  });

  it('the GTM head and admin may edit any lead, even one nobody follows up', async () => {
    const head = await gtmHead();
    const admin = await login('admin');
    const lead = await makeLead();
    expect((await patch(head, lead._id, { name: 'A' })).status).toBe(200);
    expect((await patch(admin, lead._id, { name: 'B' })).status).toBe(200);
    expect((await Lead.findById(lead._id).lean()).name).toBe('B');
  });

  it('403 for a GTM lead who is not following it up, an executive, another team and a customer', async () => {
    const priya = await gtmLead('Priya');
    const arjun = await gtmLead('Arjun');
    const exec = await login('staff', { team: 'sales', subRole: 'executive' });
    const procurement = await login('staff', { team: 'procurement' });
    const customer = await login('customer');
    const lead = await makeLead();

    expect((await patch(priya, lead._id, { name: 'X' })).status).toBe(403); // free lead
    await follow(priya, lead._id);
    for (const who of [arjun, exec, procurement, customer]) {
      expect((await patch(who, lead._id, { name: 'X' })).status).toBe(403);
    }
    expect((await Lead.findById(lead._id).lean()).name).toBe('Rahul K');
  });

  it('409 with the newer version when someone saved in between', async () => {
    const head = await gtmHead();
    const lead = await makeLead();
    await patch(head, lead._id, { name: 'First edit' }).expect(200);

    const late = await patch(head, lead._id, { name: 'Second edit', seen: { name: 'Rahul K' } });
    expect(late.status).toBe(409);
    expect(late.body.lead.name).toBe('First edit');
    expect((await Lead.findById(lead._id).lean()).name).toBe('First edit');
  });

  it('a write racing between the read and the save is refused, not overwritten', async () => {
    const head = await gtmHead();
    const lead = await makeLead();
    const real = leadRepository.applyDetailsEdit.bind(leadRepository);
    const spy = jest.spyOn(leadRepository, 'applyDetailsEdit').mockImplementationOnce(async (...args) => {
      await Lead.updateOne({ _id: lead._id }, { $set: { name: 'Other person' } });
      return real(...args);
    });
    const res = await patch(head, lead._id, { name: 'Mine' });
    spy.mockRestore();
    expect(res.status).toBe(409);
    expect((await Lead.findById(lead._id).lean()).name).toBe('Other person');
  });

  it.each([
    [{ phone: '123' }, /10-digit/],
    [{ email: 'not-an-email' }, /does not look right/],
    [{ name: 'x'.repeat(121) }, /under 120/],
    [{ phone: '', email: '' }, /at least a phone number or an e-mail/],
  ])('400 for %o', async (body, msg) => {
    const head = await gtmHead();
    const lead = await makeLead();
    const res = await patch(head, lead._id, body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(msg);
  });

  it('clearing one contact is fine while the other stays; nothing changed → unchanged, no log', async () => {
    const head = await gtmHead();
    const lead = await makeLead();
    expect((await patch(head, lead._id, { email: '' })).body.outcome).toBe('saved');
    expect((await Lead.findById(lead._id).lean()).email).toBeNull();
    const same = await patch(head, lead._id, { name: 'Rahul K' });
    expect(same.body.outcome).toBe('unchanged');
    expect((await Lead.findById(lead._id).lean()).edits).toHaveLength(1);
  });

  it('404 for an unknown or malformed id', async () => {
    const head = await gtmHead();
    expect((await patch(head, new mongoose.Types.ObjectId(), { name: 'x' })).status).toBe(404);
    expect([400, 404]).toContain((await patch(head, 'nope', { name: 'x' })).status);
  });

  it('the edit trail is capped at 50', async () => {
    const head = await gtmHead();
    const old = Array.from({ length: 50 }, (_, i) => ({ at: new Date(2026, 0, 1, 0, i), byName: 'x', changes: [{ field: 'Name', from: `${i}`, to: `${i + 1}` }] }));
    const lead = await makeLead({ edits: old });
    await patch(head, lead._id, { name: 'Newest' }).expect(200);
    const fresh = await Lead.findById(lead._id).lean();
    expect(fresh.edits).toHaveLength(50);
    expect(fresh.edits.at(-1).changes[0].to).toBe('Newest');
  });
});

describe('cleanLeadDetail', () => {
  it('normalises phone and e-mail', () => {
    expect(cleanLeadDetail('phone', '+91 98765-43210')).toBe('9876543210');
    expect(cleanLeadDetail('email', ' A@B.Co ')).toBe('a@b.co');
    expect(cleanLeadDetail('name', '  Asha ')).toBe('Asha');
    expect(cleanLeadDetail('phone', '')).toBeNull();
  });
  it('rejects non-text', () => {
    expect(() => cleanLeadDetail('name', 5)).toThrow(/must be text/);
  });
});

/**
 * Next follow-up deadlines on Meta leads: office hours, required next date, late
 * reasons, moving a deadline, explanations, reminders / escalations (once per
 * deadline), the team activity page and the bell. Push is a recorded fake.
 */
import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: MetaLead } = await import('../models/MetaLead.js');
const { syncMetaLeadsFromSheet } = await import('../services/metaLeadSync.js');
const { runDeadlineSweep, bellItemsFor, readNextAt } = await import('../services/metaLeadDeadlineService.js');
const { snapToOffice, addOfficeMinutes, isOfficeTime, sheetDateTime } = await import('../utils/officeHours.js');
const { parseSheetDate } = await import('../utils/metaLeadSheet.js');

jest.setTimeout(120000);
const BASE = '/api/v1/staff/meta-leads';
const DAY = 24 * 3600e3;
const NEXT = new Date(Date.now() + 2 * DAY).toISOString();
const ist = (s) => new Date(`${s}+05:30`);

const META_HEAD = ['id', 'created_time', 'campaign_name', 'form_name', 'full_name', 'phone_number'];
const seed = () => syncMetaLeadsFromSheet({
  readTabs: async () => [{ name: 'jimny', gid: 1, values: [META_HEAD, ['l:1', '2026-11-07', 'c', 'Jimny lift kit', 'Asha', 'p:+919876543210'], ['l:2', '2026-11-07', 'c', 'Thar grill', 'Ravi', 'p:+919876543211']] }],
});

let n = 0;
async function login(role, staff, name) {
  n += 1;
  const email = `d${n}@autobacs.test`;
  const password = 'SecurePass123!';
  const user = await User.create({ name: name || `User ${n}`, email, phone: '9000000001', passwordHash: await bcrypt.hash(password, 10), role, ...(staff && { staff: { active: true, isHead: false, ...staff } }) });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return { user, headers: { Authorization: `Bearer ${(res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken=')).split(';')[0].slice('accessToken='.length)}` } };
}
const GTM = ['staff', { team: 'sales', subRole: 'executive' }, 'Nevin'];
const OTHER = ['staff', { team: 'sales', subRole: 'support' }, 'Support'];
const HEAD = ['staff', { team: 'sales', isHead: true }, 'Head'];
const MKT_HEAD = ['staff', { team: 'marketing', isHead: true }, 'Marketing head'];
const lead = (metaLeadId) => MetaLead.findOne({ metaLeadId }).lean();

beforeAll(async () => { await dbHandler.connect(); process.env.META_LEADS_SHEET_ID = 'sheet'; });
afterEach(async () => { await dbHandler.clearDatabase(); });
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

describe('office hours (10 am – 7 pm, Monday – Saturday, India time)', () => {
  test.each([
    ['inside hours stays', '2026-11-17T16:00:00', '2026-11-17T16:00:00'],
    ['9 pm → 10 am next day', '2026-11-17T21:00:00', '2026-11-18T10:00:00'],
    ['8 am → 10 am same day', '2026-11-17T08:00:00', '2026-11-17T10:00:00'],
    ['Saturday 8 pm → Monday 10 am', '2026-11-21T20:00:00', '2026-11-23T10:00:00'],
    ['Sunday noon → Monday 10 am', '2026-11-22T12:00:00', '2026-11-23T10:00:00'],
    ['7 pm exactly is closed', '2026-11-17T19:00:00', '2026-11-18T10:00:00'],
  ])('%s', (_n, at, want) => {
    expect(snapToOffice(ist(at)).toISOString()).toBe(ist(want).toISOString());
  });

  test('office minutes skip nights and Sundays', () => {
    expect(addOfficeMinutes(ist('2026-11-17T12:00:00'), 60).toISOString()).toBe(ist('2026-11-17T13:00:00').toISOString());
    expect(addOfficeMinutes(ist('2026-11-17T18:30:00'), 60).toISOString()).toBe(ist('2026-11-18T10:30:00').toISOString());
    expect(addOfficeMinutes(ist('2026-11-21T18:45:00'), 30).toISOString()).toBe(ist('2026-11-23T10:15:00').toISOString());
    expect(addOfficeMinutes(ist('2026-11-17T22:00:00'), 60).toISOString()).toBe(ist('2026-11-18T11:00:00').toISOString());
    expect(isOfficeTime(ist('2026-11-22T12:00:00'))).toBe(false);
  });

  test('the sheet format reads back as the same moment', () => {
    const at = ist('2026-11-17T16:05:00');
    expect(sheetDateTime(at)).toBe('17-11-2026 16:05');
    expect(parseSheetDate(sheetDateTime(at)).date.toISOString()).toBe(at.toISOString());
  });

  test('a next follow-up must be a real, future time within 60 days', () => {
    const now = ist('2026-11-17T12:00:00');
    expect(() => readNextAt('', now)).toThrow(/Pick when/);
    expect(() => readNextAt('soon', now)).toThrow(/not valid/);
    expect(() => readNextAt(ist('2026-11-17T11:00:00').toISOString(), now)).toThrow(/future/);
    expect(() => readNextAt(new Date(now.getTime() + 61 * DAY).toISOString(), now)).toThrow(/60 days/);
    expect(readNextAt(ist('2026-11-17T21:00:00').toISOString(), now).toISOString()).toBe(ist('2026-11-18T10:00:00').toISOString());
  });
});

describe('deadlines on the lead', () => {
  test('taking a lead sets the first deadline; a follow-up needs a next one unless it closes the lead', async () => {
    await seed();
    const { headers: a } = await login(...GTM);
    const { _id: id } = await lead('l:1');
    await request(app).post(`${BASE}/${id}/follow-up`).set(a).send({}).expect(200);
    const taken = await lead('l:1');
    expect(taken.nextFollowUpAt).toBeInstanceOf(Date);
    expect(isOfficeTime(taken.nextFollowUpAt)).toBe(true);

    const missing = await request(app).post(`${BASE}/${id}/follow-ups`).set(a).send({ status: 'whatsapp' }).expect(400);
    expect(missing.body.message).toMatch(/next follow-up/);
    const ok = await request(app).post(`${BASE}/${id}/follow-ups`).set(a).send({ status: 'whatsapp', note: 'sent', nextAt: NEXT }).expect(200);
    expect(ok.body.lead.nextFollowUp).toMatchObject({ overdue: false, lateReasonNeeded: false });
    const entry = (await lead('l:1')).followUpLog.at(-1);
    expect(entry).toMatchObject({ type: 'follow_up', late: false, minutesSinceClaim: expect.any(Number) });

    await request(app).post(`${BASE}/${id}/follow-ups`).set(a).send({ status: 'converted' }).expect(200);
    expect((await lead('l:1')).nextFollowUpAt).toBeNull();
    // Only the first follow-up after taking it counts toward "time to first follow-up".
    expect((await lead('l:1')).followUpLog.at(-1).minutesSinceClaim).toBeUndefined();
  });

  test('a missed deadline: the next save needs a reason, which is kept and shown', async () => {
    await seed();
    const { headers: a } = await login(...GTM);
    const { _id: id } = await lead('l:1');
    await request(app).post(`${BASE}/${id}/follow-up`).set(a).send({}).expect(200);
    const due = new Date(Date.now() - 3 * 3600e3);
    await MetaLead.updateOne({ _id: id }, { $set: { nextFollowUpAt: due } });

    const row = (await request(app).get(`${BASE}?q=Asha`).set(a)).body.leads[0];
    expect(row.nextFollowUp).toMatchObject({ overdue: true, lateReasonNeeded: true });

    const refused = await request(app).post(`${BASE}/${id}/follow-ups`).set(a).send({ status: 'responded', nextAt: NEXT }).expect(400);
    expect(refused.body.message).toMatch(/why this follow-up is late/);
    await request(app).post(`${BASE}/${id}/follow-ups`).set(a).send({ status: 'responded', nextAt: NEXT, lateReason: 'ok' }).expect(400);
    await request(app).post(`${BASE}/${id}/follow-ups`).set(a).send({ status: 'responded', nextAt: NEXT, lateReason: 'Was on another customer call' }).expect(200);

    const doc = await lead('l:1');
    expect(doc).toMatchObject({ lateReason: 'Was on another customer call' });
    expect(doc.lateReasonFor.getTime()).toBe(due.getTime());
    expect(doc.followUpLog.slice(-2).map((e) => e.type)).toEqual(['late_reason', 'follow_up']);
    expect(doc.followUpLog.at(-1)).toMatchObject({ late: true });
    const detail = (await request(app).get(`${BASE}/${id}`).set(a)).body.lead;
    expect(detail.history[1]).toMatchObject({ label: 'Reason for being late', notes: 'Was on another customer call' });
  });

  test('moving a deadline needs a reason and is counted; only the owner or a head may', async () => {
    await seed();
    const { headers: a } = await login(...GTM);
    const { headers: b } = await login(...OTHER);
    const { _id: id } = await lead('l:1');
    await request(app).post(`${BASE}/${id}/follow-up`).set(a).send({}).expect(200);
    await request(app).post(`${BASE}/${id}/next-follow-up`).set(a).send({ nextAt: NEXT }).expect(400);
    await request(app).post(`${BASE}/${id}/next-follow-up`).set(b).send({ nextAt: NEXT, reason: 'I will do it' }).expect(403);
    const res = await request(app).post(`${BASE}/${id}/next-follow-up`).set(a).send({ nextAt: NEXT, reason: 'Customer asked for Friday' }).expect(200);
    expect(res.body.outcome).toBe('rescheduled');
    expect(res.body.lead.reschedules).toBe(1);
    // An overdue lead: the move's reason is also the late reason.
    const due = new Date(Date.now() - 3600e3);
    await MetaLead.updateOne({ _id: id }, { $set: { nextFollowUpAt: due } });
    await request(app).post(`${BASE}/${id}/next-follow-up`).set(a).send({ nextAt: new Date(Date.now() + 3 * DAY).toISOString(), reason: 'Phone switched off today' }).expect(200);
    const doc = await lead('l:1');
    expect(doc.lateReasonFor.getTime()).toBe(due.getTime());
    expect(doc.reschedules).toBe(2);
  });

  test('freeing a lead clears its deadline; moving it keeps the deadline for the new person', async () => {
    await seed();
    const { headers: a } = await login(...GTM);
    const { headers: h, user: head } = await login(...HEAD);
    const { _id: id } = await lead('l:1');
    await request(app).post(`${BASE}/${id}/follow-up`).set(a).send({}).expect(200);
    const due = (await lead('l:1')).nextFollowUpAt;
    await request(app).post(`${BASE}/${id}/reassign`).set(h).send({ userId: String(head._id) }).expect(200);
    expect((await lead('l:1')).nextFollowUpAt.getTime()).toBe(due.getTime());
    await request(app).post(`${BASE}/${id}/release`).set(h).send({}).expect(200);
    expect((await lead('l:1')).nextFollowUpAt).toBeNull();
  });
});

describe('explanations', () => {
  test('a head asks, only the person following up answers, one open question at a time', async () => {
    await seed();
    const { headers: a } = await login(...GTM);
    const { headers: b } = await login(...OTHER);
    const { headers: m } = await login(...MKT_HEAD);
    const { _id: id } = await lead('l:1');
    await request(app).post(`${BASE}/${id}/explanation`).set(m).send({ question: 'Why no update?' }).expect(400); // nobody holds it
    await request(app).post(`${BASE}/${id}/follow-up`).set(a).send({}).expect(200);

    await request(app).post(`${BASE}/${id}/explanation`).set(b).send({ question: 'Why no update?' }).expect(403);
    await request(app).post(`${BASE}/${id}/explanation`).set(m).send({ question: 'Hm' }).expect(400);
    const asked = await request(app).post(`${BASE}/${id}/explanation`).set(m).send({ question: 'Why was this not called yesterday?' }).expect(200);
    expect(asked.body.lead.explanation).toMatchObject({ open: true, askedBy: 'Marketing head' });
    expect((await request(app).post(`${BASE}/${id}/explanation`).set(m).send({ question: 'And again?' }).expect(409)).body.outcome).toBe('already_asked');

    const mine = (await request(app).get(`${BASE}?view=mine`).set(a)).body.leads[0];
    expect(mine.explanation).toMatchObject({ open: true, canAnswer: true, question: 'Why was this not called yesterday?' });
    await request(app).post(`${BASE}/${id}/explanation/answer`).set(b).send({ answer: 'Not my lead at all' }).expect(403);
    const answered = await request(app).post(`${BASE}/${id}/explanation/answer`).set(a).send({ answer: 'Customer asked to call on Monday' }).expect(200);
    expect(answered.body.lead.explanation).toMatchObject({ open: false, answer: 'Customer asked to call on Monday' });
    expect((await request(app).post(`${BASE}/${id}/explanation/answer`).set(a).send({ answer: 'Again the same answer' }).expect(409)).body.outcome).toBe('nothing_open');
    // A new question may follow once the last one is answered.
    await request(app).post(`${BASE}/${id}/explanation`).set(m).send({ question: 'Any update after Monday?' }).expect(200);
    const types = (await lead('l:1')).followUpLog.map((e) => e.type);
    expect(types).toEqual(['claim', 'explain_ask', 'explain_answer', 'explain_ask']);
  });
});

describe('reminders and escalations', () => {
  // Tuesday 17 Nov 2026, 12:00 India time.
  const NOW = ist('2026-11-17T12:00:00');
  async function held(metaLeadId, owner, nextFollowUpAt) {
    await MetaLead.updateOne({ metaLeadId }, { $set: { followingUpBy: owner._id, followingUpName: owner.name, followingUpAt: new Date(NOW.getTime() - DAY), nextFollowUpAt } });
  }

  test('10 minutes before: one pop-up to the owner, never twice for the same deadline', async () => {
    await seed();
    const { user } = await login(...GTM);
    await held('l:1', user, new Date(NOW.getTime() + 8 * 60e3));
    await held('l:2', user, new Date(NOW.getTime() + 30 * 60e3)); // not yet
    const send = jest.fn(async () => 1);
    expect(await runDeadlineSweep(NOW, send)).toMatchObject({ reminded: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual([{ userId: user._id, url: '/team/meta-leads' }]);
    expect(send.mock.calls[0][1].body).not.toMatch(/Asha|98765/);
    expect(await runDeadlineSweep(new Date(NOW.getTime() + 60e3), send)).toMatchObject({ reminded: 0 });
    // Two sweeps at once (two replicas): still one pop-up.
    await held('l:2', user, new Date(NOW.getTime() + 5 * 60e3));
    const both = await Promise.all([runDeadlineSweep(NOW, send), runDeadlineSweep(NOW, send)]);
    expect(both[0].reminded + both[1].reminded).toBe(1);
  });

  test('2 hours late → GTM head; 1 day late → admin and Marketing head; once each', async () => {
    await seed();
    const { user } = await login(...GTM);
    const { user: head } = await login(...HEAD);
    const { user: mkt } = await login(...MKT_HEAD);
    const { user: admin } = await login('admin', null, 'Admin');
    await held('l:1', user, new Date(NOW.getTime() - 3 * 3600e3));
    await held('l:2', user, new Date(NOW.getTime() - 26 * 3600e3));
    const send = jest.fn(async () => 1);
    expect(await runDeadlineSweep(NOW, send)).toMatchObject({ head: 2, seniors: 1 });
    const headCall = send.mock.calls.find(([to]) => to.some((r) => String(r.userId) === String(head._id)));
    expect(headCall[1]).toMatchObject({ title: expect.stringMatching(/2 Meta lead follow-ups are 2\+ hours late/), body: 'Nevin: 2' });
    const seniorCall = send.mock.calls.find(([to]) => to.some((r) => String(r.userId) === String(admin._id)));
    expect(seniorCall[0].map((r) => String(r.userId)).sort()).toEqual([String(admin._id), String(mkt._id)].sort());
    expect(seniorCall[0].find((r) => String(r.userId) === String(admin._id)).url).toBe('/admin/meta-leads?due=overdue');
    send.mockClear();
    expect(await runDeadlineSweep(new Date(NOW.getTime() + 60e3), send)).toMatchObject({ head: 0, seniors: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  test('escalations wait for office hours', async () => {
    await seed();
    const { user } = await login(...GTM);
    await login(...HEAD);
    const night = ist('2026-11-17T22:00:00');
    await held('l:1', user, new Date(night.getTime() - 3 * 3600e3));
    const send = jest.fn(async () => 1);
    expect(await runDeadlineSweep(night, send)).toMatchObject({ head: 0 });
    expect((await lead('l:1')).escalatedHeadFor).toBeNull();
  });

  test('a new deadline gets its own reminder', async () => {
    await seed();
    const { user, headers: a } = await login(...GTM);
    const { _id: id } = await lead('l:1');
    await request(app).post(`${BASE}/${id}/follow-up`).set(a).send({}).expect(200);
    await MetaLead.updateOne({ _id: id }, { $set: { reminderSentFor: (await lead('l:1')).nextFollowUpAt } });
    await request(app).post(`${BASE}/${id}/follow-ups`).set(a).send({ status: 'responded', nextAt: NEXT }).expect(200);
    expect((await lead('l:1')).reminderSentFor).toBeNull();
    expect(String((await lead('l:1')).followingUpBy)).toBe(String(user._id));
  });
});

describe('what managers see', () => {
  test('team activity: counts per person, the late list, the reasons; only reviewers', async () => {
    await seed();
    const { headers: a } = await login(...GTM);
    const { headers: h } = await login(...HEAD);
    const { headers: m } = await login(...MKT_HEAD);
    const asha = await lead('l:1');
    const ravi = await lead('l:2');
    await request(app).post(`${BASE}/${asha._id}/follow-up`).set(a).send({}).expect(200);
    await request(app).post(`${BASE}/${ravi._id}/follow-up`).set(a).send({}).expect(200);
    await request(app).post(`${BASE}/${asha._id}/follow-ups`).set(a).send({ status: 'whatsapp', nextAt: NEXT }).expect(200);
    await MetaLead.updateOne({ _id: ravi._id }, { $set: { nextFollowUpAt: new Date(Date.now() - 3600e3) } });
    await request(app).post(`${BASE}/${ravi._id}/follow-ups`).set(a).send({ status: 'no_response', nextAt: NEXT, lateReason: 'Was at the warehouse' }).expect(200);
    await MetaLead.updateOne({ _id: ravi._id }, { $set: { nextFollowUpAt: new Date(Date.now() - 600e3) } });

    await request(app).get(`${BASE}/activity`).set(a).expect(403);
    await request(app).get(`${BASE}/activity?days=5`).set(h).expect(400);
    const res = await request(app).get(`${BASE}/activity?days=7`).set(m).expect(200);
    const nevin = res.body.people.find((p) => p.name === 'Nevin');
    expect(nevin).toMatchObject({ holding: 2, overdue: 1, taken: 2, followUps: 2, onTime: 1, late: 1, onTimeRate: 50, avgMinutesToFirst: expect.any(Number) });
    expect(res.body.overdue).toEqual([expect.objectContaining({ product: 'Thar grill', followingUp: 'Nevin', lateReason: '' })]);
    expect(res.body.reasons).toEqual([expect.objectContaining({ type: 'late_reason', who: 'Nevin', text: 'Was at the warehouse' })]);

    const late = (await request(app).get(`${BASE}?due=overdue`).set(h)).body.leads;
    expect(late.map((l) => l.id)).toEqual([String(ravi._id)]);
    await request(app).get(`${BASE}?due=later`).set(h).expect(400);
  });

  test('the bell: my due follow-ups, questions for me, the team\'s late ones', async () => {
    await seed();
    const { user, headers: a } = await login(...GTM);
    const { user: head } = await login(...HEAD);
    const { headers: m, user: mkt } = await login(...MKT_HEAD);
    const asha = await lead('l:1');
    await request(app).post(`${BASE}/${asha._id}/follow-up`).set(a).send({}).expect(200);
    await MetaLead.updateOne({ _id: asha._id }, { $set: { nextFollowUpAt: new Date(Date.now() - 600e3) } });
    await request(app).post(`${BASE}/${asha._id}/explanation`).set(m).send({ question: 'What happened here?' }).expect(200);

    const mine = await bellItemsFor(await User.findById(user._id).lean());
    expect(mine.map((i) => [i.key, i.count])).toEqual([['meta_leads_due', 1], ['meta_leads_explain', 1]]);
    const heads = await bellItemsFor(await User.findById(head._id).lean());
    expect(heads.find((i) => i.key === 'meta_leads_team_overdue')).toMatchObject({ count: 1, href: '/team/meta-leads?due=overdue' });
    const marketing = await bellItemsFor(await User.findById(mkt._id).lean());
    expect(marketing.map((i) => i.key)).toEqual(['meta_leads_team_overdue']);
  });
});

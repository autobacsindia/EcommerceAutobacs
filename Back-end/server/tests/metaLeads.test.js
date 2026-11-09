/**
 * Meta leads tab: reading the sheet's two kinds of tab, the live sync (re-runs,
 * edits surviving it, no row lost), and the API (who sees / edits, double saves,
 * keyset pages). Google is replaced by `readTabs`; the database is real.
 */
import { jest } from '@jest/globals';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: MetaLead } = await import('../models/MetaLead.js');
const { default: repo } = await import('../repositories/metaLeadRepository.js');
const { parseTab, parseSheetDate } = await import('../utils/metaLeadSheet.js');
const { syncMetaLeadsFromSheet, runScheduledMetaLeadSync } = await import('../services/metaLeadSync.js');
const { readAllTabs, readServiceAccount, resetGoogleSheetsToken } = await import('../services/googleSheetsClient.js');

jest.setTimeout(120000);
const BASE = '/api/v1/staff/meta-leads';

const META_HEAD = ['id', 'created_time', 'ad_name', 'campaign_name', 'form_name', 'is_organic', 'full_name', 'phone_number', 'your_car?'];
const metaRow = (id, name, phone, at = '2026-11-07T22:51:17-05:00') => [id, at, 'ad', 'jimny camp', 'jimny form', 'false', name, phone, 'Jimny'];
const WEB_HEAD = ['date', 'name', 'phone', 'product', 'sales person', 'status', '', ''];
const tabs = (jimny = [], web = []) => [
  { name: 'jimny suspension', gid: 11, values: [META_HEAD, ...jimny] },
  { name: 'website lead', gid: 22, values: [WEB_HEAD, ...web] },
];
const sync = (t, apply = true) => syncMetaLeadsFromSheet({ apply, readTabs: async () => t });

beforeAll(async () => { await dbHandler.connect(); process.env.META_LEADS_SHEET_ID = 'sheet'; });
afterEach(async () => { await dbHandler.clearDatabase(); delete global.fetch; });
afterAll(async () => {
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

describe('reading a tab', () => {
  test('dates: -05:00 is an exact moment; a typed date is that day in India; junk stays unread', () => {
    expect(parseSheetDate('2026-11-07T22:51:17-05:00').date.toISOString()).toBe('2026-11-08T03:51:17.000Z');
    expect(parseSheetDate('19-10-2026')).toEqual({ date: new Date('2026-10-18T18:30:00.000Z'), hasTime: false });
    expect(parseSheetDate('31-02-2026').date).toBeNull();
    expect(parseSheetDate('next monday').date).toBeNull();
    expect(parseSheetDate('').date).toBeNull();
  });

  test('a Meta tab maps its columns and keeps every one', () => {
    const { rows, report } = parseTab({ name: 'jimny', gid: 1, values: [META_HEAD, metaRow('l:1', 'Asha', 'p:+919876543210')] });
    expect(rows[0]).toMatchObject({ sheetKey: 'l:1', metaLeadId: 'l:1', name: 'Asha', phone: '+919876543210', product: 'jimny form', campaign: 'jimny camp' });
    expect(rows[0].fields).toHaveLength(META_HEAD.length);
    expect(rows[0].fields.find((f) => f.label === 'your_car?').value).toBe('Jimny');
    expect(report.ready).toBe(1);
  });

  test('test leads are skipped by their <test lead text, but a real is_organic lead is kept', () => {
    const organic = ['l:9', '2026-11-07T22:51:17-05:00', '', '', 'f', 'true', 'Real Person', '9876543210', 'x'];
    const dummy = ['l:8', '2026-11-07T22:51:17-05:00', '', '', 'f', 'true', '<test lead: dummy data for full_name>', 'p:<test lead>', 'x'];
    const { rows, report } = parseTab({ name: 'j', gid: 1, values: [META_HEAD, organic, dummy] });
    expect(rows.map((r) => r.sheetKey)).toEqual(['l:9']);
    expect(report).toMatchObject({ rowsWithData: 2, ready: 1, testLeads: 1 });
  });

  test('the typed tab: blank headings become follow-ups, blank date stays blank, wider rows are kept', () => {
    const { rows, report } = parseTab({ name: 'web', gid: 2, values: [WEB_HEAD.slice(0, 6), ['', 'Mohan', '9989928251', '', 'abhijeet', 'convetred', 'picked', 'no response']] });
    expect(rows[0]).toMatchObject({ leadDate: null, status: 'convetred', followUp1: 'picked', followUp2: 'no response' });
    expect(report.undated).toBe(1);
  });

  test('the same phone twice in a tab is two rows, with stable keys; blank rows are ignored', () => {
    const { rows, report } = parseTab({ name: 'web', gid: 2, values: [WEB_HEAD, ['', 'A', '9989928251'], [], ['', 'A again', '09989928251']] });
    expect(rows.map((r) => r.sheetKey)).toEqual(['gid:2|phone:9989928251#1', 'gid:2|phone:9989928251#2']);
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 4]);
    expect(report).toMatchObject({ rowsWithData: 2, repeatedPhones: 1 });
  });

  test('a tab whose columns mean nothing is reported, not guessed at', () => {
    const { rows, report } = parseTab({ name: 'notes', gid: 3, values: [['foo', 'bar'], ['1', '2']] });
    expect(rows).toEqual([]);
    expect(report).toMatchObject({ unrecognised: true, rowsWithData: 1 });
  });
});

describe('sync', () => {
  const jimny = [metaRow('l:1', 'Asha', '9876543210'), metaRow('l:2', 'Ben', '9876543211')];
  const web = [['19-10-2026', 'Mohan', '9989928251', 'Grill', 'nevin', 'responded', 'msgd', '']];

  test('every row is accounted for; a dry run writes nothing', async () => {
    const dry = await sync(tabs(jimny, web), false);
    expect(dry.totals).toMatchObject({ rowsWithData: 3, ready: 3, added: 3 });
    expect(await MetaLead.countDocuments()).toBe(0);
  });

  test('running twice changes nothing and never duplicates', async () => {
    await sync(tabs(jimny, web));
    const again = await sync(tabs(jimny, web));
    expect(again.totals).toMatchObject({ added: 0, updated: 0, unchanged: 3 });
    expect(await MetaLead.countDocuments()).toBe(3);
  });

  test('two runs at the same moment still make one row each', async () => {
    await Promise.all([sync(tabs(jimny, web)), sync(tabs(jimny, web))]).catch(() => {});
    expect(await MetaLead.countDocuments()).toBe(3);
  });

  test('a Meta lead on two tabs is one row', async () => {
    const t = tabs(jimny);
    t.push({ name: 'copy', gid: 33, values: [META_HEAD, metaRow('l:1', 'Asha', '9876543210')] });
    const { totals } = await sync(t);
    expect(totals).toMatchObject({ rowsWithData: 3, ready: 2, repeatedMetaIds: 1 });
    expect(await MetaLead.countDocuments()).toBe(2);
  });

  test('a new row is added, a changed cell updates, a removed row stays', async () => {
    await sync(tabs(jimny, web));
    const next = [metaRow('l:1', 'Asha K', '9876543210'), metaRow('l:3', 'Cara', '9876543212')];
    const { totals } = await sync(tabs(next, web));
    expect(totals).toMatchObject({ added: 1, updated: 1 });
    expect(await MetaLead.countDocuments()).toBe(4);
    expect((await MetaLead.findOne({ sheetKey: 'l:1' })).name).toBe('Asha K');
    expect(await MetaLead.exists({ sheetKey: 'l:2' })).toBeTruthy();
  });

  test('a renamed tab moves its rows, it does not copy them', async () => {
    await sync(tabs(jimny, web));
    const t = tabs(jimny, web);
    t[1].name = 'site enquiries';
    await sync(t);
    expect(await MetaLead.countDocuments()).toBe(3);
    expect(await MetaLead.exists({ tab: 'site enquiries' })).toBeTruthy();
  });

  test('a run that loses to an edit leaves the edit alone', async () => {
    await sync(tabs(jimny, web));
    const doc = await MetaLead.findOne({ sheetKey: 'l:1' }).lean();
    const realFind = repo.findBySheetKeys;
    repo.findBySheetKeys = async (keys) => {
      const m = await realFind(keys);
      await MetaLead.updateOne({ _id: doc._id }, { $set: { name: 'By hand' }, $inc: { revision: 1 } });
      return m;
    };
    try { await sync(tabs([metaRow('l:1', 'Sheet value', '9876543210')], web)); } finally { repo.findBySheetKeys = realFind; }
    expect((await MetaLead.findById(doc._id)).name).toBe('By hand');
  });

  test('when Google fails, nothing changes and the failure is recorded for the page', async () => {
    await sync(tabs(jimny, web));
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = '{bad';
    expect(await runScheduledMetaLeadSync()).toBeNull();
    delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
    expect(await MetaLead.countDocuments()).toBe(3);
    expect((await repo.getState()).lastError).toMatch(/not valid JSON/);
  });

  test('stays off until it is configured', async () => {
    delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
    expect(await runScheduledMetaLeadSync()).toBeNull();
  });
});

describe('google client', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const account = { email: 'robot@x.iam', key: privateKey };
  const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

  beforeEach(() => resetGoogleSheetsToken());

  test('accepts raw or base64 JSON and refuses a key without its parts', () => {
    const raw = JSON.stringify({ client_email: 'a', private_key: 'b' });
    expect(readServiceAccount(raw)).toEqual({ email: 'a', key: 'b' });
    expect(readServiceAccount(Buffer.from(raw).toString('base64'))).toEqual({ email: 'a', key: 'b' });
    expect(() => readServiceAccount('{"client_email":"a"}')).toThrow(/missing/);
  });

  test('reads every tab, quoting names with apostrophes', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url) => {
      calls.push(String(url));
      if (String(url).includes('oauth2')) return json({ access_token: 't', expires_in: 3600 });
      if (String(url).includes('batchGet')) return json({ valueRanges: [{ values: [['id']] }, {}] });
      return json({ sheets: [{ properties: { sheetId: 1, title: "Thar's" } }, { properties: { sheetId: 2, title: 'b' } }] });
    });
    const out = await readAllTabs('abc', account);
    expect(out).toEqual([{ name: "Thar's", gid: 1, values: [['id']] }, { name: 'b', gid: 2, values: [] }]);
    expect(decodeURIComponent(calls[2]).replace(/\+/g, ' ')).toContain("ranges='Thar''s'");
  });

  test('a failed read throws with the status only', async () => {
    global.fetch = jest.fn(async (url) => (String(url).includes('oauth2') ? json({ access_token: 't', expires_in: 3600 }) : json({ secret: 'customer' }, false, 403)));
    await expect(readAllTabs('abc', account)).rejects.toThrow('Google sheet list failed (HTTP 403)');
  });
});

describe('API', () => {
  let n = 0;
  async function login(role, staff, name) {
    n += 1;
    const email = `m${n}@autobacs.test`;
    const password = 'SecurePass123!';
    const user = await User.create({ name: name || `User ${n}`, email, phone: '9000000001', passwordHash: await bcrypt.hash(password, 10), role, ...(staff && { staff: { active: true, isHead: false, ...staff } }) });
    const res = await request(app).post('/api/v1/auth/login').send({ email, password });
    return { Authorization: `Bearer ${(res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken=')).split(';')[0].slice('accessToken='.length)}` };
  }
  const seed = () => sync(tabs([metaRow('l:1', 'Asha', '9876543210')], [['', 'Mohan', '9989928251', 'Grill', 'nevin', 'responded', '', '']]));

  test.each([
    ['admin', ['admin'], true],
    ['GTM head', ['staff', { team: 'sales', isHead: true }], true],
    ['Marketing head', ['staff', { team: 'marketing', isHead: true }], true],
    ['GTM executive', ['staff', { team: 'sales', subRole: 'executive' }], false],
  ])('%s can see; edit = %s', async (_who, args, canEdit) => {
    await seed();
    const headers = await login(...args);
    const list = await request(app).get(BASE).set(headers).expect(200);
    expect(list.body.you.canEdit).toBe(canEdit);
    const lead = list.body.leads[0];
    await request(app).patch(`${BASE}/${lead.id}`).set(headers).send({ revision: 0, changes: { status: 'called' } }).expect(canEdit ? 200 : 403);
  });

  test.each([
    ['Marketing member', ['staff', { team: 'marketing' }]],
    ['Procurement head', ['staff', { team: 'procurement', isHead: true }]],
    ['customer', ['customer']],
  ])('%s is refused', async (_who, args) => {
    await seed();
    const res = await request(app).get(BASE).set(await login(...args));
    expect(res.status).toBe(403);
  });

  test('no login is 401, never 200', async () => { await request(app).get(BASE).expect(401); });

  test('undated rows come last; pages neither repeat nor skip', async () => {
    const jimny = Array.from({ length: 30 }, (_, i) => metaRow(`l:${i}`, `P${i}`, `98765${String(i).padStart(5, '0')}`, `2026-11-0${(i % 9) + 1}T10:00:00+05:30`));
    await sync(tabs(jimny, [['', 'NoDate', '9989928251', '', '', '', '', '']]));
    const headers = await login('admin');
    const first = await request(app).get(BASE).set(headers).expect(200);
    expect(first.body.leads).toHaveLength(25);
    const second = await request(app).get(`${BASE}?cursor=${first.body.nextCursor}`).set(headers).expect(200);
    const ids = [...first.body.leads, ...second.body.leads].map((l) => l.id);
    expect(ids).toHaveLength(31);
    expect(new Set(ids).size).toBe(31);
    expect(second.body.leads.at(-1).name).toBe('NoDate');
    expect(second.body.nextCursor).toBeNull();
  });

  test('filter by tab; find by phone or word; a regex typed in is only text', async () => {
    await seed();
    const headers = await login('admin');
    const tab = await request(app).get(`${BASE}?tab=${encodeURIComponent('website lead')}`).set(headers).expect(200);
    expect(tab.body.leads.map((l) => l.name)).toEqual(['Mohan']);
    expect(tab.body.tabs).toEqual(expect.arrayContaining([{ name: 'website lead', rows: 1 }]));
    expect((await request(app).get(`${BASE}?q=98765 43210`).set(headers)).body.leads.map((l) => l.name)).toEqual(['Asha']);
    expect((await request(app).get(`${BASE}?q=grill`).set(headers)).body.leads.map((l) => l.name)).toEqual(['Mohan']);
    expect((await request(app).get(`${BASE}?q=.*`).set(headers).expect(200)).body.leads).toEqual([]);
  });

  test('an edit is recorded and survives the next sync; other fields still update', async () => {
    await seed();
    const headers = await login('admin', undefined, 'Priya');
    const { body: { leads } } = await request(app).get(`${BASE}?q=Asha`).set(headers);
    const saved = await request(app).patch(`${BASE}/${leads[0].id}`).set(headers).send({ revision: 0, changes: { name: 'Asha Kumar' }, extras: { 'your_car?': 'Thar' } }).expect(200);
    expect(saved.body.lead.edits[0]).toMatchObject({ who: 'Priya', changes: expect.arrayContaining([{ field: 'Name', from: 'Asha', to: 'Asha Kumar' }]) });

    await sync(tabs([metaRow('l:1', 'Asha', '9000000000')]));
    const doc = await MetaLead.findById(leads[0].id).lean();
    expect(doc).toMatchObject({ name: 'Asha Kumar', phone: '9000000000' });
    expect(doc.fields.find((f) => f.label === 'your_car?').value).toBe('Thar');
  });

  test('two people saving the same version: one wins, the other sees theirs', async () => {
    await seed();
    const headers = await login('admin');
    const { body: { leads } } = await request(app).get(`${BASE}?q=Asha`).set(headers);
    await request(app).patch(`${BASE}/${leads[0].id}`).set(headers).send({ revision: 0, changes: { status: 'one' } }).expect(200);
    const late = await request(app).patch(`${BASE}/${leads[0].id}`).set(headers).send({ revision: 0, changes: { status: 'two' } }).expect(409);
    expect(late.body.lead.status).toBe('one');
  });

  test('saving nothing new changes nothing', async () => {
    await seed();
    const headers = await login('admin');
    const { body: { leads } } = await request(app).get(`${BASE}?q=Asha`).set(headers);
    const res = await request(app).patch(`${BASE}/${leads[0].id}`).set(headers).send({ revision: 0, changes: { name: 'Asha' } }).expect(200);
    expect(res.body.outcome).toBe('unchanged');
    expect((await MetaLead.findById(leads[0].id)).revision).toBe(0);
  });

  test('editing a date moves it in the list; clearing it sends it last', async () => {
    await seed();
    const headers = await login('admin');
    const { body: { leads } } = await request(app).get(`${BASE}?q=Mohan`).set(headers);
    await request(app).patch(`${BASE}/${leads[0].id}`).set(headers).send({ revision: 0, changes: { leadDate: '2026-12-01T10:30:00+05:30' } }).expect(200);
    expect((await request(app).get(BASE).set(headers)).body.leads[0].name).toBe('Mohan');
    await request(app).patch(`${BASE}/${leads[0].id}`).set(headers).send({ revision: 1, changes: { leadDate: null } }).expect(200);
    expect((await request(app).get(BASE).set(headers)).body.leads.at(-1).name).toBe('Mohan');
  });

  test('refuses unknown fields, non-text, Meta id edits, and a bad date', async () => {
    await seed();
    const headers = await login('admin');
    const { body: { leads } } = await request(app).get(`${BASE}?q=Asha`).set(headers);
    const url = `${BASE}/${leads[0].id}`;
    for (const body of [
      { revision: 0, changes: { editedFields: 'x' } },
      { revision: 0, changes: { name: { $gt: '' } } },
      { revision: 0, extras: { id: 'l:999' } },
      { revision: 0, changes: { leadDate: 'soon' } },
      { revision: 0, changes: { name: 'x'.repeat(2001) } },
    ]) await request(app).patch(url).set(headers).send(body).expect(400);
    expect((await MetaLead.findById(leads[0].id)).name).toBe('Asha');
  });

  test('an unknown lead is 404; a bad id is 400', async () => {
    const headers = await login('admin');
    await request(app).get(`${BASE}/507f1f77bcf86cd799439011`).set(headers).expect(404);
    await request(app).get(`${BASE}/nope`).set(headers).expect(400);
  });
});

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
// A next follow-up two days out: always in the future, always within the limit.
const NEXT = new Date(Date.now() + 2 * 24 * 3600e3).toISOString();

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

  // The live "fortuner ironman" tab: Meta's id heading typed over with "27497",
  // the sales person under a heading "id", follow-ups under no heading at all.
  test("staff columns after lead_status go by position, and Meta's id is found by its values", () => {
    const head = ['27497', 'created_time', 'form_name', 'full_name', 'phone_number', 'lead_status', 'id', '', '', ''];
    const row = ['l:77', '2026-10-29T07:01:30-05:00', 'fortuner form', 'Ravi', 'p:+919876543210', 'CREATED', 'Nizam', 'responded', 'sent on whatsapp', 'call later'];
    const { rows } = parseTab({ name: 'fortuner ironman', gid: 5, values: [head, row] });
    expect(rows[0]).toMatchObject({ sheetKey: 'l:77', metaLeadId: 'l:77', name: 'Ravi', salesPerson: 'Nizam', followUp1: 'responded', followUp2: 'sent on whatsapp', status: '' });
    expect(rows[0].fields.map((f) => f.label)).toEqual(['id', 'created_time', 'form_name', 'full_name', 'phone_number', 'lead_status', 'Sales person', 'Follow-up 1', 'Follow-up 2', 'Follow-up 3']);
    expect(rows[0].fields.at(-1).value).toBe('call later');
  });

  // The live "Thar Ironman" tab: the sales person headed "name" (not the customer),
  // a blank heading between follow-ups, and a "status" column at the end.
  test('a staff "name" heading is the sales person, not the customer; "status" stays the status', () => {
    const head = ['id', 'created_time', 'full_name', 'phone_number', 'lead_status', 'name', 'follow up 1', '', 'follow up 2', 'status'];
    const row = ['l:5', '2026-10-29T07:01:30-05:00', 'Asha', 'p:+919876543211', 'CREATED', 'Nevin', 'didnt pick', 'whatsapp', '', 'converted'];
    const { rows } = parseTab({ name: 'Thar Ironman', gid: 6, values: [head, row] });
    expect(rows[0]).toMatchObject({ name: 'Asha', salesPerson: 'Nevin', followUp1: 'didnt pick', followUp2: 'whatsapp', status: 'converted' });
    expect(new Set(rows[0].fields.map((f) => f.label)).size).toBe(head.length);
  });

  test('an "id" heading over text is never used as the key', () => {
    const head = ['created_time', 'full_name', 'phone_number', 'id'];
    const { rows } = parseTab({ name: 't', gid: 7, values: [head, ['2026-10-29T07:01:30-05:00', 'A', '9876543212', 'Nizam']] });
    expect(rows[0]).toMatchObject({ metaLeadId: null, sheetKey: 'gid:7|phone:9876543212#1' });
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

  test.each([
    ['10-11-2026 14:30', '2026-11-10T09:00:00.000Z', true],
    ['10/11/26 2:30 pm', '2026-11-10T09:00:00.000Z', true],
    ['10 Nov 2026', '2026-11-09T18:30:00.000Z', false],
    ['10-Nov-26', '2026-11-09T18:30:00.000Z', false],
    ['Nov 10, 2026 12:00 am', '2026-11-09T18:30:00.000Z', true],
    ['2026-11-10 14:30:00', '2026-11-10T09:00:00.000Z', true],
    ['2026-11-10T14:30:00', '2026-11-10T09:00:00.000Z', true],
    ['2026-11-10T09:00:00Z', '2026-11-10T09:00:00.000Z', true],
  ])('date %s is read in India time', (text, iso, hasTime) => {
    const { date, hasTime: time } = parseSheetDate(text);
    expect(date?.toISOString()).toBe(iso);
    expect(time).toBe(hasTime);
  });

  test.each(['31-02-2026', '10-13-2026', '10 Foo 2026', '10-11-2026 25:00', '10-11-2026 soon'])('date %s stays unread', (text) => {
    expect(parseSheetDate(text).date).toBeNull();
  });

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
    const realFind = repo.findAllForSync;
    repo.findAllForSync = async (keys) => {
      const m = await realFind(keys);
      await MetaLead.updateOne({ _id: doc._id }, { $set: { name: 'By hand' }, $inc: { revision: 1 } });
      return m;
    };
    try { await sync(tabs([metaRow('l:1', 'Sheet value', '9876543210')], web)); } finally { repo.findAllForSync = realFind; }
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

describe('sync keeps the right lead', () => {
  const WEB = (rows, gid = 22) => [{ name: 'website lead', gid, values: [WEB_HEAD, ...rows] }];
  const row = (date, name, phone, product) => [date, name, phone, product, 'nevin', '', '', ''];
  const take = (d) => ({ $set: { followingUpBy: d, followingUpName: 'Priya', followingUpAt: new Date(), followUpStatus: 'responded', followUpStatusAt: new Date(), followUpLog: [{ type: 'claim', byName: 'Priya' }] } });
  const owner = new (MetaLead.base.Types.ObjectId)();

  test('every column can change and follow-up work is untouched, run after run', async () => {
    await sync(tabs([metaRow('l:1', 'Asha', '9876543210')]));
    await MetaLead.updateOne({ sheetKey: 'l:1' }, take(owner));
    const before = await MetaLead.findOne({ sheetKey: 'l:1' }).lean();
    const moved = [{ name: 'renamed', gid: 11, values: [META_HEAD, ['l:9', '2026-11-08T10:00:00+05:30', 'ad', 'c', 'f', 'false', 'X', '9000000000', 'Y'], ['l:1', '2026-11-08T10:00:00+05:30', 'ad2', 'c2', 'f2', 'false', 'Asha K', '9111111111', 'Thar']] }];
    await sync(moved);
    await sync(moved);
    const after = await MetaLead.findOne({ sheetKey: 'l:1' }).lean();
    expect(after.name).toBe('Asha K');
    ['followingUpBy', 'followingUpName', 'followingUpAt', 'followUpStatus', 'followUpStatusAt', 'followUpLog'].forEach((f) => expect(after[f]).toEqual(before[f]));
  });

  test('a row gone from the sheet stays with its work, is marked, and comes back unmarked', async () => {
    const both = [metaRow('l:1', 'Asha', '9876543210'), metaRow('l:2', 'Ben', '9876543211')];
    await sync(tabs(both));
    await MetaLead.updateOne({ sheetKey: 'l:2' }, take(owner));
    const gone = await sync(tabs([both[0]]));
    expect(gone.totals.removed).toBe(1);
    let doc = await MetaLead.findOne({ sheetKey: 'l:2' }).lean();
    expect(doc.removedFromSheetAt).toBeTruthy();
    expect(doc.followUpStatus).toBe('responded');
    expect((await sync(tabs([both[0]]))).totals.removed).toBe(0);
    await sync(tabs(both));
    doc = await MetaLead.findOne({ sheetKey: 'l:2' }).lean();
    expect(doc.removedFromSheetAt).toBeNull();
  });

  test('a tab that cannot be read does not mark its rows as gone', async () => {
    await sync(tabs([metaRow('l:1', 'Asha', '9876543210')]));
    const broken = [{ name: 'jimny suspension', gid: 11, values: [['aaa', 'bbb'], ['x', 'y']] }];
    const res = await sync(broken);
    expect(res.totals.removed).toBe(0);
    expect((await repo.getState()).skippedTabs).toEqual(['jimny suspension']);
  });

  test('typed tab: a corrected phone keeps the same lead and its work', async () => {
    await sync(WEB([row('19-10-2026', 'Mohan', '9989928251', 'Grill')]));
    const first = await MetaLead.findOne({}).lean();
    await MetaLead.updateOne({ _id: first._id }, take(owner));
    await sync(WEB([row('19-10-2026', 'Mohan', '9989928252', 'Grill')]));
    expect(await MetaLead.countDocuments()).toBe(1);
    expect(await MetaLead.findById(first._id).lean()).toMatchObject({ phone: '9989928252', phoneKey: '9989928252', followUpStatus: 'responded' });
  });

  test('typed tab: deleting the first of two same-phone rows does not hand its work to the second', async () => {
    const a = row('19-10-2026', 'Mohan', '9989928251', 'Grill');
    const b = row('25-10-2026', 'Mohan', '9989928251', 'Spoiler');
    await sync(WEB([a, b]));
    const docA = await MetaLead.findOne({ product: 'Grill' }).lean();
    const docB = await MetaLead.findOne({ product: 'Spoiler' }).lean();
    await MetaLead.updateOne({ _id: docA._id }, take(owner));
    await sync(WEB([b]));
    expect(await MetaLead.findById(docA._id).lean()).toMatchObject({ product: 'Grill', followUpStatus: 'responded' });
    expect((await MetaLead.findById(docA._id).lean()).removedFromSheetAt).toBeTruthy();
    expect(await MetaLead.findById(docB._id).lean()).toMatchObject({ product: 'Spoiler', followUpStatus: null, removedFromSheetAt: null });
    expect(await MetaLead.countDocuments()).toBe(2);
  });

  test('typed tab: a new row after a deletion gets its own lead, not a saved one', async () => {
    const a = row('19-10-2026', 'Mohan', '9989928251', 'Grill');
    const b = row('25-10-2026', 'Mohan', '9989928251', 'Spoiler');
    await sync(WEB([a, b]));
    await sync(WEB([b]));
    await sync(WEB([b, row('30-10-2026', 'Mohan', '9989928251', 'Mats')]));
    expect(await MetaLead.countDocuments()).toBe(3);
    expect(new Set((await MetaLead.find({}).lean()).map((d) => d.sheetKey)).size).toBe(3);
  });

  test('typed tab: rows swapping places keep their own leads', async () => {
    const a = row('19-10-2026', 'Mohan', '9989928251', 'Grill');
    const b = row('25-10-2026', 'Mohan', '9989928251', 'Spoiler');
    await sync(WEB([a, b]));
    const docA = await MetaLead.findOne({ product: 'Grill' }).lean();
    const again = await sync(WEB([b, a]));
    expect(again.totals.added).toBe(0);
    expect(await MetaLead.findById(docA._id).lean()).toMatchObject({ product: 'Grill' });
    expect(await MetaLead.countDocuments()).toBe(2);
  });

  test('Meta ids typed over in most of the column: the untouched rows keep their leads', async () => {
    const head = ['Sheet id', 'created_time', 'full_name', 'phone_number', 'lead_status'];
    const rows = [['l:1', '2026-11-08T10:00:00+05:30', 'Asha', '9876543210', 'new'], ['l:2', '2026-11-08T10:00:00+05:30', 'Ben', '9876543211', 'new']];
    await sync([{ name: 'tab', gid: 5, values: [head, ...rows] }]);
    const typedOver = [rows[0], ['called him', ...rows[1].slice(1)], ['-', '2026-11-08T10:00:00+05:30', 'Cara', '9876543212', 'new']];
    await sync([{ name: 'tab', gid: 5, values: [head, ...typedOver] }]);
    expect(await MetaLead.countDocuments({ sheetKey: 'l:1' })).toBe(1);
    expect((await MetaLead.findOne({ sheetKey: 'l:1' }).lean()).removedFromSheetAt).toBeNull();
  });

  test('a column inserted is reported; a column added on the right is not', async () => {
    const head = ['id', 'full_name', 'phone_number', 'lead_status', 'sales', 'f1'];
    const r = ['l:1', 'Asha', '9876543210', 'new', 'nevin', 'msgd'];
    await sync([{ name: 'tab', gid: 5, values: [head, r] }]);
    const wider = await sync([{ name: 'tab', gid: 5, values: [[...head, 'extra'], [...r, 'x']] }]);
    expect(wider.shifted).toEqual([]);
    const inserted = await sync([{ name: 'tab', gid: 5, values: [['id', 'city', 'full_name', 'phone_number', 'lead_status', 'sales', 'f1', 'extra'], ['l:1', 'Kochi', 'Asha', '9876543210', 'new', 'nevin', 'msgd', 'x']] }]);
    expect(inserted.shifted).toEqual(['tab']);
  });

  test('the Tab filter keeps a tab deleted from the sheet while its rows exist', async () => {
    await sync(tabs([metaRow('l:1', 'Asha', '9876543210')], [row('19-10-2026', 'Mohan', '9989928251', 'Grill')]));
    await sync([tabs([metaRow('l:1', 'Asha', '9876543210')])[0]]);
    expect((await repo.getState()).tabs.map((t) => t.name)).toEqual(['jimny suspension', 'website lead']);
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

  test('a busy Google is tried again; a refusal is not', async () => {
    resetGoogleSheetsToken();
    const account = { email: 'r@x', key: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    const replies = [{ ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) }, { ok: false, status: 503 }, { ok: true, json: async () => ({ sheets: [] }) }];
    global.fetch = jest.fn(async () => replies.shift());
    await expect(readAllTabs('sheet', account)).resolves.toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    global.fetch = jest.fn(async () => ({ ok: false, status: 403 }));
    await expect(readAllTabs('sheet', account)).rejects.toThrow('HTTP 403');
    expect(global.fetch).toHaveBeenCalledTimes(1);
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

  describe('following up', () => {
    const GTM = ['staff', { team: 'sales', subRole: 'executive' }, 'Exec'];
    const OTHER = ['staff', { team: 'sales', subRole: 'support' }, 'Support'];
    const HEAD = ['staff', { team: 'sales', isHead: true }, 'Head'];
    const firstLead = async (headers) => (await request(app).get(`${BASE}?q=Asha`).set(headers)).body.leads[0];

    test('two clicks at once: one owner, the other is told who, one history line', async () => {
      await seed();
      const [a, b] = await Promise.all([login(...GTM), login(...OTHER)]);
      const { id } = await firstLead(a);
      const res = await Promise.all([a, b].map((h) => request(app).post(`${BASE}/${id}/follow-up`).set(h).send({})));
      expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
      const lost = res.find((r) => r.status === 409);
      expect(lost.body).toMatchObject({ outcome: 'taken', message: expect.stringMatching(/already following up/) });
      const doc = await MetaLead.findById(id).lean();
      expect(doc.followUpLog).toHaveLength(1);
    });

    test('taking your own again is fine and adds nothing', async () => {
      await seed();
      const a = await login(...GTM);
      const { id } = await firstLead(a);
      await request(app).post(`${BASE}/${id}/follow-up`).set(a).send({}).expect(200);
      const again = await request(app).post(`${BASE}/${id}/follow-up`).set(a).send({}).expect(200);
      expect(again.body.outcome).toBe('already_yours');
      expect((await MetaLead.findById(id).lean()).followUpLog).toHaveLength(1);
    });

    test('a phone shows only after you take the lead; others never see it', async () => {
      await seed();
      const [a, b] = await Promise.all([login(...GTM), login(...OTHER)]);
      const before = await firstLead(a);
      expect(before).toMatchObject({ phone: '', email: '', contactHidden: true });
      const taken = await request(app).post(`${BASE}/${before.id}/follow-up`).set(a).send({}).expect(200);
      expect(taken.body.lead).toMatchObject({ phone: '9876543210', contactHidden: false, followingUp: { name: 'Exec', mine: true } });
      expect(await firstLead(b)).toMatchObject({ phone: '', contactHidden: true, followingUp: { name: 'Exec', mine: false } });
      const open = await request(app).get(`${BASE}/${before.id}`).set(b).expect(200);
      expect(JSON.stringify(open.body)).not.toContain('9876543210');
    });

    test.each([
      ['GTM head', HEAD], ['Marketing head', ['staff', { team: 'marketing', isHead: true }, 'MH']], ['admin', ['admin']],
    ])('%s always sees the phone', async (_who, args) => {
      await seed();
      expect((await firstLead(await login(...args))).phone).toBe('9876543210');
    });

    test('a contact answer in the extra columns, and past phone edits, stay hidden too', async () => {
      const head = ['id', 'full_name', 'phone_number', 'Alternate whatsapp?', 'your_car?'];
      await sync([{ name: 'tab', gid: 5, values: [head, ['l:1', 'Asha', '9876543210', '9000012345', 'Thar']] }]);
      const admin = await login('admin');
      const { id } = await firstLead(admin);
      await request(app).patch(`${BASE}/${id}`).set(admin).send({ revision: 0, changes: { phone: '9876500000', name: 'Asha K' } }).expect(200);
      const open = await request(app).get(`${BASE}/${id}`).set(await login(...GTM)).expect(200);
      const text = JSON.stringify(open.body);
      ['9876543210', '9876500000', '9000012345'].forEach((n) => expect(text).not.toContain(n));
      expect(open.body.lead.edits[0].changes.map((c) => c.field)).toEqual(['Name']);
      expect(open.body.lead.extras.map((x) => x.label)).toContain('your_car?');
    });

    test('recording: status + note goes in the history; a later one replaces it on the card', async () => {
      await seed();
      const a = await login(...GTM);
      const { id } = await firstLead(a);
      await request(app).post(`${BASE}/${id}/follow-up`).set(a).send({}).expect(200);
      const one = await request(app).post(`${BASE}/${id}/follow-ups`).set(a).send({ status: 'no_response', nextAt: NEXT, note: 'Rang twice' }).expect(200);
      expect(one.body.lead.followUpStatus).toMatchObject({ status: 'no_response', label: 'No response' });
      await request(app).post(`${BASE}/${id}/follow-ups`).set(a).send({ status: 'not_interested' }).expect(200);
      const fixed = await request(app).post(`${BASE}/${id}/follow-ups`).set(a).send({ status: 'responded', nextAt: NEXT }).expect(200);
      expect(fixed.body.lead.followUpStatus.status).toBe('responded');
      const open = await request(app).get(`${BASE}/${id}`).set(a).expect(200);
      expect(open.body.lead.history.map((h) => h.label)).toEqual(['Responded', 'Not interested', 'No response', 'Started following up']);
      expect(open.body.lead.history[2]).toMatchObject({ who: 'Exec', notes: 'Rang twice', followUpStatus: 'no_response' });
    });

    test('a double click is one follow-up', async () => {
      await seed();
      const a = await login(...GTM);
      const { id } = await firstLead(a);
      await request(app).post(`${BASE}/${id}/follow-up`).set(a).send({}).expect(200);
      const res = await Promise.all([1, 2].map(() => request(app).post(`${BASE}/${id}/follow-ups`).set(a).send({ status: 'whatsapp', nextAt: NEXT, note: 'sent' })));
      expect(res.map((r) => r.status)).toEqual([200, 200]);
      expect(res.map((r) => r.body.outcome).sort()).toEqual(['duplicate', 'saved']);
      expect((await MetaLead.findById(id).lean()).followUpLog.filter((e) => e.type === 'follow_up')).toHaveLength(1);
    });

    test('bad input: unknown status, Others with no note, too long a note, nobody following', async () => {
      await seed();
      const a = await login(...GTM);
      const { id } = await firstLead(a);
      expect((await request(app).post(`${BASE}/${id}/follow-ups`).set(a).send({ status: 'responded', nextAt: NEXT }).expect(409)).body.outcome).toBe('not_following');
      await request(app).post(`${BASE}/${id}/follow-up`).set(a).send({}).expect(200);
      await request(app).post(`${BASE}/${id}/follow-ups`).set(a).send({ status: 'nope' }).expect(400);
      await request(app).post(`${BASE}/${id}/follow-ups`).set(a).send({ status: 'other', note: '  ' }).expect(400);
      await request(app).post(`${BASE}/${id}/follow-ups`).set(a).send({ status: 'responded', nextAt: NEXT, note: 'x'.repeat(501) }).expect(400);
    });

    test('who may do what', async () => {
      await seed();
      const [owner, other, head] = await Promise.all([login(...GTM), login(...OTHER), login(...HEAD)]);
      const { id } = await firstLead(owner);
      await request(app).post(`${BASE}/${id}/follow-up`).set(owner).send({}).expect(200);
      await request(app).post(`${BASE}/${id}/follow-ups`).set(other).send({ status: 'responded', nextAt: NEXT }).expect(403);
      await request(app).post(`${BASE}/${id}/release`).set(other).send({}).expect(403);
      await request(app).post(`${BASE}/${id}/reassign`).set(other).send({ userId: id }).expect(403);
      await request(app).post(`${BASE}/${id}/follow-ups`).set(head).send({ status: 'responded', nextAt: NEXT }).expect(200);
      const freed = await request(app).post(`${BASE}/${id}/release`).set(head).send({}).expect(200);
      expect(freed.body.lead.followingUp).toBeNull();
      expect(freed.body.lead.followUpStatus.status).toBe('responded');
    });

    test.each([
      ['take', 'post', 'follow-up', {}],
      ['record', 'post', 'follow-ups', { status: 'responded' }],
      ['release', 'post', 'release', {}],
    ])('%s: a bad login is 401; Marketing head, who only views, is 403 on take/record', async (name, method, action, send) => {
      await seed();
      const admin = await login('admin');
      const { id } = await firstLead(admin);
      await request(app)[method](`${BASE}/${id}/${action}`).set({ Authorization: 'Bearer not-a-token' }).send(send).expect(401);
      if (name !== 'release') {
        await request(app)[method](`${BASE}/${id}/${action}`).set(await login('staff', { team: 'marketing', isHead: true })).send(send).expect(403);
      }
      await request(app)[method](`${BASE}/${id}/${action}`).set(await login('staff', { team: 'procurement', isHead: true })).send(send).expect(403);
    });

    test('moving: head to a GTM member only; the new owner sees the phone', async () => {
      await seed();
      const User2 = await login(...GTM);
      const head = await login(...HEAD);
      const member = (await User.findOne({ name: 'Exec' }).lean())._id;
      const customer = await User.create({ name: 'C', email: 'c@x.test', passwordHash: 'x', phone: '9000000002', role: 'customer' });
      const { id } = await firstLead(head);
      await request(app).post(`${BASE}/${id}/reassign`).set(head).send({ userId: String(customer._id) }).expect(400);
      const moved = await request(app).post(`${BASE}/${id}/reassign`).set(head).send({ userId: String(member) }).expect(200);
      expect(moved.body.lead.followingUp.name).toBe('Exec');
      expect((await firstLead(User2)).phone).toBe('9876543210');
      const people = await request(app).get(`${BASE}/people`).set(head).expect(200);
      expect(people.body.people.map((p) => p.name)).toEqual(['Exec']);
      expect(people.body.members.map((p) => p.name)).toEqual(expect.arrayContaining(['Exec', 'Head']));
      const plain = await request(app).get(`${BASE}/people`).set(User2).expect(200);
      expect(plain.body.members).toBeUndefined();
    });

    test('filters: unclaimed, mine, person, status, none; paging holds under a filter', async () => {
      const jimny = Array.from({ length: 30 }, (_, i) => metaRow(`l:${i}`, `P${i}`, `98765${String(i).padStart(5, '0')}`, `2026-11-0${(i % 9) + 1}T10:00:00+05:30`));
      await sync(tabs(jimny));
      const a = await login(...GTM);
      const all = (await request(app).get(BASE).set(a)).body.leads;
      await request(app).post(`${BASE}/${all[0].id}/follow-up`).set(a).send({}).expect(200);
      await request(app).post(`${BASE}/${all[1].id}/follow-up`).set(a).send({}).expect(200);
      await request(app).post(`${BASE}/${all[1].id}/follow-ups`).set(a).send({ status: 'whatsapp', nextAt: NEXT }).expect(200);
      const ids = async (qs) => (await request(app).get(`${BASE}?${qs}`).set(a).expect(200)).body.leads.map((l) => l.id);
      expect(await ids('view=mine')).toEqual([all[0].id, all[1].id].sort(() => 0));
      expect(await ids('followUp=whatsapp')).toEqual([all[1].id]);
      const userId = (await request(app).get(`${BASE}/people`).set(a)).body.people[0].userId;
      expect((await ids(`owner=${userId}`)).sort()).toEqual([all[0].id, all[1].id].sort());
      const free1 = await request(app).get(`${BASE}?view=free`).set(a).expect(200);
      const free2 = await request(app).get(`${BASE}?view=free&cursor=${free1.body.nextCursor}`).set(a).expect(200);
      const free = [...free1.body.leads, ...free2.body.leads].map((l) => l.id);
      expect(free).toHaveLength(28);
      expect(new Set(free).size).toBe(28);
      expect(free).not.toContain(all[0].id);
      expect((await ids('followUp=none')).length).toBe(25);
      await request(app).get(`${BASE}?view=nope`).set(a).expect(400);
      await request(app).get(`${BASE}?followUp=nope`).set(a).expect(400);
    });

    test('the same customer on another tab, or on Website leads, is noted, not merged', async () => {
      await sync(tabs([metaRow('l:1', 'Asha', '+919876543210'), metaRow('l:2', 'Asha', '9876543210')], [['', 'Asha', '09876543210', 'Grill', '', '', '', '']]));
      const { default: Lead } = await import('../models/Lead.js');
      await Lead.create({ name: 'Asha', phone: '9876543210', identityKey: 'phone:9876543210', status: 'new', sources: [], primarySource: 'consultation' });
      const admin = await login('admin');
      const { body } = await request(app).get(`${BASE}?tab=${encodeURIComponent('website lead')}`).set(admin).expect(200);
      expect(body.leads[0].others.map((o) => o.tab)).toEqual(['jimny suspension', 'jimny suspension']);
      expect(body.leads[0].inWebsiteLeads).toBe(true);
      expect(await MetaLead.countDocuments()).toBe(3);
    });

    test('the page reports a moved column and a skipped tab', async () => {
      await sync([{ name: 'odd', gid: 9, values: [['aaa', 'bbb'], ['x', 'y']] }, ...tabs([metaRow('l:1', 'Asha', '9876543210')])]);
      const { body } = await request(app).get(BASE).set(await login('admin')).expect(200);
      expect(body.sync.skippedTabs).toEqual(['odd']);
      expect(body.sync.columnsMoved).toEqual([]);
    });
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

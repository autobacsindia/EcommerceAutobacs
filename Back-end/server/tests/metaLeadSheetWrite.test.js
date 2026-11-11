/**
 * Panel → Google Sheet (services/metaLeadSheetWriter.js). Google is a fake sheet
 * held in memory: reads return its cells, writes change them, so a test can sort
 * rows, break Google, or run the sheet → panel sync over what was written.
 * The database is real.
 */
import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';

const { default: request } = await import('supertest');
const { app, cronService, adaptiveThrottlingService } = await import('../app.js');
const dbHandler = await import('./db-handler.js');
const { default: User } = await import('../models/User.js');
const { default: MetaLead } = await import('../models/MetaLead.js');
const { default: repo } = await import('../repositories/metaLeadRepository.js');
const { syncMetaLeadsFromSheet } = await import('../services/metaLeadSync.js');
const { flushMetaLeadSheetWrites, planSheetWrites, requestMetaLeadSheetWrite } = await import('../services/metaLeadSheetWriter.js');
const { writeCells, resetGoogleSheetsToken, a1Column } = await import('../services/googleSheetsClient.js');
const { PANEL_COLUMNS, parseTab } = await import('../utils/metaLeadSheet.js');

jest.setTimeout(120000);
const BASE = '/api/v1/staff/meta-leads';
const NEXT = new Date(Date.now() + 2 * 24 * 3600e3).toISOString();

const META_HEAD = ['id', 'created_time', 'campaign_name', 'form_name', 'full_name', 'phone_number', 'lead_status', 'sales person', 'follow up 1'];
const metaRow = (id, name, phone) => [id, '2026-11-07T22:51:17-05:00', 'jimny camp', 'jimny form', name, phone, 'CREATED', '', ''];
const WEB_HEAD = ['date', 'name', 'phone', 'product', 'sales person', 'status', '', ''];
const webRow = (name, phone, product) => ['10-11-2026', name, phone, product, '', '', '', ''];

/** A sheet in memory, written the way Google writes it. */
function fakeSheet(tabs) {
  const sheet = { tabs: structuredClone(tabs), writes: [], fail: [] };
  const colIndex = (letters) => [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
  sheet.readTabs = async () => structuredClone(sheet.tabs);
  sheet.write = async (_id, { grow = [], data = [] }) => {
    const f = sheet.fail.shift();
    if (f) { const err = new Error(`Google sheet write failed (HTTP ${f})`); err.status = f; throw err; }
    sheet.writes.push({ grow, data });
    grow.forEach((g) => { const t = sheet.tabs.find((x) => x.gid === g.gid); t.columnCount += g.columns; });
    data.forEach(({ range, values }) => {
      const m = /^'((?:[^']|'')*)'!([A-Z]+)(\d+)$/.exec(range);
      const tab = sheet.tabs.find((t) => t.name === m[1].replace(/''/g, "'"));
      const col = colIndex(m[2]);
      if (tab.columnCount && col >= tab.columnCount) throw new Error('Range exceeds grid limits');
      const row = Number(m[3]);
      while (tab.values.length < row) tab.values.push([]);
      const cells = tab.values[row - 1];
      while (cells.length <= col) cells.push('');
      cells[col] = values[0][0];
    });
  };
  sheet.flush = () => flushMetaLeadSheetWrites({ readTabs: sheet.readTabs, write: sheet.write });
  sheet.sync = () => syncMetaLeadsFromSheet({ readTabs: sheet.readTabs });
  sheet.tab = (name) => sheet.tabs.find((t) => t.name === name);
  /** The cell under a heading, on the row whose `keyCol` holds `key`. */
  sheet.cell = (tabName, key, heading, keyCol = null) => {
    const t = sheet.tab(tabName);
    const head = t.values[0];
    const col = head.findIndex((h) => h === heading);
    const row = t.values.find((r, i) => i > 0 && (keyCol == null ? r.includes(key) : r[keyCol] === key));
    return col < 0 || !row ? undefined : (row[col] ?? '');
  };
  return sheet;
}

const START = () => [
  { name: 'jimny', gid: 11, columnCount: 26, values: [META_HEAD, metaRow('l:1', 'Asha', 'p:+919876543210'), metaRow('l:2', 'Ravi', 'p:+919876543211')] },
  { name: 'website lead', gid: 22, columnCount: 26, values: [WEB_HEAD, webRow('Mohan', '9989928251', 'Grill'), webRow('Mohan', '9989928251', 'Bumper')] },
];

let n = 0;
async function login(role, staff, name) {
  n += 1;
  const email = `w${n}@autobacs.test`;
  const password = 'SecurePass123!';
  const user = await User.create({ name: name || `User ${n}`, email, phone: '9000000001', passwordHash: await bcrypt.hash(password, 10), role, ...(staff && { staff: { active: true, isHead: false, ...staff } }) });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return { user, headers: { Authorization: `Bearer ${(res.headers['set-cookie'] || []).find((c) => c.startsWith('accessToken=')).split(';')[0].slice('accessToken='.length)}` } };
}
const GTM = ['staff', { team: 'sales', subRole: 'executive' }, 'Nevin'];
const HEAD = ['staff', { team: 'sales', isHead: true }, 'Head'];
const leadOf = async (q) => MetaLead.findOne(q).lean();

beforeAll(async () => {
  await dbHandler.connect();
  process.env.META_LEADS_SHEET_ID = 'sheet';
  process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'robot@test-project.iam.gserviceaccount.com', private_key: 'not-a-key' });
});
afterEach(async () => { await dbHandler.clearDatabase(); delete global.fetch; });
afterAll(async () => {
  delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
  await dbHandler.closeDatabase();
  if (cronService?.shutdown) cronService.shutdown();
  if (adaptiveThrottlingService?.shutdown) adaptiveThrottlingService.shutdown();
});

describe('reading skips the panel columns', () => {
  test('panel columns are not fields, not follow-ups, and do not shift the sales columns', () => {
    const values = [
      [...META_HEAD, PANEL_COLUMNS.leadId, PANEL_COLUMNS.status],
      [...metaRow('l:1', 'Asha', 'p:+919876543210').slice(0, 7), 'nevin', 'rang', '65a1b2c3d4e5f6a7b8c9d0e1', 'WhatsApp'],
    ];
    const { rows, report } = parseTab({ name: 'jimny', gid: 1, values });
    expect(rows[0]).toMatchObject({ salesPerson: 'nevin', followUp1: 'rang', followUp2: '' });
    expect(rows[0].fields.map((f) => f.label)).not.toEqual(expect.arrayContaining([PANEL_COLUMNS.leadId, PANEL_COLUMNS.status]));
    expect(report.columns).toEqual(expect.not.arrayContaining([PANEL_COLUMNS.status]));
  });
});

describe('every kind of panel change reaches the sheet', () => {
  test('take, follow-up, move the deadline, edit fields, move, free', async () => {
    const sheet = fakeSheet(START());
    await sheet.sync();
    const { headers: exec } = await login(...GTM);
    const { headers: head, user: headUser } = await login(...HEAD);
    const { id } = (await request(app).get(`${BASE}?q=Asha`).set(head)).body.leads[0];

    await request(app).post(`${BASE}/${id}/follow-up`).set(exec).send({}).expect(200);
    await sheet.flush();
    expect(sheet.cell('jimny', 'l:1', PANEL_COLUMNS.followingUp)).toBe('Nevin');
    expect(sheet.cell('jimny', 'l:1', PANEL_COLUMNS.leadId)).toBe(id);
    expect(sheet.cell('jimny', 'l:1', PANEL_COLUMNS.nextBy)).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/);

    await request(app).post(`${BASE}/${id}/follow-ups`).set(exec).send({ status: 'whatsapp', note: '<p>Sent the <b>price</b> list</p>', nextAt: NEXT }).expect(200);
    await sheet.flush();
    expect(sheet.cell('jimny', 'l:1', PANEL_COLUMNS.status)).toBe('WhatsApp');
    expect(sheet.cell('jimny', 'l:1', PANEL_COLUMNS.note)).toBe('Sent the price list');

    const before = sheet.cell('jimny', 'l:1', PANEL_COLUMNS.nextBy);
    const later = new Date(Date.now() + 5 * 24 * 3600e3).toISOString();
    await request(app).post(`${BASE}/${id}/next-follow-up`).set(exec).send({ nextAt: later, reason: 'Customer travelling this week' }).expect(200);
    await sheet.flush();
    expect(sheet.cell('jimny', 'l:1', PANEL_COLUMNS.nextBy)).not.toBe(before);

    const lead = await leadOf({ _id: id });
    await request(app).patch(`${BASE}/${id}`).set(head).send({ revision: lead.revision, changes: { salesPerson: 'Nevin K', name: 'Asha R' } }).expect(200);
    await sheet.flush();
    // The team's own cells, because the panel now owns those two fields.
    expect(sheet.cell('jimny', 'l:1', 'sales person')).toBe('Nevin K');
    expect(sheet.cell('jimny', 'l:1', 'full_name')).toBe('Asha R');

    await request(app).post(`${BASE}/${id}/reassign`).set(head).send({ userId: String(headUser._id) }).expect(200);
    await sheet.flush();
    expect(sheet.cell('jimny', 'l:1', PANEL_COLUMNS.followingUp)).toBe('Head');

    await request(app).post(`${BASE}/${id}/release`).set(head).send({}).expect(200);
    await sheet.flush();
    expect(sheet.cell('jimny', 'l:1', PANEL_COLUMNS.followingUp)).toBe('');
    expect(sheet.cell('jimny', 'l:1', PANEL_COLUMNS.nextBy)).toBe('');
    // Ravi's row was never touched.
    expect(sheet.cell('jimny', 'l:2', PANEL_COLUMNS.followingUp)).toBe('');
    expect((await leadOf({ _id: id })).sheetDirty).toBe(false);
  });

  test('a form answer edited in the panel is written to its own column', async () => {
    const sheet = fakeSheet([{ name: 'jimny', gid: 11, columnCount: 26, values: [[...META_HEAD.slice(0, 6), 'your_car?', 'lead_status'], ['l:1', '2026-11-07', 'c', 'f', 'Asha', 'p:+919876543210', 'Jimny', 'CREATED']] }]);
    await sheet.sync();
    const { headers: head } = await login(...HEAD);
    const lead = await leadOf({});
    await request(app).patch(`${BASE}/${lead._id}`).set(head).send({ revision: 0, extras: { 'your_car?': 'Thar' } }).expect(200);
    await sheet.flush();
    expect(sheet.cell('jimny', 'l:1', 'your_car?')).toBe('Thar');
  });
});

describe('finding the row', () => {
  test('sorted rows: the pinned lead id still finds the right row', async () => {
    const sheet = fakeSheet(START());
    await sheet.sync();
    const { headers: exec } = await login(...GTM);
    const mohanGrill = await leadOf({ product: 'Grill' });
    await request(app).post(`${BASE}/${mohanGrill._id}/follow-up`).set(exec).send({}).expect(200);
    await sheet.flush();

    // Someone sorts the tab by product: Bumper first, Grill second; and inserts a row on top.
    const web = sheet.tab('website lead');
    const [header, grill, bumper] = web.values;
    web.values = [header, ['11-11-2026', 'New', '9000000009', 'Mats', '', '', '', ''], bumper, grill];

    await request(app).post(`${BASE}/${mohanGrill._id}/follow-ups`).set(exec).send({ status: 'responded', nextAt: NEXT }).expect(200);
    await sheet.flush();
    const statusCol = web.values[0].indexOf(PANEL_COLUMNS.status);
    expect(web.values[3][3]).toBe('Grill');
    expect(web.values[3][statusCol]).toBe('Responded');
    expect(web.values[2][statusCol] ?? '').toBe('');
    expect(web.values[1][statusCol] ?? '').toBe('');
  });

  test('a Meta lead is found by its Meta id after a sort, before any panel id exists', async () => {
    const sheet = fakeSheet(START());
    await sheet.sync();
    const jimny = sheet.tab('jimny');
    jimny.values = [jimny.values[0], jimny.values[2], jimny.values[1]];
    const { headers: exec } = await login(...GTM);
    const asha = await leadOf({ metaLeadId: 'l:1' });
    await request(app).post(`${BASE}/${asha._id}/follow-up`).set(exec).send({}).expect(200);
    await sheet.flush();
    expect(sheet.cell('jimny', 'l:1', PANEL_COLUMNS.followingUp)).toBe('Nevin');
    expect(sheet.cell('jimny', 'l:2', PANEL_COLUMNS.followingUp)).toBe('');
  });

  test('two equally likely typed rows: nothing is written, the lead says so', () => {
    const tabs = [{ name: 'website lead', gid: 22, values: [WEB_HEAD, webRow('Mohan', '9989928251', 'Grill'), webRow('Mohan', '9989928251', 'Grill')] }];
    const lead = { _id: '65a1b2c3d4e5f6a7b8c9d0e1', tab: 'website lead', name: 'Mohan', phone: '9989928251', product: 'Grill', dateRaw: '10-11-2026', sheetWanted: 1 };
    const plan = planSheetWrites(tabs, [lead]);
    expect(plan.data).toEqual([]);
    expect(plan.results[0].error).toBe('ambiguous');
  });

  test('a lead not in the sheet is skipped and recorded, and the rest still write', async () => {
    const sheet = fakeSheet(START());
    await sheet.sync();
    const { headers: exec } = await login(...GTM);
    const ravi = await leadOf({ metaLeadId: 'l:2' });
    const asha = await leadOf({ metaLeadId: 'l:1' });
    sheet.tab('jimny').values.splice(2, 1); // Ravi's row deleted in the sheet
    await request(app).post(`${BASE}/${ravi._id}/follow-up`).set(exec).send({}).expect(200);
    await request(app).post(`${BASE}/${asha._id}/follow-up`).set(exec).send({}).expect(200);
    const out = await sheet.flush();
    expect(out.notFound).toBe(1);
    expect(await leadOf({ _id: ravi._id })).toMatchObject({ sheetDirty: false, sheetWriteError: 'not_in_sheet' });
    expect(sheet.cell('jimny', 'l:1', PANEL_COLUMNS.followingUp)).toBe('Nevin');
    const list = await request(app).get(BASE).set(exec);
    expect(list.body.sync.writeBack).toMatchObject({ notInSheet: 1, pending: 0, error: null });
    expect(list.body.leads.find((l) => l.id === String(ravi._id)).sheet).toEqual({ waiting: false, problem: 'not_in_sheet' });
  });
});

describe('idempotent, safe under failure, no ping-pong', () => {
  test('the same state written twice changes nothing the second time', async () => {
    const sheet = fakeSheet(START());
    await sheet.sync();
    const { headers: exec } = await login(...GTM);
    const asha = await leadOf({ metaLeadId: 'l:1' });
    await request(app).post(`${BASE}/${asha._id}/follow-up`).set(exec).send({}).expect(200);
    const first = await sheet.flush();
    expect(first.cells).toBeGreaterThan(0);
    // Marked again with nothing new (a retried job, a second replica).
    await MetaLead.updateOne({ _id: asha._id }, { $set: { sheetDirty: true } });
    const again = await sheet.flush();
    expect(again.cells).toBe(0);
    expect(sheet.writes.at(-1).data).toEqual([]);
  });

  test('Google down: the panel save still succeeds, the lead waits, the retry writes it', async () => {
    const sheet = fakeSheet(START());
    await sheet.sync();
    const { headers: exec } = await login(...GTM);
    const asha = await leadOf({ metaLeadId: 'l:1' });
    sheet.fail.push(503);
    await request(app).post(`${BASE}/${asha._id}/follow-up`).set(exec).send({}).expect(200);
    await expect(sheet.flush()).rejects.toThrow('HTTP 503');
    expect((await leadOf({ _id: asha._id })).sheetDirty).toBe(true);
    let list = await request(app).get(BASE).set(exec);
    expect(list.body.sync.writeBack).toMatchObject({ pending: 1, errorKind: 'unavailable', error: expect.stringMatching(/did not answer/) });

    await sheet.flush();
    expect(sheet.cell('jimny', 'l:1', PANEL_COLUMNS.followingUp)).toBe('Nevin');
    expect((await leadOf({ _id: asha._id })).sheetDirty).toBe(false);
    list = await request(app).get(BASE).set(exec);
    expect(list.body.sync.writeBack).toMatchObject({ pending: 0, error: null });
  });

  test('no Editor access: a clear message naming the robot account, nothing thrown, lead keeps waiting', async () => {
    const sheet = fakeSheet(START());
    await sheet.sync();
    const { headers: exec } = await login(...GTM);
    const asha = await leadOf({ metaLeadId: 'l:1' });
    sheet.fail.push(403);
    await request(app).post(`${BASE}/${asha._id}/follow-up`).set(exec).send({}).expect(200);
    await expect(sheet.flush()).resolves.toMatchObject({ error: 'permission' });
    const list = await request(app).get(BASE).set(exec);
    expect(list.body.sync.writeBack).toMatchObject({
      errorKind: 'permission', pending: 1,
      error: expect.stringMatching(/not shared .* as Editor/),
      robotEmail: 'robot@test-project.iam.gserviceaccount.com',
    });
    expect(JSON.stringify(list.body.sync)).not.toMatch(/private_key|not-a-key/);
  });

  test('a change made while a write is in flight is not lost', async () => {
    const sheet = fakeSheet(START());
    await sheet.sync();
    const { headers: exec } = await login(...GTM);
    const asha = await leadOf({ metaLeadId: 'l:1' });
    await request(app).post(`${BASE}/${asha._id}/follow-up`).set(exec).send({}).expect(200);
    const write = sheet.write;
    sheet.write = async (...args) => {
      await write(...args);
      await request(app).post(`${BASE}/${asha._id}/follow-ups`).set(exec).send({ status: 'responded', nextAt: NEXT }).expect(200);
    };
    await sheet.flush();
    expect((await leadOf({ _id: asha._id })).sheetDirty).toBe(true);
    sheet.write = write;
    await sheet.flush();
    expect(sheet.cell('jimny', 'l:1', PANEL_COLUMNS.status)).toBe('Responded');
  });

  test('no ping-pong: the sheet sync reads back nothing the panel wrote', async () => {
    const sheet = fakeSheet(START());
    await sheet.sync();
    const { headers: exec } = await login(...GTM);
    const { headers: head } = await login(...HEAD);
    const asha = await leadOf({ metaLeadId: 'l:1' });
    await request(app).post(`${BASE}/${asha._id}/follow-up`).set(exec).send({}).expect(200);
    await request(app).post(`${BASE}/${asha._id}/follow-ups`).set(exec).send({ status: 'other', note: 'Asked for a call after Diwali', nextAt: NEXT }).expect(200);
    await request(app).patch(`${BASE}/${asha._id}`).set(head).send({ revision: 0, changes: { salesPerson: 'Nevin K' } }).expect(200);
    await sheet.flush();
    const before = await leadOf({ _id: asha._id });

    // The first read may refresh the lead's raw copy of the row once (it now
    // holds the cell the panel wrote); the panel-owned values never move, and it
    // settles: the next read changes nothing.
    const { shifted } = await sheet.sync();
    expect(shifted).toEqual([]);
    expect((await sheet.sync()).totals.updated).toBe(0);
    const after = await leadOf({ _id: asha._id });
    expect(after.fields.map((f) => f.label).some((l) => l.startsWith('Panel'))).toBe(false);
    expect(after).toMatchObject({ salesPerson: 'Nevin K', followUpStatus: 'other', revision: before.revision, sheetDirty: false });
    // And writing again finds nothing to change.
    await MetaLead.updateOne({ _id: asha._id }, { $set: { sheetDirty: true } });
    expect((await sheet.flush()).cells).toBe(0);
  });

  test('a tab with no room gets columns added before the write', async () => {
    const tabs = START();
    tabs[0].columnCount = 9;
    const sheet = fakeSheet(tabs);
    await sheet.sync();
    const { headers: exec } = await login(...GTM);
    const asha = await leadOf({ metaLeadId: 'l:1' });
    await request(app).post(`${BASE}/${asha._id}/follow-up`).set(exec).send({}).expect(200);
    await sheet.flush();
    expect(sheet.writes[0].grow).toEqual([{ gid: 11, columns: Object.keys(PANEL_COLUMNS).length }]);
    expect(sheet.cell('jimny', 'l:1', PANEL_COLUMNS.followingUp)).toBe('Nevin');
  });

  test('edits in the same 10 seconds share one queue job', () => {
    const jobs = [];
    const enqueue = (o) => { jobs.push(o); return Promise.resolve(); };
    requestMetaLeadSheetWrite(1_000_000_001_000, enqueue);
    requestMetaLeadSheetWrite(1_000_000_009_000, enqueue);
    requestMetaLeadSheetWrite(1_000_000_011_000, enqueue);
    expect(jobs[0].jobId).toBe(jobs[1].jobId);
    expect(jobs[2].jobId).not.toBe(jobs[0].jobId);
    expect(jobs[0].jobId).not.toContain(':');
    expect(jobs[0].delay).toBe(9000);
  });
});

describe('google client writes', () => {
  test('RAW values (a typed formula stays text), columns grown first, A1 ranges quoted', async () => {
    resetGoogleSheetsToken();
    const crypto = await import('crypto');
    const key = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    const calls = [];
    global.fetch = jest.fn(async (url, init) => {
      calls.push({ url: String(url), body: init?.body ? String(init.body) : '' });
      if (String(url).includes('oauth2')) return { ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) };
      return { ok: true, json: async () => ({ totalUpdatedCells: 1 }) };
    });
    await writeCells('abc', { grow: [{ gid: 5, columns: 3 }], data: [{ range: "'Thar''s'!J2", values: [['=IMPORTXML("x")']] }] }, { email: 'r@x', key });
    expect(calls[1].url).toMatch(/abc:batchUpdate$/);
    expect(JSON.parse(calls[1].body).requests[0].appendDimension).toEqual({ sheetId: 5, dimension: 'COLUMNS', length: 3 });
    const write = JSON.parse(calls[2].body);
    expect(write.valueInputOption).toBe('RAW');
    expect(new URLSearchParams(calls[0].body).get('assertion').split('.')[1]).toBeTruthy();
    expect(JSON.parse(Buffer.from(new URLSearchParams(calls[0].body).get('assertion').split('.')[1], 'base64url')).scope).toBe('https://www.googleapis.com/auth/spreadsheets');
    expect(a1Column(0)).toBe('A');
    expect(a1Column(26)).toBe('AA');
  });

  test('a permission refusal carries its status for the page', async () => {
    resetGoogleSheetsToken();
    const crypto = await import('crypto');
    const key = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    global.fetch = jest.fn(async (url) => (String(url).includes('oauth2')
      ? { ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) }
      : { ok: false, status: 403, json: async () => ({ secret: 'x' }) }));
    await expect(writeCells('abc', { data: [{ range: "'a'!A1", values: [['x']] }] }, { email: 'r@x', key })).rejects.toMatchObject({ status: 403, message: 'Google sheet write failed (HTTP 403)' });
  });
});

export { repo };

/**
 * The supplier directory (and the payment form's picker): search, filters, sort
 * and pages (supplierService.list → utils/listQuery.js).
 *
 * What must hold:
 *   - a supplier is found by any word of its name (not only the start), contact,
 *     phone, email, GSTIN, address, notes, UPI ID, account name, the last four
 *     account digits, IFSC or bank — every typed word must match; never by the
 *     full (encrypted) account number
 *   - Active by default; Inactive; All. "Paid by" bank / UPI. "Bank details
 *     changed recently" = the last BANK_CHANGE_WARN_DAYS days
 *   - pages never repeat or skip a supplier under any sort, with filters on
 *   - only procurement, accounts and the admin
 */
import mongoose from 'mongoose';
import { jest } from '@jest/globals';

const mockQueue = { add: () => Promise.resolve({}) };
jest.unstable_mockModule('../queue/queues.js', () => ({
  getNotificationsQueue: () => mockQueue, getOrderQueue: () => mockQueue, getMediaQueue: () => mockQueue,
  getSearchSyncQueue: () => mockQueue, variantJobId: (...a) => a.join(':'), enqueueVariantGeneration: () => Promise.resolve(),
  enqueueNotification: () => {}, closeQueues: () => Promise.resolve(),
}));

const dbHandler = await import('./db-handler.js');
const { default: Supplier } = await import('../models/Supplier.js');
const svc = await import('../services/supplierService.js');
const { sortSpec } = await import('../utils/listQuery.js');

const oid = () => new mongoose.Types.ObjectId();
const admin = { _id: oid(), role: 'admin' };
const accounts = { _id: oid(), role: 'staff', staff: { active: true, team: 'accounts' } };
const procurement = { _id: oid(), role: 'staff', staff: { active: true, team: 'procurement' } };
const marketing = { _id: oid(), role: 'staff', staff: { active: true, team: 'marketing' } };

const DAY = 86400000;
let seq = 0;
function doc(name, over = {}) {
  seq += 1;
  const { payment, ...rest } = over;
  return {
    _id: oid(), name, nameKey: name.toLowerCase(), contactPerson: '', phone: '', email: '', gstin: '', address: '', notes: '',
    payment: { method: 'bank', upiId: '', accountName: name, accountNumber: 'enc:ciphertext', accountLast4: '0000', ifsc: 'HDFC0000001', bankName: 'HDFC Bank', ...payment },
    active: true, bankChangedAt: null, bankChangedByName: '',
    createdAt: new Date(Date.UTC(2026, 0, 1) + seq * DAY), updatedAt: new Date(Date.UTC(2026, 5, 1) - seq * DAY), ...rest,
  };
}
const seed = (...docs) => Supplier.collection.insertMany(docs);
const names = (res) => res.suppliers.map((s) => s.name);

async function all(actor, params) {
  const out = [];
  let after = '';
  for (let i = 0; i < 50; i += 1) {
    const res = await svc.list(actor, { ...params, ...(after ? { after } : {}) });
    out.push(...res.suppliers);
    if (!res.nextAfter) return out;
    after = res.nextAfter;
  }
  throw new Error('did not end');
}

beforeAll(async () => { await dbHandler.connect(); });
afterAll(async () => { await dbHandler.closeDatabase(); });
afterEach(async () => { await Supplier.deleteMany({}); seq = 0; });

describe('search', () => {
  beforeEach(() => seed(
    doc('Robert Bosch Ltd', { contactPerson: 'Joseph Mathew', phone: '9847001122', gstin: '32AABCB1234C1Z5', address: 'MG Road, Kochi', payment: { accountLast4: '9012', ifsc: 'ICIC0000999', bankName: 'ICICI Bank' } }),
    doc('Profender India', { email: 'sales@profender.in', notes: 'Pays GST late', payment: { method: 'upi', upiId: 'profender@okaxis', accountName: '', accountLast4: '', ifsc: '', bankName: '' } }),
    doc('3M Car Care'),
  ));

  it.each([
    ['a later word of the name', 'bosch', ['Robert Bosch Ltd']],
    ['the start of the name, any case', 'PRO', ['Profender India']],
    ['contact person', 'mathew', ['Robert Bosch Ltd']],
    ['phone', '9847001122', ['Robert Bosch Ltd']],
    ['email', 'profender.in', ['Profender India']],
    ['GSTIN', '32aabcb', ['Robert Bosch Ltd']],
    ['address', 'kochi', ['Robert Bosch Ltd']],
    ['notes', 'gst late', ['Profender India']],
    ['UPI ID', 'okaxis', ['Profender India']],
    ['last four account digits', '9012', ['Robert Bosch Ltd']],
    ['IFSC', 'icic0000999', ['Robert Bosch Ltd']],
    ['bank', 'hdfc', ['3M Car Care']],
  ])('%s', async (_, q, expected) => {
    expect(names(await svc.list(procurement, { q }))).toEqual(expected);
  });

  it('the picker\'s prefix: the name starts with it (any case), nothing else', async () => {
    expect(names(await svc.list(procurement, { prefix: 'ROB' }))).toEqual(['Robert Bosch Ltd']);
    expect(names(await svc.list(procurement, { prefix: 'bosch' }))).toEqual([]);
    expect(names(await svc.list(procurement, { prefix: '3m car' }))).toEqual(['3M Car Care']);
  });

  it('every word must match; a miss is empty with a zero count', async () => {
    expect(names(await svc.list(procurement, { q: 'bosch kochi' }))).toEqual(['Robert Bosch Ltd']);
    expect(await svc.list(procurement, { q: 'bosch mumbai' })).toMatchObject({ suppliers: [], summary: { count: 0, capped: false } });
  });

  it('never by the stored (encrypted) account number; regex characters are plain text', async () => {
    expect(names(await svc.list(procurement, { q: 'ciphertext' }))).toEqual([]);
    expect(names(await svc.list(procurement, { q: '.*' }))).toEqual([]);
  });
});

describe('filters', () => {
  beforeEach(() => seed(
    doc('Alpha Tyres'),
    doc('Beta Lights', { payment: { method: 'upi', upiId: 'beta@ybl' } }),
    doc('Gamma Wipers', { active: false }),
    doc('Delta Mats', { bankChangedAt: new Date(Date.now() - 3 * DAY) }),
    doc('Epsilon Horns', { bankChangedAt: new Date(Date.now() - 60 * DAY) }),
  ));

  it('active by default; inactive; all; a crafted ?status[$ne]= is ignored', async () => {
    expect(names(await svc.list(accounts, {}))).toEqual(['Alpha Tyres', 'Beta Lights', 'Delta Mats', 'Epsilon Horns']);
    expect(names(await svc.list(accounts, { status: 'inactive' }))).toEqual(['Gamma Wipers']);
    expect((await svc.list(accounts, { status: 'all' })).suppliers).toHaveLength(5);
    expect((await svc.list(accounts, { status: { $ne: 'x' } })).suppliers).toHaveLength(4);
  });

  it('paid by bank or UPI', async () => {
    expect(names(await svc.list(accounts, { method: 'upi' }))).toEqual(['Beta Lights']);
    expect((await svc.list(accounts, { method: 'bank' })).suppliers).toHaveLength(3);
  });

  it('bank details changed recently: the last 30 days only', async () => {
    expect(names(await svc.list(accounts, { changed: 'recent' }))).toEqual(['Delta Mats']);
  });
});

describe('sort and pages', () => {
  beforeEach(() => seed(...Array.from({ length: 120 }, (_, i) => doc(`Supplier ${String(i).padStart(3, '0')}`, {
    active: i % 10 !== 0,
    payment: i % 3 === 0 ? { method: 'upi', upiId: `s${i}@ybl` } : {},
  }))));

  it.each([
    ['name', (rows) => rows.map((r) => r.name), (a, b) => a.localeCompare(b)],
    ['newest', (rows) => rows.map((r) => r.name), (a, b) => b.localeCompare(a)], // created in name order
    ['updated', (rows) => rows.map((r) => r.updatedAt), (a, b) => new Date(b) - new Date(a)],
  ])('%s: every active supplier exactly once, in order', async (sort, pick, cmp) => {
    const rows = await all(procurement, { sort });
    expect(rows).toHaveLength(108);
    expect(new Set(rows.map((r) => r.id)).size).toBe(108);
    expect(pick(rows)).toEqual([...pick(rows)].sort(cmp));
  });

  it('with a filter on, across pages: only matches, none repeated', async () => {
    const rows = await all(procurement, { method: 'upi', status: 'all', sort: 'newest' });
    expect(rows).toHaveLength(40);
    expect(rows.every((r) => r.payment.method === 'upi')).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(40);
  });

  it('50 a page; the count comes with the first page only; an old name cursor or junk starts over', async () => {
    const first = await svc.list(procurement, {});
    expect(first.suppliers).toHaveLength(50);
    expect(first.summary).toEqual({ count: 108, capped: false });
    const second = await svc.list(procurement, { after: first.nextAfter });
    expect(names(second)[0]).toBe('Supplier 056');
    expect(second.summary).toBeUndefined();
    expect(names(await svc.list(procurement, { after: 'supplier 050' }))[0]).toBe('Supplier 001');
    expect(names(await svc.list(procurement, { after: 'garbage' }))[0]).toBe('Supplier 001');
  });

  it('an unknown sort is by name', async () => {
    expect((await svc.list(procurement, { sort: 'random' })).sort).toBe('name');
  });
});

describe('the name order rides the index', () => {
  // Measured on 20,000 suppliers: with an _id tie-breaker the planner read all
  // 18,000 active suppliers and sorted them in memory (15 ms; the picker's
  // as-you-type search 59 ms); on the index it reads one page (1 ms).
  beforeEach(async () => {
    await Supplier.syncIndexes();
    await seed(...Array.from({ length: 300 }, (_, i) => doc(`Supplier ${String(i).padStart(3, '0')}`, { active: i % 10 !== 0 })));
  });

  it.each([
    ['active, by name', {}, 'supplier_active_name'],
    ['all, by name', { status: 'all' }, 'supplier_name'],
    ['the picker typing (name starts with)', { prefix: 'Supplier 01' }, 'supplier_active_name'],
  ])('%s', async (_, f, index) => {
    const explain = await Supplier.find(svc.supplierQuery(f)).sort(sortSpec(svc.SUPPLIER_SORTS.name)).limit(51).explain('queryPlanner');
    const plan = JSON.stringify(explain.queryPlanner.winningPlan);
    expect(plan).not.toContain('"stage":"SORT"');
    expect(plan).not.toContain('COLLSCAN');
    expect(plan).toContain(index);
  });

});

describe('who', () => {
  it('procurement, accounts and the admin; other teams are refused', async () => {
    for (const who of [procurement, accounts, admin]) expect((await svc.list(who, {})).suppliers).toEqual([]);
    await expect(svc.list(marketing, {})).rejects.toMatchObject({ statusCode: 403 });
  });
});

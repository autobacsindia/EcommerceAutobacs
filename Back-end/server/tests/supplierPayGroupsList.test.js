/**
 * "Supplier payments — by supplier" (paymentRequestService.supplierPayGroups):
 * search, the "Paid to" filter and the sorts.
 *
 * What must hold:
 *   - a group is found by its supplier name, UPI ID, bank, IFSC, the last digits
 *     of the account, or one of its payments' PR number / order number /
 *     customer / amount — and every typed word must match
 *   - a found group is the WHOLE group: its count and total are still what is to
 *     pay (paying from a search must not leave half a supplier behind unseen)
 *   - only admin and accounts; unapproved payments are never in it
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
const { default: PaymentRequest } = await import('../models/PaymentRequest.js');
const pr = await import('../services/paymentRequestService.js');

const oid = () => new mongoose.Types.ObjectId();
const admin = { _id: oid(), role: 'admin' };
const accounts = { _id: oid(), role: 'staff', staff: { active: true, team: 'accounts' } };
const procurement = { _id: oid(), role: 'staff', staff: { active: true, team: 'procurement' } };

const BOSCH = { name: 'Bosch Distributor', method: 'bank', accountName: 'Bosch', accountNumber: '001234567890', ifsc: 'HDFC0001234', bankName: 'HDFC Bank' };
const PROFENDER = { name: 'Profender India', method: 'upi', upiId: 'profender@okicici' };
const THREE_M = { name: '3M Car Care', method: 'bank', accountName: '3M', accountNumber: '998877665544', ifsc: 'ICIC0000999', bankName: 'ICICI Bank' };

let seq = 0;
function doc(payee, over = {}) {
  seq += 1;
  return {
    _id: oid(), number: `PR-${String(seq).padStart(4, '0')}`, kind: 'supplier', status: 'approved', team: 'procurement',
    requestedBy: procurement._id, requestedByName: 'Priya', amount: 1000, category: 'supplier', description: '',
    payee, orderNumber: `ORD${seq}`, itemNames: ['Wiper'], customer: { name: 'Anil Thomas', phone: '', city: 'Kochi' },
    files: [], history: [], payment: { reference: '' },
    createdAt: new Date(Date.UTC(2026, 9, 1) + seq * 3600e3), updatedAt: new Date(), ...over,
  };
}
const names = (res) => res.groups.map((g) => g.name);

beforeAll(async () => { await dbHandler.connect(); });
afterAll(async () => { await dbHandler.closeDatabase(); });
beforeEach(async () => {
  seq = 0;
  await PaymentRequest.collection.insertMany([
    doc(BOSCH, { amount: 5000 }), // oldest
    doc(PROFENDER, { amount: 1500, customer: { name: 'Kavya Rao', phone: '', city: 'Mysuru' } }),
    doc(BOSCH, { amount: 2500, status: 'on_hold' }),
    doc(THREE_M, { amount: 900 }),
    doc(THREE_M, { amount: 800 }),
    doc(THREE_M, { amount: 700 }),
    doc(PROFENDER, { amount: 99999, status: 'submitted' }), // not approved: never in the queue
  ]);
});
afterEach(async () => { await PaymentRequest.deleteMany({}); });

describe('search', () => {
  it.each([
    ['supplier name, any case', 'bosch', ['Bosch Distributor']],
    ['UPI ID', 'profender@ok', ['Profender India']],
    ['bank name', 'icici bank', ['3M Car Care']],
    ['IFSC', 'hdfc0001234', ['Bosch Distributor']],
    ['last digits of the account', '5544', ['3M Car Care']],
    ['a PR number inside the group', 'PR-0003', ['Bosch Distributor']],
    ['an order number inside the group', 'ord5', ['3M Car Care']],
    ['a customer inside the group', 'kavya', ['Profender India']],
    ['one payment\'s amount', '₹2,500', ['Bosch Distributor']],
    ['the group total', '2400', ['3M Car Care']],
  ])('%s', async (_, q, expected) => {
    expect(names(await pr.supplierPayGroups(admin, { q }))).toEqual(expected);
  });

  it('every word must match; a miss is empty with a zero summary', async () => {
    expect(names(await pr.supplierPayGroups(admin, { q: 'bosch hdfc' }))).toEqual(['Bosch Distributor']);
    expect(names(await pr.supplierPayGroups(admin, { q: 'bosch icici' }))).toEqual([]);
    expect((await pr.supplierPayGroups(admin, { q: 'nobody' })).summary).toEqual({ count: 0, total: 0, capped: false });
  });

  it('a found group is the whole group — its count and total are what is to pay', async () => {
    const [bosch] = (await pr.supplierPayGroups(admin, { q: 'PR-0001' })).groups;
    expect(bosch).toMatchObject({ count: 2, total: 7500, onHold: 1 });
  });

  it('an unapproved payment is never found', async () => {
    expect(names(await pr.supplierPayGroups(admin, { q: '99999' }))).toEqual([]);
  });

  it('regex characters are plain text; a crafted ?q[$ne]= is ignored', async () => {
    expect(names(await pr.supplierPayGroups(admin, { q: '.*' }))).toEqual([]);
    expect((await pr.supplierPayGroups(admin, { q: { $ne: '' } })).groups).toHaveLength(3);
  });
});

describe('filter and sort', () => {
  it('"Paid to" bank or UPI; anything else is everything', async () => {
    expect(names(await pr.supplierPayGroups(admin, { method: 'upi' }))).toEqual(['Profender India']);
    expect(names(await pr.supplierPayGroups(admin, { method: 'bank' }))).toEqual(['Bosch Distributor', '3M Car Care']);
    expect((await pr.supplierPayGroups(admin, { method: 'cash' })).groups).toHaveLength(3);
  });

  it.each([
    ['oldest', ['Bosch Distributor', 'Profender India', '3M Car Care']],
    ['total_desc', ['Bosch Distributor', '3M Car Care', 'Profender India']],
    ['count_desc', ['3M Car Care', 'Bosch Distributor', 'Profender India']],
    ['name', ['3M Car Care', 'Bosch Distributor', 'Profender India']],
    ['random', ['Bosch Distributor', 'Profender India', '3M Car Care']],
  ])('%s', async (sort, expected) => {
    const res = await pr.supplierPayGroups(admin, { sort });
    expect(names(res)).toEqual(expected);
    expect(res.sort).toBe(sort === 'random' ? 'oldest' : sort);
  });

  it('the summary counts and totals what is shown', async () => {
    expect((await pr.supplierPayGroups(accounts, {})).summary).toEqual({ count: 3, total: 11400, capped: false });
    expect((await pr.supplierPayGroups(accounts, { method: 'bank' })).summary).toEqual({ count: 2, total: 9900, capped: false });
  });

  it('only admin and accounts', async () => {
    await expect(pr.supplierPayGroups(procurement, {})).rejects.toMatchObject({ statusCode: 403 });
  });
});

/**
 * Admin affiliate payouts list and payout queue: search, filters, sort and pages.
 *   - affiliatePayoutService.listAdmin (→ utils/listQuery.js)
 *   - affiliateCommissionRepository.payableQueue (search / sort on the worklist)
 *
 * What must hold:
 *   - a payout is found by its affiliate's name / code / email, the UTR, the bank
 *     snapshot, or the amount sent; every word must match
 *   - status, affiliate and the day the batch was made narrow it
 *   - pages never repeat or skip a payout — even several made in the same millisecond
 *     (one batch) — under any sort, with filters on
 *   - the payout queue's search and sort never change what is owed: its totals are
 *     always every due affiliate, and a match is never cut off by the limit
 */
import mongoose from 'mongoose';

const dbHandler = await import('./db-handler.js');
const { default: Affiliate } = await import('../models/Affiliate.js');
const { default: AffiliatePayout } = await import('../models/AffiliatePayout.js');
const { default: AffiliateCommission } = await import('../models/AffiliateCommission.js');
const { default: affiliatePayoutService } = await import('../services/affiliatePayoutService.js');
const { default: affiliateCommissionRepository } = await import('../repositories/affiliateCommissionRepository.js');
const { COMMISSION_STATUS, COMMISSION_TYPE } = await import('../config/affiliate.js');

const oid = () => new mongoose.Types.ObjectId();
const ist = (s) => new Date(`${s}+05:30`);

const RAHUL = { _id: oid(), code: 'RAHUL10', name: 'Rahul Nair', email: 'rahul@example.com', status: 'active', commissionPercent: 10 };
const PRIYA = { _id: oid(), code: 'PRIYA5', name: 'Priya Menon', email: 'priya@example.com', status: 'active', commissionPercent: 10 };
const SUSPENDED = { _id: oid(), code: 'GONE1', name: 'Gone Away', email: 'gone@example.com', status: 'suspended', commissionPercent: 10 };

function payout(aff, netRupees, createdAt, over = {}) {
  return {
    _id: oid(), affiliate: aff._id, status: 'paid', grossPaise: netRupees * 100, tdsPercent: 0, tdsPaise: 0,
    netPaise: netRupees * 100, commissionCount: 1, bankSnapshot: { accountHolderName: aff.name, accountLast4: '9012', ifsc: 'HDFC0001234' },
    reference: '', createdAt, updatedAt: createdAt, ...over,
  };
}
const nets = (res) => res.payouts.map((p) => p.netPaise / 100);

beforeAll(async () => { await dbHandler.connect(); });
afterAll(async () => { await dbHandler.closeDatabase(); });
// tests/setup.js empties every collection after each test.
beforeEach(() => Affiliate.collection.insertMany([{ ...RAHUL }, { ...PRIYA }, { ...SUSPENDED }]));

describe('payouts list', () => {
  beforeEach(() => AffiliatePayout.collection.insertMany([
    payout(RAHUL, 1500, ist('2026-09-01T10:00:00'), { reference: 'UTR778899' }),
    payout(PRIYA, 2500, ist('2026-09-15T10:00:00'), { status: 'draft' }),
    payout(RAHUL, 900, ist('2026-10-01T10:00:00'), { status: 'failed', bankSnapshot: { upiId: 'rahul@okaxis' } }),
  ]));

  it.each([
    ["the affiliate's name", 'priya', [2500]],
    ["the affiliate's code", 'rahul10', [900, 1500]],
    ['the UTR', 'utr7788', [1500]],
    ['a UPI ID', 'okaxis', [900]],
    ['the amount sent', '₹1,500', [1500]],
    ['two words', 'rahul 900', [900]],
  ])('search by %s', async (_, q, expected) => {
    expect(nets(await affiliatePayoutService.listAdmin({ q }))).toEqual(expected);
  });

  it('a miss is empty with a zero summary; regex is plain text; a crafted ?q[$ne]= is ignored', async () => {
    expect(await affiliatePayoutService.listAdmin({ q: 'nobody' })).toMatchObject({ payouts: [], summary: { count: 0, total: 0 } });
    expect(nets(await affiliatePayoutService.listAdmin({ q: '.*' }))).toEqual([]);
    expect((await affiliatePayoutService.listAdmin({ q: { $ne: '' } })).payouts).toHaveLength(3);
  });

  it('status, affiliate and the day it was made narrow it; unknown values are ignored', async () => {
    expect(nets(await affiliatePayoutService.listAdmin({ status: 'draft' }))).toEqual([2500]);
    expect((await affiliatePayoutService.listAdmin({ status: 'lost' })).payouts).toHaveLength(3);
    expect(nets(await affiliatePayoutService.listAdmin({ affiliate: String(RAHUL._id) }))).toEqual([900, 1500]);
    expect(nets(await affiliatePayoutService.listAdmin({ from: '2026-09-01', to: '2026-09-15' }))).toEqual([2500, 1500]);
  });

  it('sorts; the summary counts and totals what matches (paise)', async () => {
    expect(nets(await affiliatePayoutService.listAdmin({ sort: 'amount_desc' }))).toEqual([2500, 1500, 900]);
    expect(nets(await affiliatePayoutService.listAdmin({ sort: 'oldest' }))).toEqual([1500, 2500, 900]);
    expect((await affiliatePayoutService.listAdmin({ affiliate: String(RAHUL._id) })).summary)
      .toEqual({ count: 2, total: 240000, capped: false });
  });
});

describe('payouts list pages', () => {
  it('several payouts made in the same millisecond are each listed once, under every sort', async () => {
    const batch = ist('2026-09-20T10:00:00');
    await AffiliatePayout.collection.insertMany(Array.from({ length: 23 }, (_, i) => payout(i % 2 ? RAHUL : PRIYA, 100 + (i % 4), batch)));
    for (const sort of ['newest', 'oldest', 'amount_desc', 'amount_asc']) {
      const seen = [];
      let cursor = '';
      for (let i = 0; i < 10; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- pages are sequential by nature
        const res = await affiliatePayoutService.listAdmin({ sort, limit: '5', q: 'example.com', ...(cursor ? { cursor } : {}) });
        seen.push(...res.payouts);
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      expect(new Set(seen.map((p) => String(p._id))).size).toBe(23);
      expect(seen).toHaveLength(23);
    }
  });
});

describe('payout queue search and sort', () => {
  const row = (aff, rupees, approvedAt) => ({
    _id: oid(), affiliate: aff._id, order: oid(), type: COMMISSION_TYPE.ACCRUAL, amountPaise: rupees * 100,
    basePaise: rupees * 1000, percent: 10, status: COMMISSION_STATUS.APPROVED, approvedAt, payout: null,
    createdAt: approvedAt, updatedAt: approvedAt,
  });
  beforeEach(async () => {
    await AffiliateCommission.collection.insertMany([
      row(RAHUL, 3000, ist('2026-08-01T10:00:00')),
      row(PRIYA, 5000, ist('2026-09-01T10:00:00')),
      row(SUSPENDED, 9000, ist('2026-07-01T10:00:00')),
    ]);
    await Affiliate.collection.updateOne({ _id: RAHUL._id }, { $set: { payoutRequestedAt: new Date() } });
  });
  const names = (res) => res.rows.map((r) => r.affiliate.name);

  it('priority (asked first), largest balance, or longest waiting', async () => {
    expect(names(await affiliateCommissionRepository.payableQueue({ minPaise: 0 }))).toEqual(['Rahul Nair', 'Priya Menon']);
    expect(names(await affiliateCommissionRepository.payableQueue({ minPaise: 0, sort: 'amount_desc' }))).toEqual(['Priya Menon', 'Rahul Nair']);
    expect(names(await affiliateCommissionRepository.payableQueue({ minPaise: 0, sort: 'oldest' }))).toEqual(['Rahul Nair', 'Priya Menon']);
  });

  it('search narrows the worklist before the limit; the totals stay every due affiliate', async () => {
    const res = await affiliateCommissionRepository.payableQueue({ minPaise: 0, limit: 1, search: /priya/i });
    expect(names(res)).toEqual(['Priya Menon']);
    expect(res).toMatchObject({ found: 1, dueCount: 2, totalPayablePaise: 800000, suspendedHeld: { count: 1, heldPaise: 900000 } });
  });

  it('a suspended affiliate is never found in the worklist', async () => {
    const res = await affiliateCommissionRepository.payableQueue({ minPaise: 0, search: /gone/i });
    expect(res).toMatchObject({ rows: [], found: 0 });
  });
});

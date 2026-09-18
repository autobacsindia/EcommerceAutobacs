import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as db from '../../db-handler.js';
import AffiliateCommission from '../../../models/AffiliateCommission.js';
import Order from '../../../models/Order.js';
import affiliateCommissionService from '../../../services/affiliateCommissionService.js';
import affiliateCommissionRepository from '../../../repositories/affiliateCommissionRepository.js';
import { COMMISSION_STATUS, COMMISSION_TYPE } from '../../../config/affiliate.js';

/**
 * Reinstating a commission clawback when an offline refund record is withdrawn.
 *
 * Against a real database because the whole point is the LEDGER ARITHMETIC: the balance
 * is an aggregation over append-only rows, and the clamp that keeps a reinstate from
 * over-paying is computed from that aggregation. A mocked repository proves none of it.
 *
 * The invariant: clawback → reinstate must return the order's net commission to exactly
 * what it was, and no sequence of repeats may push it ABOVE the original accrual.
 */

jest.setTimeout(120000);

beforeAll(async () => { await db.connect(); });
afterAll(async () => { await db.closeDatabase(); });

const ORDER_GOODS = 10000;        // ₹10,000 of goods
const COMMISSION_PERCENT = 10;
const ACCRUAL_PAISE = 100000;     // 10% of ₹10,000, in paise

let orderId;
let affiliateId;

beforeEach(async () => {
  affiliateId = new mongoose.Types.ObjectId();
  const order = await Order.create({
    user: new mongoose.Types.ObjectId(),
    items: [{
      product: new mongoose.Types.ObjectId(),
      name: 'Alloy Wheel', quantity: 1, price: ORDER_GOODS,
    }],
    totalAmount: ORDER_GOODS,
    subtotal: ORDER_GOODS,
    tax: 0,
    shippingCost: 0,
    discount: 0,
    status: 'processing',
    paymentStatus: 'paid',
    shippingAddress: {
      fullName: 'Test Buyer', phone: '9999999999', addressLine1: '1 Road',
      city: 'Kochi', state: 'Kerala', postalCode: '682001', country: 'India',
    },
  });
  orderId = order._id;

  await AffiliateCommission.create({
    affiliate: affiliateId,
    order: orderId,
    user: order.user,
    type: COMMISSION_TYPE.ACCRUAL,
    amountPaise: ACCRUAL_PAISE,
    basePaise: ORDER_GOODS * 100,
    percent: COMMISSION_PERCENT,
    status: COMMISSION_STATUS.APPROVED,
  });
});

const net = () => affiliateCommissionRepository.netPaiseForOrder(orderId);

describe('affiliateCommissionService.reinstateForAmount', () => {
  it('returns the ledger to exactly where a clawback found it', async () => {
    expect(await net()).toBe(ACCRUAL_PAISE);

    const clawback = await affiliateCommissionService.clawbackForAmount(
      orderId, ORDER_GOODS * 100, 'order_line_cancelled',
    );
    expect(clawback.status).toBe('clawed_back');
    expect(await net()).toBe(0);

    const result = await affiliateCommissionService.reinstateForAmount(
      orderId, clawback.amountPaise, 'refund_reverted',
    );

    expect(result.status).toBe('reinstated');
    expect(result.amountPaise).toBe(clawback.amountPaise);
    expect(await net()).toBe(ACCRUAL_PAISE);
  });

  it('writes a compensating row rather than editing the clawback', async () => {
    // The clawback row may already have been netted off a payout batch. Rewriting it
    // would break reconciliation against the bank statement — the same reason
    // _writeClawback never rewrites a `paid` row.
    const clawback = await affiliateCommissionService.clawbackForAmount(
      orderId, ORDER_GOODS * 100, 'order_line_cancelled',
    );
    await affiliateCommissionService.reinstateForAmount(orderId, clawback.amountPaise);

    const rows = await AffiliateCommission.find({ order: orderId }).sort({ createdAt: 1 }).lean();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.type)).toEqual([
      COMMISSION_TYPE.ACCRUAL, COMMISSION_TYPE.CLAWBACK, COMMISSION_TYPE.ADJUST,
    ]);
    // The negative row stands untouched.
    expect(rows[1].amountPaise).toBe(-ACCRUAL_PAISE);
    expect(rows[2].amountPaise).toBe(ACCRUAL_PAISE);
    // Immediately claimable by the next payout batch, like the clawback row it answers.
    expect(rows[2].status).toBe(COMMISSION_STATUS.APPROVED);
  });

  it('lifts the accrual back out of `reversed`', async () => {
    await affiliateCommissionService.clawbackForAmount(orderId, ORDER_GOODS * 100, 'x');
    let accrual = await affiliateCommissionRepository.findAccrual(orderId);
    expect(accrual.status).toBe(COMMISSION_STATUS.REVERSED);

    await affiliateCommissionService.reinstateForAmount(orderId, ACCRUAL_PAISE);
    accrual = await affiliateCommissionRepository.findAccrual(orderId);
    // Money stands against the order again, so `reversed` is no longer true.
    expect(accrual.status).toBe(COMMISSION_STATUS.APPROVED);
  });

  it('is idempotent under SEQUENTIAL retry — the way a best-effort caller repeats', async () => {
    const clawback = await affiliateCommissionService.clawbackForAmount(
      orderId, ORDER_GOODS * 100, 'x',
    );

    for (let attempt = 0; attempt < 4; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- the point is that these are serial
      await affiliateCommissionService.reinstateForAmount(orderId, clawback.amountPaise);
    }

    expect(await net()).toBe(ACCRUAL_PAISE);
  });

  it('is NOT concurrency-safe on its own — pinning why the upstream claim is required', async () => {
    /*
      Documents a real limitation rather than asserting a guarantee that does not exist.
      The clamp reads the aggregate balance and then writes a row, so simultaneous calls
      all read the same figure and all write — ₹1,000 clawed back, reinstated four times
      at once, yields ₹3,000 of surplus commission.

      This is safe in production ONLY because every caller is serialized upstream by an
      atomic one-winner claim (claimRefundRevert / claimCancellationRefundRevert), so two
      reverts of one refund record can never both reach it. If that ever stops being
      true, this test is the thing that should start failing — it exists so the
      assumption is written down and checked, not remembered.
    */
    const clawback = await affiliateCommissionService.clawbackForAmount(
      orderId, ORDER_GOODS * 100, 'x',
    );

    await Promise.all(Array.from({ length: 4 }, () =>
      affiliateCommissionService.reinstateForAmount(orderId, clawback.amountPaise)));

    expect(await net()).toBeGreaterThan(ACCRUAL_PAISE);
  });

  it('no-ops when nothing was clawed back', async () => {
    const result = await affiliateCommissionService.reinstateForAmount(orderId, ACCRUAL_PAISE);
    expect(result.status).toBe('noop');
    expect(result.reason).toBe('nothing_missing');
    expect(await net()).toBe(ACCRUAL_PAISE);
  });

  it('no-ops on a zero amount and on an order with no commission', async () => {
    expect((await affiliateCommissionService.reinstateForAmount(orderId, 0)).status).toBe('noop');
    const orphan = new mongoose.Types.ObjectId();
    expect((await affiliateCommissionService.reinstateForAmount(orphan, 5000)).status).toBe('noop');
  });

  it('restores a PARTIAL clawback exactly, leaving the rest clawed back', async () => {
    // Half the goods came back, then that refund record was withdrawn.
    const clawback = await affiliateCommissionService.clawbackForAmount(
      orderId, (ORDER_GOODS * 100) / 2, 'order_line_cancelled',
    );
    const afterClawback = await net();
    expect(afterClawback).toBeLessThan(ACCRUAL_PAISE);
    expect(afterClawback).toBeGreaterThan(0);

    await affiliateCommissionService.reinstateForAmount(orderId, clawback.amountPaise);
    expect(await net()).toBe(ACCRUAL_PAISE);
  });
});

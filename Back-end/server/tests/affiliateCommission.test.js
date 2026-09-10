/**
 * The commission engine — accrual, maturation, clawback.
 *
 * This is the money. The invariants asserted here are the ones whose failure is
 * SILENT: a replayed webhook that pays twice, a sweep that approves an undelivered
 * order, a partial return that claws back at the cart's blended rate instead of the
 * line's own. None of them change anything the customer sees, so none of them would
 * surface in a manual test — only in the bank balance, months later.
 */

import mongoose from 'mongoose';
import { readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import affiliateCommissionService, {
  commissionPaise,
  maturityDateFor,
} from '../services/affiliateCommissionService.js';
import affiliateCommissionRepository from '../repositories/affiliateCommissionRepository.js';
import AffiliateCommission from '../models/AffiliateCommission.js';
import Affiliate from '../models/Affiliate.js';
import Order from '../models/Order.js';
import ReturnRequest from '../models/ReturnRequest.js';
import { orderGoodsNetPaise } from '../services/refundMathService.js';
import { RETURN_WINDOW_DAYS } from '../config/returnPolicy.js';
import { COMMISSION_STATUS, COMMISSION_TYPE } from '../config/affiliate.js';
import { ensureCriticalIndexes } from '../config/db.js';

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const MODELS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'models');

/*
  The engine is gated on AFFILIATE_COMMISSION_ENABLED, off by default, matching the
  house convention for money-moving jobs. Turn it on for this suite so the gate itself
  is exercised rather than short-circuiting every assertion into a no-op.
*/
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
  const res = await ensureCriticalIndexes();
  expect(res.ok).toBe(true);
}, 180000);

afterAll(() => { delete process.env.AFFILIATE_COMMISSION_ENABLED; });

let affiliate;
beforeEach(async () => {
  affiliate = await Affiliate.create({
    code: 'RAHUL10', name: 'Rahul', email: 'rahul@example.com',
    status: 'active', commissionPercent: 10, discountPercent: 5,
  });
});

/**
 * A delivered, referred order.
 *
 * Two lines, three units of ₹1,000 → subtotal ₹3,000. Plus ₹100 shipping and a ₹500
 * order-level discount:
 *   goodsNet = subtotal 3,000 − discount 500 = ₹2,500 → commission @10% = ₹250
 *
 * Shipping is deliberately non-zero and the discount deliberately non-zero: both must
 * be absent from the base, and a fixture where they were 0 would pass either way.
 * `subtotal` MUST equal Σ(price × qty) — an inconsistent fixture makes the proration
 * ratio exceed 1 and hides the very rounding this suite is checking.
 */
const makeOrder = async (overrides = {}) => {
  const items = [
    { _id: oid(), product: oid(), quantity: 1, price: 1000, name: 'Alloy wheel', discountPaise: 0 },
    { _id: oid(), product: oid(), quantity: 2, price: 1000, name: 'Floor mat', discountPaise: 0 },
  ];
  const deliveredAt = overrides.deliveredAt ?? new Date(Date.now() - (RETURN_WINDOW_DAYS + 1) * DAY);

  return Order.create({
    user: oid(),
    items,
    shippingAddress: { fullName: 'A', addressLine1: 'x', city: 'Kochi', state: 'KL', postalCode: '682001', country: 'India', phone: '9000000000' },
    subtotal: 3000,
    shippingCost: 100,
    tax: 0,
    discount: 500,
    totalAmount: 2600,
    status: 'delivered',
    paymentStatus: 'paid',
    affiliate: {
      affiliate: affiliate._id,
      code: 'RAHUL10',
      source: 'link',
      commissionPercent: 10,
      attributedAt: new Date(),
    },
    shipments: [{
      sequence: 1,
      status: 'delivered',
      lines: items.map((i) => ({ itemId: i._id, quantity: i.quantity })),
      deliveredAt,
    }],
    ...overrides,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
describe('commissionPaise — always floor, never round up', () => {
  it.each([
    [350000, 10, 35000],
    [100, 33, 33],       // 33.0 → 33
    [101, 33, 33],       // 33.33 → 33, not 34
    [1, 50, 0],          // half a paise is zero, not one
    [350000, 0, 0],
    [0, 10, 0],
    [-500, 10, 0],       // a negative base cannot produce a negative commission
  ])('%i paise at %i%% → %i paise', (base, percent, expected) => {
    expect(commissionPaise(base, percent)).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('accrueForOrder', () => {
  it('computes off net goods — excluding shipping and the order discount', async () => {
    const order = await makeOrder();

    await affiliateCommissionService.accrueForOrder(order._id);

    const row = await affiliateCommissionRepository.findAccrual(order._id);
    // goodsNet = subtotal 3000 − discount 500 = 2500 → 10% = ₹250 = 25,000 paise.
    // Shipping (₹100) is absent: never refunded, so never commissionable.
    expect(row.basePaise).toBe(orderGoodsNetPaise(order));
    expect(row.basePaise).toBe(250000);
    expect(row.amountPaise).toBe(25000);
    expect(row.status).toBe(COMMISSION_STATUS.PENDING);
    expect(row.maturesAt).toBeNull();
  });

  /*
    ⚠️ THE invariant CI must never lose. Razorpay retries webhooks; a second accrual
    would pay the affiliate twice for one sale, and nothing anywhere would complain.
  */
  it('creates exactly ONE row when called twice for the same order', async () => {
    const order = await makeOrder();

    const first = await affiliateCommissionService.accrueForOrder(order._id);
    const second = await affiliateCommissionService.accrueForOrder(order._id);

    expect(first.status).toBe('created');
    expect(second.status).toBe('exists');
    expect(await AffiliateCommission.countDocuments({
      order: order._id, type: COMMISSION_TYPE.ACCRUAL,
    })).toBe(1);
  });

  it('creates exactly ONE row under two CONCURRENT deliveries', async () => {
    const order = await makeOrder();

    // The pre-check cannot see an uncommitted sibling insert — the partial-unique
    // index is the real serialization point, and one of these must lose on E11000.
    await Promise.all([
      affiliateCommissionService.accrueForOrder(order._id),
      affiliateCommissionService.accrueForOrder(order._id),
    ]);

    expect(await AffiliateCommission.countDocuments({
      order: order._id, type: COMMISSION_TYPE.ACCRUAL,
    })).toBe(1);
  });

  it('accrues nothing for an unreferred order', async () => {
    const order = await makeOrder({ affiliate: undefined });

    const res = await affiliateCommissionService.accrueForOrder(order._id);

    expect(res).toEqual({ status: 'skipped', reason: 'not_referred' });
    expect(await AffiliateCommission.countDocuments({})).toBe(0);
  });

  /*
    The rate is read from the ORDER, not the affiliate. Without this, raising someone's
    rate would silently reprice every order they had ever referred.
  */
  it('uses the order\'s snapshotted rate, not the affiliate\'s current one', async () => {
    const order = await makeOrder();
    affiliate.commissionPercent = 50;
    await affiliate.save();

    await affiliateCommissionService.accrueForOrder(order._id);

    const row = await affiliateCommissionRepository.findAccrual(order._id);
    expect(row.percent).toBe(10);
    expect(row.amountPaise).toBe(25000); // not 125000
  });

  it('does nothing at all when the feature flag is off', async () => {
    process.env.AFFILIATE_COMMISSION_ENABLED = 'false';
    const order = await makeOrder();

    const res = await affiliateCommissionService.accrueForOrder(order._id);

    expect(res).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(await AffiliateCommission.countDocuments({})).toBe(0);
    process.env.AFFILIATE_COMMISSION_ENABLED = 'true';
  });
});

/*
  ── THE REPEAT-RATE ORDER ────────────────────────────────────────────────────────

  A returning buyer who typed the code gets NO discount, so the order carries
  `source: 'code'`, `discount: 0`, and the affiliate's lower reactivation rate. The
  ledger reads all three off the ORDER's snapshot and never the live affiliate, which is
  what keeps this arithmetic stable when the affiliate's terms change later.

  Note the direction that surprises people: a zero discount makes the base LARGER, so a
  repeat order at 2% can out-earn a discounted first order at 10% on the same cart. That
  is correct — commission is a share of revenue — but it is worth pinning so nobody
  "fixes" it later.
*/
describe('accrueForOrder — an order that got no discount', () => {
  /** ₹3,000 of goods, no discount, credited to the typed code at the repeat rate. */
  const makeRepeatOrder = (overrides = {}) => makeOrder({
    discount: 0,
    totalAmount: 3100,
    affiliate: {
      affiliate: affiliate._id,
      code: 'RAHUL10',
      source: 'code',
      commissionPercent: 2,
      newCustomer: false,
      attributedAt: new Date(),
    },
    ...overrides,
  });

  it('commissions the full goods value at the snapshotted repeat rate', async () => {
    const order = await makeRepeatOrder();

    await affiliateCommissionService.accrueForOrder(order._id);

    const row = await affiliateCommissionRepository.findAccrual(order._id);
    // No discount, so the base is the whole ₹3,000 — 2% = ₹60 = 6,000 paise.
    expect(row.basePaise).toBe(300000);
    expect(row.percent).toBe(2);
    expect(row.amountPaise).toBe(6000);
    expect(row.source).toBe('code');
  });

  /*
    ⚠️ The rate must come off the order, not the affiliate. Raising Rahul's headline rate
    tomorrow must not silently reprice a repeat order settled today — the same reason an
    order snapshots its own prices and titles.
  */
  it('ignores a later change to the affiliate\'s live rates', async () => {
    const order = await makeRepeatOrder();

    affiliate.commissionPercent = 40;
    affiliate.repeatCommissionPercent = 30;
    await affiliate.save();

    await affiliateCommissionService.accrueForOrder(order._id);

    const row = await affiliateCommissionRepository.findAccrual(order._id);
    expect(row.percent).toBe(2);
    expect(row.amountPaise).toBe(6000);
  });

  it('still creates exactly ONE row when the webhook is replayed', async () => {
    const order = await makeRepeatOrder();

    await affiliateCommissionService.accrueForOrder(order._id);
    await affiliateCommissionService.accrueForOrder(order._id);

    expect(await AffiliateCommission.countDocuments({
      order: order._id, type: COMMISSION_TYPE.ACCRUAL,
    })).toBe(1);
  });

  /*
    Clawback measures against the same pot the accrual did, so a refunded repeat order
    recovers to the paise. A zero discount is the case most likely to break a proration
    that assumes one — hence pinning it here rather than only on the discounted fixture.
  */
  it('claws back exactly, leaving nothing outstanding', async () => {
    const order = await makeRepeatOrder();
    await affiliateCommissionService.accrueForOrder(order._id);

    await affiliateCommissionService.clawbackForOrder(order._id, 'order_refunded');

    const rows = await AffiliateCommission.find({ order: order._id });
    const net = rows.reduce((sum, r) => sum + r.amountPaise, 0);
    expect(net).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('maturityDateFor — the payable date', () => {
  it('is delivery + the return window', async () => {
    const deliveredAt = new Date('2026-09-01T00:00:00.000Z');
    const order = await makeOrder({ deliveredAt });

    expect(maturityDateFor(order).toISOString())
      .toBe(new Date(deliveredAt.getTime() + RETURN_WINDOW_DAYS * DAY).toISOString());
  });

  /*
    `max`, not `min`. On a split order the whole thing is only safe once the LAST parcel's
    window has closed — otherwise a line delivered a week later is still returnable while
    we have already paid out on it.
  */
  it('uses the LATEST parcel on a split order, not the earliest', async () => {
    const early = new Date('2026-09-01T00:00:00.000Z');
    const late = new Date('2026-09-10T00:00:00.000Z');
    const order = await makeOrder();

    order.shipments = [
      { sequence: 1, status: 'delivered', deliveredAt: early, lines: [{ itemId: order.items[0]._id, quantity: 1 }] },
      { sequence: 2, status: 'delivered', deliveredAt: late, lines: [{ itemId: order.items[1]._id, quantity: 2 }] },
    ];
    await order.save();

    expect(maturityDateFor(order).toISOString())
      .toBe(new Date(late.getTime() + RETURN_WINDOW_DAYS * DAY).toISOString());
  });

  it('is null while any line is still undelivered', async () => {
    const order = await makeOrder();
    order.shipments = [
      { sequence: 1, status: 'delivered', deliveredAt: new Date(), lines: [{ itemId: order.items[0]._id, quantity: 1 }] },
      { sequence: 2, status: 'shipped', lines: [{ itemId: order.items[1]._id, quantity: 2 }] },
    ];
    await order.save();

    expect(maturityDateFor(order)).toBeNull();
  });

  /*
    Orders that predate split shipments have no parcels at all. Without the fallback
    inside deliveredAtForItem they would look 0%-delivered forever, and every historical
    referred order would be permanently unpayable.
  */
  it('falls back to the order-level date for a legacy order with no parcels', async () => {
    const deliveredAt = new Date('2026-08-01T00:00:00.000Z');
    const order = await makeOrder();
    order.shipments = [];               // pre-split-shipment order
    order.status = 'delivered';         // the only delivery signal such an order has
    order.fulfillmentMetrics = { deliveredAt };
    await order.save();

    expect(maturityDateFor(order).toISOString())
      .toBe(new Date(deliveredAt.getTime() + RETURN_WINDOW_DAYS * DAY).toISOString());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('maturation sweep', () => {
  const seedMatured = async (maturesAt = new Date(Date.now() - 1000)) => {
    const order = await makeOrder();
    await affiliateCommissionService.accrueForOrder(order._id);
    await affiliateCommissionRepository.stampMaturity(order._id, maturesAt);
    return order;
  };

  it('approves a matured, delivered, return-free order', async () => {
    const order = await seedMatured();

    const result = await affiliateCommissionService.sweepMaturity();

    expect(result.approved).toBe(1);
    const row = await affiliateCommissionRepository.findAccrual(order._id);
    expect(row.status).toBe(COMMISSION_STATUS.APPROVED);
    expect(row.approvedAt).toBeTruthy();
  });

  it('holds a row one second before the window closes and releases it one second after', async () => {
    const deliveredAt = new Date(Date.now() - RETURN_WINDOW_DAYS * DAY);
    const order = await makeOrder({ deliveredAt });
    await affiliateCommissionService.accrueForOrder(order._id);
    await affiliateCommissionRepository.stampMaturity(order._id, maturityDateFor(order));

    const justBefore = new Date(maturityDateFor(order).getTime() - 1000);
    expect((await affiliateCommissionService.sweepMaturity(justBefore)).approved).toBe(0);

    const justAfter = new Date(maturityDateFor(order).getTime() + 1000);
    expect((await affiliateCommissionService.sweepMaturity(justAfter)).approved).toBe(1);
  });

  /*
    ⚠️ THE BSON null-ordering trap. `null` sorts BELOW Date, so a query missing the
    `$ne: null` limb matches every un-stamped row — i.e. every order that was paid but
    never delivered. The sweep would then approve commissions on orders that never
    shipped, at 4am, silently.
  */
  it('NEVER approves an order that was paid but never delivered', async () => {
    const order = await makeOrder({ shipments: [], status: 'processing' });
    await affiliateCommissionService.accrueForOrder(order._id);
    // maturesAt is null — nothing ever stamped it.

    const result = await affiliateCommissionService.sweepMaturity();

    expect(result.approved).toBe(0);
    expect((await affiliateCommissionRepository.findAccrual(order._id)).status)
      .toBe(COMMISSION_STATUS.PENDING);
  });

  /*
    The goods may be coming back. Paying out first turns a refund into a debt we then
    have to chase — so a raised return freezes maturation regardless of the clock.
  */
  it('refuses to approve while a return is in flight, then approves once it is rejected', async () => {
    const order = await seedMatured();
    const rr = await ReturnRequest.create({
      order: order._id,
      user: order.user,
      items: [{ product: order.items[0].product, quantity: 1, unitPrice: 1000, reason: 'transit_damage' }],
      problemDescription: 'Arrived with a cracked rim.',
      status: 'pending',
    });

    expect((await affiliateCommissionService.sweepMaturity()).approved).toBe(0);

    // Rejected: the goods never came back, so the sale stands and the commission is owed.
    rr.status = 'rejected';
    await rr.save();

    expect((await affiliateCommissionService.sweepMaturity()).approved).toBe(1);
  });

  it('does not resurrect a row a clawback already reversed', async () => {
    const order = await seedMatured();
    await AffiliateCommission.updateOne(
      { order: order._id, type: COMMISSION_TYPE.ACCRUAL },
      { $set: { status: COMMISSION_STATUS.REVERSED } }
    );

    expect((await affiliateCommissionService.sweepMaturity()).approved).toBe(0);
    expect((await affiliateCommissionRepository.findAccrual(order._id)).status)
      .toBe(COMMISSION_STATUS.REVERSED);
  });

  /*
    ⚠️ STARVATION. The candidate query is ordered by `maturesAt` ascending and a skipped
    row is not consumed, so an order with an in-flight return keeps its place at the head
    for ever. With a flat `limit`, enough stuck rows fill the whole batch and NOTHING
    matures again — the only symptom being a number that quietly stops moving.
  */
  it('matures rows sitting behind a batch-filling block of stuck ones', async () => {
    const LIMIT = 3;

    // LIMIT stuck rows, all older than the good one, each frozen by a live return.
    for (let i = 0; i < LIMIT; i += 1) {
      const stuck = await seedMatured(new Date(Date.now() - (10 - i) * 60_000));
      await ReturnRequest.create({
        order: stuck._id,
        user: stuck.user,
        items: [{ product: stuck.items[0].product, quantity: 1, unitPrice: 1000, reason: 'transit_damage' }],
        problemDescription: 'Cracked on arrival.',
        status: 'pending',
      });
    }
    const payable = await seedMatured(new Date(Date.now() - 1000));

    const result = await affiliateCommissionService.sweepMaturity(new Date(), LIMIT);

    expect(result.approved).toBe(1);
    expect((await affiliateCommissionRepository.findAccrual(payable._id)).status)
      .toBe(COMMISSION_STATUS.APPROVED);
  });

  it('is idempotent — a second sweep approves nothing further', async () => {
    await seedMatured();

    expect((await affiliateCommissionService.sweepMaturity()).approved).toBe(1);
    expect((await affiliateCommissionService.sweepMaturity()).approved).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('clawback', () => {
  const seedAccrued = async () => {
    const order = await makeOrder();
    await affiliateCommissionService.accrueForOrder(order._id);
    return order;
  };

  it('claws back the whole commission on a cancelled order', async () => {
    const order = await seedAccrued();

    await affiliateCommissionService.clawbackForOrder(order._id, 'order_cancelled');

    expect(await affiliateCommissionRepository.netPaiseForOrder(order._id)).toBe(0);
    expect((await affiliateCommissionRepository.findAccrual(order._id)).status)
      .toBe(COMMISSION_STATUS.REVERSED);
  });

  /*
    Proportionality. The order's goods pot is ₹3,500 for 3 units. Returning ONE ₹1,000
    unit takes its discount-adjusted share of that pot — NOT its ₹1,000 list price, which
    would over-claw, and not the whole commission, which would under-pay the affiliate
    for the two units the customer kept.
  */
  it('claws back one returned line proportionally, not the whole commission', async () => {
    const order = await seedAccrued();
    const before = await affiliateCommissionRepository.netPaiseForOrder(order._id);

    await affiliateCommissionService.clawbackForLines(
      order._id,
      [{ product: order.items[0].product, quantity: 1, unitPrice: 1000 }],
      'return_refunded',
    );

    const after = await affiliateCommissionRepository.netPaiseForOrder(order._id);
    expect(after).toBeGreaterThan(0);      // the kept units still earn
    expect(after).toBeLessThan(before);    // but not the full amount
    /*
      One ₹1,000 unit of a ₹3,000 gross basket = 1/3 of the ₹2,500 net pot = ₹833.33
      (83,333 paise after refundMathService floors it). The customer KEPT ₹1,666.67, on
      which we still owe 10% = 16,666 paise — so the clawback is 25,000 − 16,666 = 8,334.

      Not ₹100 (the unit's LIST price, which would over-claw by its share of the
      discount) and not ₹250 (the whole commission, which would under-pay for the two
      units the customer kept). The single paise of difference from a naive
      "10% of what came back" is the rounding residue — see _clawbackTarget.
    */
    expect(before - after).toBe(8334);
  });

  /*
    The completeness check. Returning every line must net EXACTLY to zero — if the
    per-line maths and the whole-order maths disagree by even a paise, one of the two
    is wrong and the ledger will not reconcile.
  */
  it('nets to exactly zero when every line is returned', async () => {
    const order = await seedAccrued();

    await affiliateCommissionService.clawbackForLines(
      order._id,
      order.items.map((i) => ({ product: i.product, quantity: i.quantity, unitPrice: i.price })),
      'return_refunded',
    );

    expect(await affiliateCommissionRepository.netPaiseForOrder(order._id)).toBe(0);
  });

  /*
    Real returns arrive one at a time. Each call computes its target as if it were the
    only return — deliberately too large — and the clamp trims it to what is left. The
    sequence must therefore land on exactly zero, not overshoot and not leave a residue.
  */
  it('reaches exactly zero across two SEPARATE partial returns', async () => {
    const order = await seedAccrued();

    await affiliateCommissionService.clawbackForLines(
      order._id,
      [{ product: order.items[0].product, quantity: 1, unitPrice: 1000 }],
      'return_refunded',
    );
    const afterFirst = await affiliateCommissionRepository.netPaiseForOrder(order._id);
    expect(afterFirst).toBe(25000 - 8334);

    await affiliateCommissionService.clawbackForLines(
      order._id,
      [{ product: order.items[1].product, quantity: 2, unitPrice: 1000 }],
      'return_refunded',
    );

    expect(await affiliateCommissionRepository.netPaiseForOrder(order._id)).toBe(0);
    expect((await affiliateCommissionRepository.findAccrual(order._id)).status)
      .toBe(COMMISSION_STATUS.REVERSED);
  });

  /*
    The same refund is reported by BOTH the controller that initiated it and the
    refund.processed webhook. The claim in each side-effect module should stop the
    second, but the clamp is what guarantees it — even a leak through both can only
    reduce this order to zero, never past it into owing the affiliate money.
  */
  it('cannot be driven negative by a double-fired clawback', async () => {
    const order = await seedAccrued();

    await affiliateCommissionService.clawbackForOrder(order._id, 'order_refunded');
    await affiliateCommissionService.clawbackForOrder(order._id, 'order_refunded');
    await affiliateCommissionService.clawbackForOrder(order._id, 'order_refunded');

    expect(await affiliateCommissionRepository.netPaiseForOrder(order._id)).toBe(0);
  });

  it('claws back proportionally from a refunded AMOUNT when lines are unknown', async () => {
    const order = await seedAccrued();

    // Half the ₹2,500 goods pot came back, so half the ₹250 commission stands.
    await affiliateCommissionService.clawbackForAmount(order._id, 125000, 'order_line_cancelled');

    expect(await affiliateCommissionRepository.netPaiseForOrder(order._id)).toBe(12500);
  });

  /*
    ⚠️ THE KILL SWITCH MUST NOT SWALLOW A CLAWBACK.

    Clawbacks are called from behind one-shot claims, so a `skipped: disabled` return is
    not a deferral — the claim is spent and nothing calls it again. Flipping the switch
    off mid-refund would stop us recovering commission on returned goods while leaving
    every existing liability standing: the opposite of what a kill switch is for.
  */
  it('still claws back with the programme switched off', async () => {
    const order = await seedAccrued();
    process.env.AFFILIATE_COMMISSION_ENABLED = 'false';

    try {
      await affiliateCommissionService.clawbackForOrder(order._id, 'order_refunded');
      expect(await affiliateCommissionRepository.netPaiseForOrder(order._id)).toBe(0);
    } finally {
      process.env.AFFILIATE_COMMISSION_ENABLED = 'true';
    }
  });

  it('still claws back lines and amounts with the programme switched off', async () => {
    const byLines = await seedAccrued();
    const byAmount = await seedAccrued();
    process.env.AFFILIATE_COMMISSION_ENABLED = 'false';

    try {
      await affiliateCommissionService.clawbackForLines(
        byLines._id,
        byLines.items.map((i) => ({ product: i.product, quantity: i.quantity, unitPrice: i.price })),
        'return_refunded',
      );
      await affiliateCommissionService.clawbackForAmount(byAmount._id, 250000, 'cancelled');

      expect(await affiliateCommissionRepository.netPaiseForOrder(byLines._id)).toBe(0);
      expect(await affiliateCommissionRepository.netPaiseForOrder(byAmount._id)).toBe(0);
    } finally {
      process.env.AFFILIATE_COMMISSION_ENABLED = 'true';
    }
  });

  it('is a no-op on an order that never earned anything', async () => {
    const order = await makeOrder({ affiliate: undefined });

    expect(await affiliateCommissionService.clawbackForOrder(order._id))
      .toEqual({ status: 'noop', reason: 'no_commission' });
  });

  /*
    ⚠️ The debt case. Money that has already left the bank is NOT rewritten — the paid
    row keeps its status and a negative APPROVED row is written alongside it, so the debt
    lands in exactly the set the next payout batch claims and nets off automatically.
    Mutating the paid row instead would break reconciliation against the bank statement.
  */
  it('writes a debt row rather than rewriting an already-paid commission', async () => {
    const order = await seedAccrued();
    await AffiliateCommission.updateOne(
      { order: order._id, type: COMMISSION_TYPE.ACCRUAL },
      { $set: { status: COMMISSION_STATUS.PAID, payout: oid() } }
    );

    await affiliateCommissionService.clawbackForOrder(order._id, 'order_refunded');

    const accrual = await affiliateCommissionRepository.findAccrual(order._id);
    expect(accrual.status).toBe(COMMISSION_STATUS.PAID); // untouched

    const debt = await AffiliateCommission.findOne({
      order: order._id, type: COMMISSION_TYPE.CLAWBACK,
    });
    expect(debt.amountPaise).toBe(-25000);
    expect(debt.status).toBe(COMMISSION_STATUS.APPROVED);
    expect(debt.payout).toBeNull(); // claimable by the next batch

    // And it nets off what the affiliate is owed overall.
    expect(await affiliateCommissionRepository.payableBalancePaise(affiliate._id)).toBe(-25000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('returnRefundLtvService — the clawback is not hostage to the LTV guard', () => {
  /*
    ⚠️ ORDERING BUG. The clawback used to sit AFTER
    `if (!rr.user || amountPaise <= 0) return { status: 'noop' }` — and that early exit
    runs AFTER `claimLtvReversal` has already burned the one-shot claim. So whenever the
    LTV limb had nothing to do, the clawback was skipped PERMANENTLY: claim spent, no
    retry path, and the affiliate stayed paid in full for goods that came back.

    The two effects have different preconditions and must not share a guard. The
    reachable case is a zero/absent refund amount — the LTV decrement has nothing to
    subtract, but the goods have still been returned and the commission is still owed
    back. (`!rr.user` is unreachable today: the ReturnRequest schema requires it. The
    guard is written so it stays correct if that ever changes.)
  */
  it('claws back even when the LTV limb has nothing to do', async () => {
    const { reverseReturnLtvOnce } = await import('../services/returnRefundLtvService.js');

    const order = await makeOrder();
    await affiliateCommissionService.accrueForOrder(order._id);
    expect(await affiliateCommissionRepository.netPaiseForOrder(order._id)).toBe(25000);

    const rr = await ReturnRequest.create({
      order: order._id,
      user: order.user,
      items: order.items.map((i) => ({
        product: i.product, quantity: i.quantity, unitPrice: i.price, reason: 'transit_damage',
      })),
      problemDescription: 'All items faulty.',
      status: 'received',
      refund: { finalAmount: 0, status: 'completed' },
    });

    const result = await reverseReturnLtvOnce(rr._id.toString());

    // The LTV limb correctly no-ops — there is no money to subtract from spend…
    expect(result.status).toBe('noop');
    // …but the commission still came back, because the goods did.
    expect(await affiliateCommissionRepository.netPaiseForOrder(order._id)).toBe(0);
  });

  it('still claws back on the ordinary path, and only once', async () => {
    const { reverseReturnLtvOnce } = await import('../services/returnRefundLtvService.js');

    const order = await makeOrder();
    await affiliateCommissionService.accrueForOrder(order._id);

    const rr = await ReturnRequest.create({
      order: order._id,
      user: order.user,
      items: [{ product: order.items[0].product, quantity: 1, unitPrice: 1000, reason: 'transit_damage' }],
      problemDescription: 'Cracked rim.',
      status: 'received',
      refund: { finalAmount: 833, status: 'completed' },
    });

    await reverseReturnLtvOnce(rr._id.toString());
    const afterFirst = await affiliateCommissionRepository.netPaiseForOrder(order._id);
    expect(afterFirst).toBe(25000 - 8334);

    // The webhook fires too. The claim is spent, so nothing moves a second time.
    await reverseReturnLtvOnce(rr._id.toString());
    expect(await affiliateCommissionRepository.netPaiseForOrder(order._id)).toBe(afterFirst);
  });
});

describe('voidForOrder — an admin decision, not a refund', () => {
  it('voids a pending commission', async () => {
    const order = await makeOrder();
    await affiliateCommissionService.accrueForOrder(order._id);

    await affiliateCommissionService.voidForOrder(order._id, 'fraud');

    expect((await affiliateCommissionRepository.findAccrual(order._id)).status)
      .toBe(COMMISSION_STATUS.VOID);
    // A void row is excluded from the balance entirely.
    expect(await affiliateCommissionRepository.netPaiseForOrder(order._id)).toBe(0);
  });

  it('refuses to void money that has already been paid out', async () => {
    const order = await makeOrder();
    await affiliateCommissionService.accrueForOrder(order._id);
    await AffiliateCommission.updateOne(
      { order: order._id }, { $set: { status: COMMISSION_STATUS.PAID } }
    );

    expect(await affiliateCommissionService.voidForOrder(order._id))
      .toEqual({ status: 'skipped', reason: 'already_paid' });
  });
});

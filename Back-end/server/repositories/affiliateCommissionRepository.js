import mongoose from 'mongoose';
import BaseRepository from './baseRepository.js';
import AffiliateCommission from '../models/AffiliateCommission.js';
import {
  COMMISSION_STATUS,
  COMMISSION_TYPE,
  MATURATION_BATCH_SIZE,
} from '../config/affiliate.js';

/**
 * AffiliateCommission data access — the money ledger.
 *
 * Every query here that filters on `{ order, type }` is served by the PLAIN
 * `{ order: 1 }` index, never by the partial-unique accrual guard. See the long note
 * in models/AffiliateCommission.js: the planner cannot prove an equality predicate is
 * contained by a `$type` partial filter, so relying on the guard for reads would
 * silently collection-scan.
 */
class AffiliateCommissionRepository extends BaseRepository {
  constructor() {
    super(AffiliateCommission);
  }

  /** The single accrual row for an order, or null. */
  async findAccrual(orderId, session = null) {
    if (!orderId) return null;
    let q = AffiliateCommission.findOne({ order: orderId, type: COMMISSION_TYPE.ACCRUAL });
    if (session) q = q.session(session);
    return q;
  }

  /**
   * Net paise still standing against an order — accrual plus every clawback/adjust.
   *
   * `void` rows are excluded: an admin voided them, so they are not part of the
   * balance. This is the ceiling a new clawback is clamped to, which is what makes a
   * double-fired clawback (controller path AND refund webhook) unable to drive an
   * order's commission negative.
   */
  async netPaiseForOrder(orderId, session = null) {
    if (!orderId) return 0;
    const pipeline = [
      {
        $match: {
          order: new mongoose.Types.ObjectId(String(orderId)),
          status: { $ne: COMMISSION_STATUS.VOID },
        },
      },
      { $group: { _id: null, net: { $sum: '$amountPaise' } } },
    ];
    const agg = AffiliateCommission.aggregate(pipeline);
    if (session) agg.session(session);
    const [row] = await agg;
    return row?.net ?? 0;
  }

  /**
   * What we currently owe an affiliate, in paise.
   *
   * Deliberately the same predicate the payout batch claims on, so the number the
   * admin sees is exactly the number that will be claimed. Clawback rows are negative
   * and land in this set, so a debt incurred after a payout nets off here with no
   * special handling — and if the total goes negative the batch builder refuses.
   */
  async payableBalancePaise(affiliateId, session = null) {
    if (!affiliateId) return 0;
    const pipeline = [
      {
        $match: {
          affiliate: new mongoose.Types.ObjectId(String(affiliateId)),
          status: COMMISSION_STATUS.APPROVED,
          payout: null,
        },
      },
      { $group: { _id: null, net: { $sum: '$amountPaise' } } },
    ];
    const agg = AffiliateCommission.aggregate(pipeline);
    if (session) agg.session(session);
    const [row] = await agg;
    return row?.net ?? 0;
  }

  /** Per-status totals for one affiliate — the dashboard's summary tiles. */
  async summaryByStatus(affiliateId) {
    if (!affiliateId) return {};
    const rows = await AffiliateCommission.aggregate([
      { $match: { affiliate: new mongoose.Types.ObjectId(String(affiliateId)) } },
      { $group: { _id: '$status', net: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
    ]);
    return rows.reduce((acc, r) => {
      acc[r._id] = { netPaise: r.net, count: r.count };
      return acc;
    }, {});
  }

  /**
   * Rows whose maturity date has passed and which are still pending.
   *
   * ⚠️ `maturesAt: { $ne: null }` IS LOAD-BEARING. In BSON sort order null sorts below
   * Date, so `{ $lte: now }` on its own matches every un-stamped row — that is, every
   * order that has NOT been delivered. Dropping it would approve commissions on orders
   * that never shipped, silently, at 4am. (`$ne` is rejected inside a
   * partialFilterExpression; inside a query it is ordinary and correct.)
   *
   * Served by `{ status: 1, maturesAt: 1 }`. Bounded so one tick cannot produce an
   * unbounded write burst.
   */
  async findMaturable(now = new Date(), limit = MATURATION_BATCH_SIZE, after = null) {
    /*
      `after` is a keyset cursor on `maturesAt`, and it is what stops the sweep starving.
      Skipped rows (an order with an in-flight return) are not consumed, so without a
      cursor they hold the head of this ordering for ever and every run re-reads the same
      stuck page. See affiliateCommissionService.sweepMaturity.

      `$gt` on a non-unique key can skip rows sharing the boundary timestamp. That is
      acceptable here and self-healing: a missed row is picked up by the next night's run
      (its `maturesAt` is unchanged and still in the past), and nothing is lost — unlike
      `$gte`, which would re-read the boundary page for ever and reintroduce the stall.
    */
    const query = {
      status: COMMISSION_STATUS.PENDING,
      maturesAt: { $ne: null, $lte: now },
    };
    if (after) query.maturesAt.$gt = after;

    return AffiliateCommission.find(query)
      .sort({ maturesAt: 1 })
      .limit(limit)
      .lean();
  }

  /**
   * Compare-and-set pending → approved.
   *
   * Guarded on `status: 'pending'` so a clawback that moved the row to `reversed`
   * between the sweep's read and its write cannot be resurrected into a payable.
   *
   * @returns {Promise<boolean>} true when THIS call made the transition
   */
  async approveOnce(commissionId, now = new Date()) {
    const res = await AffiliateCommission.updateOne(
      { _id: commissionId, status: COMMISSION_STATUS.PENDING },
      { $set: { status: COMMISSION_STATUS.APPROVED, approvedAt: now } }
    );
    return res.modifiedCount === 1;
  }

  /**
   * Stamp the maturity date on an order's accrual row, if it does not have one.
   *
   * Guarded on `maturesAt: null` so a re-delivered / re-run job cannot push the date
   * forward and delay a payment that was already due.
   */
  async stampMaturity(orderId, maturesAt) {
    const res = await AffiliateCommission.updateOne(
      {
        order: orderId,
        type: COMMISSION_TYPE.ACCRUAL,
        status: COMMISSION_STATUS.PENDING,
        maturesAt: null,
      },
      { $set: { maturesAt } }
    );
    return res.modifiedCount === 1;
  }

  /**
   * Affiliate-facing and admin-facing ledger list — keyset-paginated, bounded.
   */
  async findPage({ affiliate = null, status = null, limit = 50, before = null } = {}) {
    const query = {};
    if (affiliate) query.affiliate = affiliate;
    if (status) query.status = status;
    if (before) query.createdAt = { $lt: before };

    return AffiliateCommission.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('order', 'totalAmount createdAt status paymentStatus')
      .lean();
  }

  /**
   * Commissions stuck pending with no maturity date past a cutoff.
   *
   * These are orders that were PAID but never marked delivered. They will never mature,
   * which is the correct fail-closed behaviour — but it is invisible, so the admin needs
   * to be able to see them. We never auto-approve on age: an order undelivered for two
   * months is an operations problem, not a payable.
   */
  /*
    MEASURED, and deliberately left unindexed: at 5,000 rows this examines ~417 docs to
    return 100, because `{status:1, maturesAt:1}` cannot serve the `createdAt` sort and
    Mongo collects-then-sorts. A `{status, maturesAt, createdAt}` index would fix it.

    Not added. It is an admin-only query run once per page load, the absolute numbers are
    tiny, and a fourth index on a money collection costs a write on every accrual and
    every clawback forever. Revisit only if a measurement says the sort actually hurts.
  */
  async findStalePending(cutoff, limit = 100) {
    return AffiliateCommission.find({
      status: COMMISSION_STATUS.PENDING,
      maturesAt: null,
      createdAt: { $lt: cutoff },
    })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();
  }

  /** Append a ledger row (accrual / clawback / adjust). */
  async createRow(doc, session = null) {
    if (session) {
      const [row] = await AffiliateCommission.create([doc], { session });
      return row;
    }
    return AffiliateCommission.create(doc);
  }

  /**
   * Move a row into a terminal state, guarded on the states it may legally move FROM.
   * Returns true only when THIS call made the transition.
   */
  async transitionOnce(commissionId, fromStatuses, update) {
    const res = await AffiliateCommission.updateOne(
      { _id: commissionId, status: { $in: fromStatuses } },
      { $set: update },
    );
    return res.modifiedCount === 1;
  }

  /**
   * THE PAYOUT CLAIM. Flip every payable row for an affiliate into one batch.
   *
   * `payout: null` is the concurrency guard: a second admin's identical call matches
   * zero rows, so no second payout document with money on it can exist. Must run inside
   * the caller's transaction so a failure downstream releases the rows.
   *
   * @returns {Promise<number>} rows actually claimed
   */
  async claimForPayout(affiliateId, payoutId, session) {
    const res = await AffiliateCommission.updateMany(
      { affiliate: affiliateId, status: COMMISSION_STATUS.APPROVED, payout: null },
      { $set: { status: COMMISSION_STATUS.PAID, payout: payoutId } },
      { session },
    );
    return res.modifiedCount;
  }

  /** Release a failed batch's rows back into the payable pool. */
  async releaseFromPayout(payoutId, session = null) {
    const res = await AffiliateCommission.updateMany(
      { payout: payoutId },
      { $set: { status: COMMISSION_STATUS.APPROVED, payout: null } },
      session ? { session } : {},
    );
    return res.modifiedCount;
  }

  /**
   * Totals for the rows a batch ACTUALLY claimed.
   *
   * Read after the claim, never before: a balance read beforehand is a TOCTOU window in
   * which a concurrent clawback would make the payout overstate what it paid.
   */
  async payoutTotals(payoutId, session = null) {
    const agg = AffiliateCommission.aggregate([
      { $match: { payout: payoutId } },
      {
        $group: {
          _id: null,
          grossPaise: { $sum: '$amountPaise' },
          count: { $sum: 1 },
          from: { $min: '$createdAt' },
          to: { $max: '$createdAt' },
        },
      },
    ]);
    if (session) agg.session(session);
    const [row] = await agg;
    return {
      grossPaise: row?.grossPaise ?? 0,
      count: row?.count ?? 0,
      from: row?.from ?? null,
      to: row?.to ?? null,
    };
  }

  /** Rows claimed by a payout batch — the batch detail view and its totals. */
  async findByPayout(payoutId, session = null) {
    let q = AffiliateCommission.find({ payout: payoutId }).sort({ createdAt: -1 });
    if (session) q = q.session(session);
    return q.lean();
  }
}

export default new AffiliateCommissionRepository();

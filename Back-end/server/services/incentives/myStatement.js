/**
 * A salesperson's OWN Roav Points statement, order by order (team panel
 * "My Roav Points"). Read-only.
 *
 * Every figure here is a sum of the same ledger rows the admin statement sums
 * (monthService.computeStatements), so the per-order points add up to exactly
 * the statement's `ledgerPoints`. Nothing is re-derived from orders or rules.
 *
 * The earner is ALWAYS the caller (routes pass selfKey(req.user)); there is no
 * id parameter to tamper with.
 */
import mongoose from 'mongoose';
import * as repo from '../../repositories/incentiveRepository.js';
import AppError from '../../utils/AppError.js';
import { monthRange } from './months.js';
import { programStartMonth } from './ledgerService.js';

/**
 * Can a salesperson see the stars and comments on their own customers' ratings?
 * Was NO under the PR #491 rule (count and average only). Owner changed it on
 * 2026-11-14: YES, their OWN customers' stars and comments. Other people's
 * ratings stay hidden (every query is scoped to the caller). Set to false to go
 * back to count + average only; the page handles both. Mutable only so tests
 * can cover both answers.
 */
export const ratingVisibility = { staffSeeOwnDetails: true };

const PAGE = 25;
const PENDING_LIMIT = 50;
const RATINGS_LIMIT = 200;
const LINES_PER_ORDER = 60; // an order's rows: ~2 per item line, + bonus + reversals

const userIdOf = (earnerKey) => {
  const m = /^u:([a-f0-9]{24})$/i.exec(earnerKey);
  return m ? new mongoose.Types.ObjectId(m[1]) : null;
};
const isEarn = { $eq: ['$type', 'earn'] };

/** Status of an order's points in this month, from its rows here. */
export function orderStatus({ netCenti, reversals, recomputeOnly }) {
  if (!reversals) return 'counted';
  if (recomputeOnly && netCenti > 0) return 'counted';
  return netCenti <= 0 ? 'reversed' : 'partly_reversed';
}

/**
 * One page of my orders for `month`, newest order first; cursor = last order id.
 * The first page also carries the paid orders still waiting for the payment check.
 */
export async function myOrders(month, earnerKey, { cursor = null, limit = PAGE } = {}) {
  const size = Math.min(Math.max(Number(limit) || PAGE, 1), 50);
  let after = null;
  if (cursor) {
    if (!mongoose.isValidObjectId(cursor)) throw new AppError('Invalid cursor', 400);
    after = new mongoose.Types.ObjectId(cursor);
  }
  const groups = await repo.ledgerAggregate([
    { $match: { month, earnerKey } }, // index incentive_ledger_month_earner
    { $sort: { _id: 1 } },
    {
      $group: {
        _id: '$order',
        orderNumber: { $last: '$orderNumber' },
        netCenti: { $sum: '$centi' },
        bonusCenti: { $sum: { $cond: [{ $eq: ['$component', 'order'] }, '$centi', 0] } },
        reversals: { $sum: { $cond: [isEarn, 0, 1] } },
        nonRecompute: { $sum: { $cond: [{ $and: [{ $eq: ['$type', 'reverse'] }, { $ne: ['$reason', 'recompute'] }] }, 1, 0] } },
        // The order-level snapshot (value, discount, portions…) every earn row carries.
        earnInputs: { $push: { $cond: [{ $and: [isEarn, { $ne: [{ $type: '$inputs.valueExGst' }, 'missing'] }] }, '$inputs', '$$REMOVE'] } },
        paidAt: { $min: { $cond: [isEarn, '$eventAt', null] } },
        lines: {
          $push: {
            _id: '$_id', type: '$type', component: '$component', centi: '$centi', reason: '$reason',
            eventAt: '$eventAt', rev: '$rev', label: '$inputs.label', quantity: '$inputs.quantity',
            fraction: '$inputs.fraction', earnMonth: '$inputs.earnMonth', landedLate: '$inputs.landedLate',
          },
        },
      },
    },
    ...(after ? [{ $match: { _id: { $lt: after } } }] : []),
    { $sort: { _id: -1 } },
    { $limit: size + 1 },
    {
      $project: {
        orderNumber: 1, netCenti: 1, bonusCenti: 1, reversals: 1, nonRecompute: 1, paidAt: 1,
        inputs: { $last: '$earnInputs' }, lines: { $slice: ['$lines', LINES_PER_ORDER] },
      },
    },
  ]);
  const more = groups.length > size;
  const page = more ? groups.slice(0, size) : groups;
  const ids = page.map((g) => g._id);
  const userId = userIdOf(earnerKey);

  const [cards, ratings, pending] = await Promise.all([
    ids.length ? repo.orderCardsFor(ids) : [],
    ids.length && userId && ratingVisibility.staffSeeOwnDetails ? repo.ratingsForOrders(ids, userId) : [],
    !cursor && userId ? pendingOrders(month, userId) : [],
  ]);
  const cardOf = new Map(cards.map((c) => [String(c._id), c]));
  const ratingOf = new Map(ratings.map((r) => [String(r.order), r]));

  const orders = page.map((g) => {
    const card = cardOf.get(String(g._id));
    const inp = g.inputs || null;
    const rating = ratingOf.get(String(g._id));
    return {
      order: String(g._id),
      orderNumber: g.orderNumber,
      date: g.paidAt || card?.listDate || card?.createdAt || null,
      customerName: card?.shippingAddress?.fullName || '',
      valueExGst: inp?.valueExGst ?? null,
      discountPercent: inp?.discountPercent ?? null,
      discountKeep: inp?.discountKeep ?? null,
      portions: inp?.portions || [],
      specialSourcing: !!inp?.specialSourcing,
      sourcingKeep: inp?.sourcingKeep ?? null,
      isB2B: !!inp?.isB2B,
      basePoints: (g.netCenti - g.bonusCenti) / 100,
      bonusPoints: g.bonusCenti / 100,
      points: g.netCenti / 100,
      status: orderStatus({ netCenti: g.netCenti, reversals: g.reversals, recomputeOnly: g.nonRecompute === 0 }),
      rating: rating ? { stars: rating.stars, comment: rating.comment || '', counted: rating.sameNetworkAsSender !== true } : null,
      lines: g.lines.map(({ centi, ...l }) => ({ ...l, points: centi / 100 })),
    };
  });
  return {
    orders,
    nextCursor: more ? String(page[page.length - 1]._id) : null,
    pending,
    ratingDetails: ratingVisibility.staffSeeOwnDetails,
  };
}

/** My paid orders listed this month that have no ledger row yet (payment not verified yet). */
async function pendingOrders(month, userId) {
  if (month < programStartMonth()) return [];
  const { start, end } = monthRange(month);
  const paid = await repo.paidSalesOrdersOf(userId, start, end, PENDING_LIMIT);
  if (!paid.length) return [];
  const done = new Set((await repo.ordersWithLedger(paid.map((o) => o._id))).map(String));
  return paid.filter((o) => !done.has(String(o._id))).map((o) => ({
    order: String(o._id),
    orderNumber: o.wpId ? `#${o.wpId}` : `#${String(o._id).slice(-8).toUpperCase()}`,
    date: o.listDate,
    customerName: o.shippingAddress?.fullName || '',
    status: 'pending',
  }));
}

/** Orders that earned the per-order bonus this month (net of reversals). */
export async function bonusOrderCount(month, earnerKey) {
  const [r] = await repo.ledgerAggregate([
    { $match: { month, earnerKey, component: 'order' } },
    { $group: { _id: '$order', c: { $sum: '$centi' } } },
    { $match: { c: { $gt: 0 } } },
    { $count: 'n' },
  ]);
  return r?.n || 0;
}

/** Ratings that were left out of my score (sent from my own connection). */
export async function excludedRatings(month, earnerKey) {
  const userId = userIdOf(earnerKey);
  if (!userId) return 0;
  const { start, end } = monthRange(month);
  return repo.excludedRatingCount(userId, start, end);
}

/** My month's ratings with stars and comments — only if the owner allows it. */
export async function myRatings(month, earnerKey) {
  if (!ratingVisibility.staffSeeOwnDetails) return { visible: false, ratings: [] };
  const userId = userIdOf(earnerKey);
  if (!userId) return { visible: true, ratings: [] };
  const { start, end } = monthRange(month);
  const rows = await repo.ratingsOf(userId, start, end, RATINGS_LIMIT);
  const cards = rows.length ? await repo.orderCardsFor(rows.map((r) => r.order)) : [];
  const cardOf = new Map(cards.map((c) => [String(c._id), c]));
  return {
    visible: true,
    ratings: rows.map((r) => {
      const c = cardOf.get(String(r.order));
      return {
        orderNumber: c ? (c.wpId ? `#${c.wpId}` : `#${String(c._id).slice(-8).toUpperCase()}`) : '',
        customerName: c?.shippingAddress?.fullName || '',
        stars: r.stars, comment: r.comment || '', at: r.createdAt, counted: r.sameNetworkAsSender !== true,
      };
    }),
  };
}

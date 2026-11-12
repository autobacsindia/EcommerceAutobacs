/**
 * Roav Points month close: live month figures, lock → admin approve → CSV,
 * re-open (admin, with a reason, audited), the per-person statement and the
 * Incentive Champion.
 *
 * A locked month's figures are a SNAPSHOT (IncentiveMonth.statements) computed
 * from the ledger at lock time with that month's rules. Approve re-sums the
 * ledger and refuses if anything moved since the lock (a late row squeezed in by
 * a sweep that read the month as open a moment before), so payroll never pays
 * from a stale snapshot.
 */
import mongoose from 'mongoose';
import * as repo from '../../repositories/incentiveRepository.js';
import AppError from '../../utils/AppError.js';
import auditLogger from '../auditLogger.js';
import { monthResult } from './pointsMath.js';
import { rulesForMonth } from './ruleService.js';
import { monthOf, monthRange, isMonth, addMonths, istDayOfMonth } from './months.js';

const RETURN_REASONS = ['return', 'refund'];

/** Ledger totals per earner for a month (optionally one earner / a set of earners). */
async function ledgerTotals(month, earnerFilter = null) {
  const match = { month };
  if (earnerFilter) match.earnerKey = earnerFilter;
  return repo.ledgerAggregate([
    { $match: match },
    {
      $group: {
        _id: '$earnerKey',
        centi: { $sum: '$centi' },
        flatCenti: { $sum: '$flatCenti' },
        user: { $max: '$earnerUser' },
        rep: { $max: '$earnerRep' },
        name: { $last: '$earnerName' },
        rows: { $sum: 1 },
        orders: { $addToSet: { $cond: [{ $eq: ['$type', 'earn'] }, '$order', '$$REMOVE'] } },
        returned: { $addToSet: { $cond: [{ $and: [{ $eq: ['$type', 'reverse'] }, { $in: ['$reason', RETURN_REASONS] }] }, '$order', '$$REMOVE'] } },
      },
    },
  ]);
}

/**
 * Customer ratings per salesperson for the month, from the OrderRating
 * collection (built by another workstream). Absent collection → no ratings.
 */
export async function ratingsByEarner(month) {
  const { start, end } = monthRange(month);
  const coll = mongoose.models.OrderRating?.collection || mongoose.connection.db?.collection('orderratings');
  if (!coll) return new Map();
  const rows = await coll.aggregate([
    // Ratings flagged as sent from the salesperson's own connection (possible
    // self-rating, see services/orderRatingService.js) never count. Owner's call, 2026-11-12.
    { $match: { createdAt: { $gte: start, $lt: end }, salesperson: { $type: 'objectId' }, stars: { $gte: 1, $lte: 5 }, sameNetworkAsSender: { $ne: true } } },
    { $group: { _id: '$salesperson', count: { $sum: 1 }, avg: { $avg: '$stars' } } },
  ]).toArray();
  return new Map(rows.map((r) => [`u:${r._id}`, { count: r.count, avg: Math.round(r.avg * 100) / 100 }]));
}

/** Rank: final points, then higher average rating, then more orders, then name. */
export const rankStatements = (a, b) => (b.finalPoints - a.finalPoints)
  || ((b.ratingAvg ?? -1) - (a.ratingAvg ?? -1))
  || (b.orders - a.orders)
  || String(a.name).localeCompare(String(b.name));

/** Compute statements for `month` from the ledger as it is now. */
export async function computeStatements(month, { earnerFilter = null } = {}) {
  const [{ version, rules }, totals, ratings] = await Promise.all([
    rulesForMonth(month), ledgerTotals(month, earnerFilter), ratingsByEarner(month),
  ]);
  const statements = totals.map((t) => {
    const rating = ratings.get(t._id) || { count: 0, avg: null };
    const orders = t.orders.length;
    const res = monthResult({
      centi: t.centi, flatCenti: t.flatCenti, orders, returnedOrders: t.returned.length,
      ratingCount: rating.count, ratingAvg: rating.avg,
    }, rules);
    return {
      earnerKey: t._id, earnerUser: t.user || null, earnerRep: t.rep || null, name: t.name || '',
      orders, returnedOrders: t.returned.length, ratingCount: rating.count, ratingAvg: rating.avg,
      centi: t.centi, flatCenti: t.flatCenti, rows: t.rows, ...res,
    };
  }).sort(rankStatements);
  return { version, rules, statements };
}

export const championOf = (statements) => {
  const top = statements.find((s) => s.finalPoints > 0);
  return top ? {
    earnerKey: top.earnerKey, name: top.name, finalPoints: top.finalPoints,
    payoutPaise: top.payoutPaise, slab: top.slab, ratingAvg: top.ratingAvg,
  } : null;
};

const actorOf = (user) => ({ by: user?._id || null, byName: user?.name || 'system' });

/**
 * Lock a finished month and snapshot its statements. Idempotent: locking a
 * locked month just recomputes a missing snapshot. Only months that have ended
 * (IST) can be locked.
 */
export async function lockMonth(month, { user = null, now = new Date(), req = null } = {}) {
  if (!isMonth(month)) throw new AppError('Invalid month', 400);
  if (month >= monthOf(now)) throw new AppError('A month can be locked only after it ends', 400, { expose: true });

  let doc = await repo.monthDoc(month);
  if (doc?.status === 'approved') return doc;
  if (!doc || doc.status === 'open') {
    try {
      doc = await repo.updateMonth(
        { month, status: 'open' },
        { $set: { status: 'locked', lockedAt: now, statements: [], champion: null }, $push: { history: { action: 'locked', at: now, ...actorOf(user) } } },
        { upsert: true }
      );
    } catch (err) {
      if (err?.code !== 11000) throw err; // a concurrent lock won the upsert
      doc = await repo.monthDoc(month);
    }
  }
  const { version, statements } = await computeStatements(month);
  const sums = statements.reduce((a, s) => ({ c: a.c + s.centi, r: a.r + s.rows }), { c: 0, r: 0 });
  const updated = await repo.updateMonth(
    { month, status: 'locked' },
    {
      $set: {
        rulesVersion: version, statements, champion: championOf(statements),
        totalPayoutPaise: statements.reduce((a, s) => a + s.payoutPaise, 0),
        ledgerCentiAtLock: sums.c, ledgerRowsAtLock: sums.r,
      },
    }
  );
  if (req) await auditLogger.logAction(req, 'LOCK', 'IncentiveMonth', month, { rulesVersion: version, people: statements.length });
  return updated || repo.monthDoc(month);
}

/** Recompute a locked month's snapshot (after a late row). */
export const recomputeLocked = (month, opts) => lockMonth(month, opts);

export async function approveMonth(month, { user, req = null, now = new Date() }) {
  const doc = await repo.monthDoc(month);
  if (!doc || doc.status !== 'locked') throw new AppError('Only a locked month can be approved', 409, { expose: true });
  const [now_] = await repo.ledgerAggregate([
    { $match: { month } }, { $group: { _id: null, c: { $sum: '$centi' }, r: { $sum: 1 } } },
  ]);
  if ((now_?.c || 0) !== doc.ledgerCentiAtLock || (now_?.r || 0) !== doc.ledgerRowsAtLock) {
    throw new AppError('Points changed after this month was locked. Press "Recompute", check again, then approve.', 409, { expose: true });
  }
  const updated = await repo.updateMonth(
    { month, status: 'locked' },
    { $set: { status: 'approved', approvedAt: now, approvedBy: user._id }, $push: { history: { action: 'approved', at: now, ...actorOf(user) } } }
  );
  if (!updated) throw new AppError('This month changed meanwhile, reload and try again', 409, { expose: true });
  if (req) await auditLogger.logAction(req, 'APPROVE', 'IncentiveMonth', month, { totalPayoutPaise: doc.totalPayoutPaise });
  return updated;
}

export async function reopenMonth(month, { user, reason, req = null, now = new Date() }) {
  const why = String(reason || '').trim();
  if (why.length < 5) throw new AppError('Say why the month is being re-opened (at least 5 characters)', 400, { expose: true });
  const doc = await repo.updateMonth(
    { month, status: { $in: ['locked', 'approved'] } },
    {
      $set: { status: 'open', statements: [], champion: null, totalPayoutPaise: 0, approvedAt: null, approvedBy: null, ledgerCentiAtLock: null, ledgerRowsAtLock: null },
      $push: { history: { action: 'reopened', at: now, ...actorOf(user), reason: why.slice(0, 500) } },
    }
  );
  if (!doc) throw new AppError('Only a locked or approved month can be re-opened', 409, { expose: true });
  await auditLogger.logAction(req, 'REOPEN', 'IncentiveMonth', month, { reason: why.slice(0, 500) });
  return doc;
}

/** Statements for a month: the snapshot if closed, live figures if open. */
export async function monthView(month, { earnerFilter = null } = {}) {
  const doc = await repo.monthDoc(month);
  if (doc && doc.status !== 'open') {
    const statements = earnerFilter ? doc.statements.filter((s) => matches(earnerFilter, s.earnerKey)) : doc.statements;
    return { month, status: doc.status, rulesVersion: doc.rulesVersion, statements, champion: doc.champion, lockedAt: doc.lockedAt, approvedAt: doc.approvedAt, history: doc.history, totalPayoutPaise: doc.totalPayoutPaise };
  }
  const { version, statements } = await computeStatements(month, { earnerFilter });
  return { month, status: 'open', rulesVersion: version, statements, champion: null, history: doc?.history || [], totalPayoutPaise: statements.reduce((a, s) => a + s.payoutPaise, 0) };
}

const matches = (filter, key) => (typeof filter === 'string' ? filter === key : (filter.$in || []).includes(key));

export async function listMonths({ limit = 24 } = {}) {
  return repo.listMonthDocs(Math.min(limit, 60));
}

/**
 * Ledger rows behind one person's month, newest first, cursor = last _id.
 * Shows order numbers and the inputs — no customer personal data.
 */
export async function statementRows(month, earnerKey, { cursor = null, limit = 100 } = {}) {
  const q = { month, earnerKey };
  if (cursor) {
    if (!mongoose.isValidObjectId(cursor)) throw new AppError('Invalid cursor', 400);
    q._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  }
  const size = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const rows = await repo.ledgerPage(q, 'type order orderNumber component lineId centi flatCenti reason eventAt rulesVersion inputs.valueExGst inputs.discountPercent inputs.discountKeep inputs.sourcingKeep inputs.specialSourcing inputs.isB2B inputs.label inputs.quantity inputs.fraction inputs.landedLate inputs.paidMonth inputs.earnMonth', size + 1);
  const more = rows.length > size;
  const page = more ? rows.slice(0, size) : rows;
  return { rows: page.map((r) => ({ ...r, points: r.centi / 100 })), nextCursor: more ? String(page[page.length - 1]._id) : null };
}

const CSV_HEADER = ['Month', 'Name', 'Earner ID', 'Orders', 'Returned orders', 'Ledger points', 'Return factor', 'Ratings', 'Average rating', 'Rating factor', 'Final points', 'Slab', 'Rs per point', 'Incentive (Rs)'];

/** Neutralise spreadsheet formula injection in a name. */
const cell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function exportCsv(month) {
  const doc = await repo.monthDoc(month);
  if (!doc || doc.status !== 'approved') throw new AppError('Approve the month before exporting it for payroll', 409, { expose: true });
  const lines = [CSV_HEADER.join(',')];
  for (const s of doc.statements) {
    lines.push([
      month, s.name, s.earnerKey, s.orders, s.returnedOrders, s.ledgerPoints, s.returnFactor, s.ratingCount,
      s.ratingAvg ?? '', s.ratingFactor, s.finalPoints, s.slab || 'None', s.ratePerPoint, (s.payoutPaise / 100).toFixed(2),
    ].map(cell).join(','));
  }
  lines.push(['', 'TOTAL', '', '', '', '', '', '', '', '', '', '', '', (doc.totalPayoutPaise / 100).toFixed(2)].map(cell).join(','));
  return lines.join('\r\n') + '\r\n';
}

/**
 * The champion to show in the staff banner: the previous month's, once it is
 * locked, during the first `championBannerDays` days of the month.
 */
export async function currentChampion(now = new Date()) {
  const month = addMonths(monthOf(now), -1);
  const doc = await repo.monthDocWhere({ month, status: { $in: ['locked', 'approved'] } }, 'month status champion');
  if (!doc?.champion) return null;
  const { rules } = await rulesForMonth(monthOf(now));
  const show = istDayOfMonth(now) <= (rules.championBannerDays || 7);
  return { month, status: doc.status, ...doc.champion, payout: doc.champion.payoutPaise / 100, showBanner: show };
}

/** Auto-lock the month that just ended. Called by cron on the 1st (IST). */
export async function closePreviousMonth(now = new Date()) {
  const month = addMonths(monthOf(now), -1);
  const doc = await repo.monthDoc(month, 'status history.action');
  if (doc && doc.status !== 'open') return null; // already closed
  // Re-opened by an admin: they re-lock it by hand when they are done.
  if (doc?.history?.some((h) => h.action === 'reopened')) return null;
  return lockMonth(month, { now });
}

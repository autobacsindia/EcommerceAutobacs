import express from 'express';
import mongoose from 'mongoose';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { protect, staffOrAdmin, admin } from '../middleware/authMiddleware.js';
import { authenticatedUserRateLimit } from '../middleware/rateLimitMiddleware.js';
import AppError from '../utils/AppError.js';
import auditLogger from '../services/auditLogger.js';
import { flagFor, changeFlag, ledgerForOrder } from '../repositories/incentiveRepository.js';
import { listVersions, saveVersion, rulesForMonth } from '../services/incentives/ruleService.js';
import {
  monthView, listMonths, lockMonth, approveMonth, reopenMonth, statementRows, exportCsv, currentChampion,
} from '../services/incentives/monthService.js';
import { processOrderById, runSweep } from '../services/incentives/ledgerService.js';
import { teamFilter, assertCanSee, selfKey } from '../services/incentives/access.js';
import { monthOf, isMonth } from '../services/incentives/months.js';
import { nextSlab } from '../services/incentives/pointsMath.js';
import { myOrders, myRatings, bonusOrderCount, excludedRatings } from '../services/incentives/myStatement.js';

/**
 * Roav Points (/api/v1/incentives). Staff and admins only; who sees whose
 * figures is decided in services/incentives/access.js on every call.
 */
const router = express.Router();
router.use(authenticatedUserRateLimit, protect, staffOrAdmin);
router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

const monthParam = (v) => {
  const m = v || monthOf(new Date());
  if (!isMonth(m)) throw new AppError('Month must look like 2026-11', 400, { expose: true });
  return m;
};
const earnerParam = (v) => {
  if (!/^[ur]:[a-f0-9]{24}$/i.test(String(v || ''))) throw new AppError('Invalid person', 400);
  return String(v);
};

/** The shape the sales board reads: my figures, the slabs, how far to the next one. */
async function personSummary(month, earnerKey) {
  const view = await monthView(month, { earnerFilter: earnerKey });
  const { rules } = await rulesForMonth(month);
  const s = view.statements[0] || null;
  const points = s?.finalPoints || 0;
  return {
    month, status: view.status, rulesVersion: view.rulesVersion,
    statement: s ? strip(s) : null,
    points, slab: s?.slab || null, payout: (s?.payoutPaise || 0) / 100,
    next: nextSlab(points, rules.slabs),
    slabs: rules.slabs,
    // The thresholds behind the multipliers, so a statement can say why.
    policy: {
      rating: rules.rating,
      returnRateThresholdPercent: rules.returnRateThresholdPercent,
      returnPenaltyMultiplier: rules.returnPenaltyMultiplier,
      perOrderBonus: rules.perOrderBonus,
      perOrderBonusMinValue: rules.perOrderBonusMinValue,
    },
  };
}
const strip = ({ centi: _c, flatCenti: _f, rows: _r, ...s }) => ({ ...s, payout: (s.payoutPaise || 0) / 100 });

// ── Everyone on staff ─────────────────────────────────────────────────────────

// GET /incentives/me?month=2026-11 — my month so far (or a closed month's snapshot)
router.get('/me', asyncHandler(async (req, res) => {
  const month = monthParam(req.query.month);
  const key = selfKey(req.user);
  const [summary, bonusOrders, ratingsExcluded] = await Promise.all([
    personSummary(month, key), bonusOrderCount(month, key), excludedRatings(month, key),
  ]);
  res.json({ success: true, ...summary, bonusOrders, ratingsExcluded });
}));

// GET /incentives/me/orders?month=&cursor= — my month order by order (team panel "My Roav Points").
// Always the caller's own figures: there is no person parameter.
router.get('/me/orders', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await myOrders(monthParam(req.query.month), selfKey(req.user), req.query)) });
}));

// GET /incentives/me/ratings?month= — my customers' stars/comments, only if the owner allows it
router.get('/me/ratings', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await myRatings(monthParam(req.query.month), selfKey(req.user))) });
}));

// GET /incentives/me/rows?month=&cursor= — the orders behind my month
router.get('/me/rows', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await statementRows(monthParam(req.query.month), selfKey(req.user), req.query)) });
}));

// GET /incentives/champion — last month's Incentive Champion (banner)
router.get('/champion', asyncHandler(async (req, res) => {
  res.json({ success: true, champion: await currentChampion() });
}));

// ── GTM head (their team) and admin (everyone) ───────────────────────────────

// GET /incentives/team?month= — everyone's month, ranked
router.get('/team', asyncHandler(async (req, res) => {
  const month = monthParam(req.query.month);
  const filter = await teamFilter(req.user);
  const view = await monthView(month, { earnerFilter: filter });
  const { rules } = await rulesForMonth(month);
  res.json({
    success: true, month, status: view.status, rulesVersion: view.rulesVersion,
    people: view.statements.map((s) => ({ ...strip(s), next: nextSlab(s.finalPoints, rules.slabs) })),
    champion: view.champion, slabs: rules.slabs,
    totalPayout: view.statements.reduce((a, s) => a + s.payoutPaise, 0) / 100,
  });
}));

// GET /incentives/people/:earnerKey?month= and /rows — one person's statement
router.get('/people/:earnerKey', asyncHandler(async (req, res) => {
  const key = earnerParam(req.params.earnerKey);
  await assertCanSee(req.user, key);
  res.json({ success: true, ...(await personSummary(monthParam(req.query.month), key)) });
}));
router.get('/people/:earnerKey/rows', asyncHandler(async (req, res) => {
  const key = earnerParam(req.params.earnerKey);
  await assertCanSee(req.user, key);
  res.json({ success: true, ...(await statementRows(monthParam(req.query.month), key, req.query)) });
}));

// ── Admin only ────────────────────────────────────────────────────────────────

router.get('/rules', admin, asyncHandler(async (req, res) => {
  const current = await rulesForMonth(monthOf(new Date()));
  res.json({ success: true, current, versions: await listVersions() });
}));

// POST /incentives/rules { rules, effectiveFrom?, note? } — a new version (next month or later)
router.post('/rules', admin, asyncHandler(async (req, res) => {
  const saved = await saveVersion(req.user, req.body || {});
  await auditLogger.logAction(req, 'CREATE', 'IncentiveRuleSet', saved.version, { effectiveFrom: saved.effectiveFrom, note: saved.note });
  res.status(201).json({ success: true, version: saved });
}));

router.get('/months', admin, asyncHandler(async (req, res) => {
  res.json({ success: true, months: await listMonths() });
}));

router.get('/months/:month', admin, asyncHandler(async (req, res) => {
  const view = await monthView(monthParam(req.params.month));
  res.json({
    success: true, ...view, statements: view.statements.map(strip), totalPayout: view.totalPayoutPaise / 100,
    champion: view.champion ? { ...view.champion, payout: view.champion.payoutPaise / 100 } : null,
  });
}));

router.post('/months/:month/lock', admin, asyncHandler(async (req, res) => {
  res.json({ success: true, month: await lockMonth(monthParam(req.params.month), { user: req.user, req }) });
}));
// Recompute a locked month's snapshot (the ledger moved after the lock).
router.post('/months/:month/recompute', admin, asyncHandler(async (req, res) => {
  res.json({ success: true, month: await lockMonth(monthParam(req.params.month), { user: req.user, req }) });
}));
router.post('/months/:month/approve', admin, asyncHandler(async (req, res) => {
  res.json({ success: true, month: await approveMonth(monthParam(req.params.month), { user: req.user, req }) });
}));
router.post('/months/:month/reopen', admin, asyncHandler(async (req, res) => {
  res.json({ success: true, month: await reopenMonth(monthParam(req.params.month), { user: req.user, reason: req.body?.reason, req }) });
}));

router.get('/months/:month/export.csv', admin, asyncHandler(async (req, res) => {
  const month = monthParam(req.params.month);
  const csv = await exportCsv(month);
  await auditLogger.logAction(req, 'EXPORT', 'IncentiveMonth', month, {});
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="roav-points-${month}.csv"` });
  res.send(csv);
}));

// GET /incentives/orders/:id — an order's flag and ledger rows
router.get('/orders/:id', admin, asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError('Invalid order', 400);
  const [flag, rows] = await Promise.all([
    flagFor(req.params.id), ledgerForOrder(req.params.id, 500),
  ]);
  res.json({ success: true, flag, rows: rows.map((r) => ({ ...r, points: r.centi / 100 })) });
}));

// PUT /incentives/orders/:id/flag { specialSourcing, note } — air-urgent / sub-dealer (75%)
router.put('/orders/:id/flag', admin, asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError('Invalid order', 400);
  if (typeof req.body?.specialSourcing !== 'boolean') throw new AppError('specialSourcing must be true or false', 400, { expose: true });
  const value = req.body.specialSourcing;
  const note = String(req.body.note || '').slice(0, 300);
  const before = await flagFor(req.params.id);
  if ((before?.specialSourcing ?? false) === value) return res.json({ success: true, flag: before, changed: false });
  let flag;
  try {
    // Bump the revision only when the value really changes; an unchanged value
    // hits the unique index on upsert and is a no-op.
    flag = await changeFlag(req.params.id, value, { note, setBy: req.user._id, setByName: req.user.name || '' });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    flag = await flagFor(req.params.id);
    return res.json({ success: true, flag, changed: false });
  }
  await auditLogger.logAction(req, 'UPDATE', 'IncentiveOrderFlag', req.params.id, { specialSourcing: value, rev: flag.rev, note });
  const result = await processOrderById(req.params.id);
  res.json({ success: true, flag, changed: true, ...result });
}));

// POST /incentives/sweep — run the points sweep now (it also runs on a timer)
router.post('/sweep', admin, asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await runSweep()) });
}));

export default router;

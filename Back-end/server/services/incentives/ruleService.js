/**
 * Roav Points rule versions: read the rules for a month, validate, save a new version.
 *
 * Invariant: a saved version is never edited, and a new version may only take
 * effect from NEXT month (IST) or later. So the rules any past or current month
 * was computed with can never change underneath it.
 */
import * as repo from '../../repositories/incentiveRepository.js';
import AppError from '../../utils/AppError.js';
import { INCENTIVE_DEFAULT_RULES } from '../../config/incentiveDefaults.js';
import { monthOf, addMonths, isMonth } from './months.js';

const FIRST_MONTH = '2000-01';

/** Version 1 = the approved defaults. Race-safe: the unique version index decides. */
export async function ensureSeeded() {
  const existing = await repo.ruleVersion(1);
  if (existing) return existing;
  try {
    return await repo.createRuleVersion({
      version: 1, effectiveFrom: FIRST_MONTH, rules: structuredClone(INCENTIVE_DEFAULT_RULES),
      note: 'Owner-approved defaults (policy PDF, 2026-11)', createdByName: 'system',
    });
  } catch (err) {
    if (err?.code === 11000) return repo.ruleVersion(1);
    throw err;
  }
}

/** { version, effectiveFrom, rules } governing `month`. */
export async function rulesForMonth(month) {
  if (!isMonth(month)) throw new AppError('Invalid month', 400);
  await ensureSeeded();
  const row = await repo.ruleForMonth(month);
  return { version: row.version, effectiveFrom: row.effectiveFrom, rules: row.rules };
}

/** Cache rules per month within one sweep/close run (they cannot change mid-month). */
export function rulesCache() {
  const memo = new Map();
  return (month) => {
    if (!memo.has(month)) memo.set(month, rulesForMonth(month));
    return memo.get(month);
  };
}

export async function listVersions() {
  await ensureSeeded();
  return repo.listRuleVersions(100);
}

const num = (v, name, { min = -Infinity, max = Infinity, integer = false } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new AppError(`${name} must be a number between ${min} and ${max}`, 400, { expose: true });
  }
  return n;
};

/** Validate and normalise a full rule set. Throws a 400 naming the bad field. */
export function validateRules(input) {
  if (!input || typeof input !== 'object') throw new AppError('Rules are required', 400, { expose: true });
  const r = {};
  r.basePointsPerRupee = num(input.basePointsPerRupee, 'Base points per rupee', { min: 0, max: 1 });
  r.gstRate = num(input.gstRate, 'GST rate', { min: 0, max: 1 });

  if (!Array.isArray(input.brackets) || !input.brackets.length || input.brackets.length > 12) {
    throw new AppError('Invoice multipliers need 1–12 rows', 400, { expose: true });
  }
  let prev = 0;
  r.brackets = input.brackets.map((b, i) => {
    const last = i === input.brackets.length - 1;
    const upTo = last ? null : num(b.upTo, `Multiplier row ${i + 1} upper limit`, { min: prev + 1 });
    if (upTo != null) prev = upTo;
    return { upTo, multiplier: num(b.multiplier, `Multiplier row ${i + 1}`, { min: 0, max: 10 }) };
  });

  if (!Array.isArray(input.discountKeep) || input.discountKeep.length < 2 || input.discountKeep.length > 10) {
    throw new AppError('Discount keep needs 2–10 rows', 400, { expose: true });
  }
  let prevPct = -1;
  r.discountKeep = input.discountKeep.map((t, i) => {
    const last = i === input.discountKeep.length - 1;
    const maxPercent = last ? null : num(t.maxPercent, `Discount row ${i + 1} limit`, { min: prevPct + (i === 0 ? 1 : 0.0001), max: 100 });
    if (maxPercent != null) prevPct = maxPercent;
    return { maxPercent, keep: num(t.keep, `Discount row ${i + 1} keep`, { min: 0, max: 1 }) };
  });
  if (r.discountKeep[0].maxPercent !== 0) throw new AppError('The first discount row must be "no discount" (0%)', 400, { expose: true });
  r.discountTolerancePercent = num(input.discountTolerancePercent ?? 0, 'Discount tolerance', { min: 0, max: 1 });
  r.b2bDealerDiscountPercent = num(input.b2bDealerDiscountPercent ?? 0, 'Dealer price discount', { min: 0, max: 90 });
  r.specialSourcingKeep = num(input.specialSourcingKeep, 'Special sourcing keep', { min: 0, max: 1 });
  r.perOrderBonus = num(input.perOrderBonus, 'Points per paid order', { min: 0, max: 100000 });
  r.perOrderBonusMinValue = num(input.perOrderBonusMinValue ?? 0, 'Minimum order value for the per-order points', { min: 0, max: 1e8 });

  if (!Array.isArray(input.priorityProducts) || input.priorityProducts.length > 50) {
    throw new AppError('Priority products must be a list (max 50)', 400, { expose: true });
  }
  const keys = new Set();
  r.priorityProducts = input.priorityProducts.map((p, i) => {
    const key = String(p.key || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40);
    if (!key || keys.has(key)) throw new AppError(`Priority product ${i + 1} needs a unique key`, 400, { expose: true });
    keys.add(key);
    const ids = Array.isArray(p.productIds) ? p.productIds.map(String) : [];
    if (ids.length > 200 || ids.some((id) => !/^[a-f0-9]{24}$/i.test(id))) {
      throw new AppError(`Priority product ${i + 1} has an invalid product`, 400, { expose: true });
    }
    return {
      key, label: String(p.label || key).slice(0, 80), productIds: [...new Set(ids)],
      b2c: num(p.b2c, `Priority product ${i + 1} B2C points`, { min: 0, max: 1e6 }),
      b2b: num(p.b2b, `Priority product ${i + 1} B2B points`, { min: 0, max: 1e6 }),
    };
  });
  const seen = new Set();
  for (const p of r.priorityProducts) for (const id of p.productIds) {
    if (seen.has(id)) throw new AppError('A product can be in only one priority group', 400, { expose: true });
    seen.add(id);
  }

  r.returnWindowDays = num(input.returnWindowDays, 'Return window', { min: 0, max: 365, integer: true });
  r.returnRateThresholdPercent = num(input.returnRateThresholdPercent, 'Return rate limit', { min: 0, max: 100 });
  r.returnPenaltyMultiplier = num(input.returnPenaltyMultiplier, 'Return penalty', { min: 0, max: 1 });
  const g = input.rating || {};
  r.rating = {
    minCount: num(g.minCount, 'Minimum ratings', { min: 1, max: 1000, integer: true }),
    highAvg: num(g.highAvg, 'High rating', { min: 1, max: 5 }),
    highMultiplier: num(g.highMultiplier, 'High rating multiplier', { min: 0, max: 3 }),
    lowAvg: num(g.lowAvg, 'Low rating', { min: 1, max: 5 }),
    lowMultiplier: num(g.lowMultiplier, 'Low rating multiplier', { min: 0, max: 3 }),
  };
  if (r.rating.lowAvg > r.rating.highAvg) throw new AppError('Low rating must be below high rating', 400, { expose: true });

  if (!Array.isArray(input.slabs) || !input.slabs.length || input.slabs.length > 12) {
    throw new AppError('Slabs need 1–12 rows', 400, { expose: true });
  }
  let prevMin = -1;
  const names = new Set();
  r.slabs = input.slabs.map((s, i) => {
    const name = String(s.name || '').trim().slice(0, 30);
    if (!name || names.has(name)) throw new AppError(`Slab ${i + 1} needs a unique name`, 400, { expose: true });
    names.add(name);
    const minPoints = num(s.minPoints, `Slab ${name} points`, { min: prevMin + 1, max: 1e9, integer: true });
    prevMin = minPoints;
    return { name, minPoints, ratePerPoint: num(s.ratePerPoint, `Slab ${name} rate`, { min: 0, max: 100 }) };
  });
  r.multiplierSlabCap = input.multiplierSlabCap ? String(input.multiplierSlabCap) : null;
  if (r.multiplierSlabCap && !names.has(r.multiplierSlabCap)) {
    throw new AppError('Multiplier cap must be one of the slab names', 400, { expose: true });
  }
  r.championBannerDays = num(input.championBannerDays ?? 7, 'Champion banner days', { min: 1, max: 28, integer: true });
  return r;
}

/**
 * Save a new rule version. `effectiveFrom` defaults to next month and may not be
 * earlier than next month.
 */
export async function saveVersion(user, { rules, effectiveFrom, note } = {}, now = new Date()) {
  const clean = validateRules(rules);
  const earliest = addMonths(monthOf(now), 1);
  const from = effectiveFrom || earliest;
  if (!isMonth(from)) throw new AppError('Start month must look like 2026-12', 400, { expose: true });
  if (from < earliest) {
    throw new AppError(`New rules can start from ${earliest} at the earliest, so no month already earning points changes`, 400, { expose: true });
  }
  await ensureSeeded();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const top = await repo.latestRuleVersion();
    try {
      return await repo.createRuleVersion({
        version: (top?.version || 0) + 1, effectiveFrom: from, rules: clean,
        note: String(note || '').slice(0, 500), createdBy: user?._id || null, createdByName: user?.name || '',
      });
    } catch (err) {
      if (err?.code !== 11000) throw err;
    }
  }
  throw new AppError('Could not save the rules, please try again', 409, { expose: true });
}

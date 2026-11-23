/**
 * Margin rules — the default and per-category target / floor margins used to
 * suggest prices and to warn below the floor. Procurement and the admin edit.
 *
 * Typed as percent (e.g. 30 or 27.5), stored as whole basis points. Rules:
 * 0–90%, target ≥ floor. Resolution (services/supplierPortal/marginRules.js):
 * the product's first category with a rule → default → built-in 30% / 10%.
 */
import auditLogger from '../auditLogger.js';
import marginRuleRepository, { marginRuleKey } from '../../repositories/marginRuleRepository.js';
import repo from '../../repositories/supplierPartnerAdminRepository.js';
import { DEFAULT_MARGIN_BP, DEFAULT_FLOOR_BP, MAX_MARGIN_BP } from '../../config/supplierPortal.js';
import { fail, guard, idOf, iso, requireId } from './shared.js';

function toBp(v, what) {
  const s = String(v ?? '').trim().replace(/%$/, '');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) throw fail(`${what}: enter a percent from 0 to 90, e.g. 30 or 27.5.`, 400);
  const [whole, frac = ''] = s.split('.');
  const bp = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (bp > MAX_MARGIN_BP) throw fail(`${what}: at most 90%.`, 400);
  return bp;
}

const view = (r, categoryName = '') => ({
  key: r.key,
  categoryId: idOf(r.category),
  categoryName,
  targetBp: r.targetBp,
  floorBp: r.floorBp,
  updatedByName: r.updatedByName || '',
  updatedAt: iso(r.updatedAt),
});

export async function get(actor) {
  guard(actor);
  const rows = await marginRuleRepository.listAll();
  const catIds = rows.filter((r) => r.category).map((r) => String(r.category));
  const cats = catIds.length ? await repo.findCategories(catIds) : [];
  const names = new Map(cats.map((c) => [String(c._id), c.name]));
  const def = rows.find((r) => r.key === 'default');
  return {
    builtIn: { targetBp: DEFAULT_MARGIN_BP, floorBp: DEFAULT_FLOOR_BP },
    default: def ? view(def) : null,
    categories: rows.filter((r) => r.key !== 'default').map((r) => view(r, names.get(String(r.category)) || '(deleted category)')),
  };
}

/** Set the default (no categoryId) or one category's rule. */
export async function set(actor, input = {}, req) {
  guard(actor);
  const categoryId = input.categoryId ? requireId(input.categoryId, 'category') : null;
  if (categoryId) {
    const [cat] = await repo.findCategories([categoryId]);
    if (!cat) throw fail('That category was not found.', 404);
  }
  const targetBp = toBp(input.targetPct, 'Target margin');
  const floorBp = toBp(input.floorPct, 'Lowest allowed margin');
  if (floorBp > targetBp) throw fail('The lowest allowed margin cannot be above the target margin.', 400);
  const key = marginRuleKey(categoryId);
  await marginRuleRepository.upsert(key, { category: categoryId, targetBp, floorBp, updatedBy: actor._id, updatedByName: actor.name || '' });
  auditLogger.logAction(req, 'SET_MARGIN_RULE', 'MarginRule', key, { targetBp, floorBp });
  return get(actor);
}

/** A category goes back to the default rule. */
export async function remove(actor, categoryId, req) {
  guard(actor);
  const key = marginRuleKey(requireId(categoryId, 'category'));
  await marginRuleRepository.deleteByKey(key);
  auditLogger.logAction(req, 'DELETE_MARGIN_RULE', 'MarginRule', key, {});
  return get(actor);
}

export default { get, set, remove };

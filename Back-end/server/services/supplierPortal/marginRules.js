/**
 * Which margin rule applies to a product — shared by the supplier side (a cost
 * change raises a price review with a suggestion) and the procurement side
 * (approval suggests a selling price). Procurement-only output: never send it
 * to a supplier.
 *
 * Precedence: the FIRST of the product's categories that has a rule → 'default'
 * row → DEFAULT_MARGIN_BP / DEFAULT_FLOOR_BP from config. One indexed $in read.
 */
import marginRuleRepository, { marginRuleKey } from '../../repositories/marginRuleRepository.js';
import { DEFAULT_MARGIN_BP, DEFAULT_FLOOR_BP } from '../../config/supplierPortal.js';

export async function resolveMarginRule(categoryIds = []) {
  const ids = (categoryIds || []).filter(Boolean).map(String);
  const keys = [...ids.map(marginRuleKey), marginRuleKey(null)];
  const rows = await marginRuleRepository.findByKeys(keys);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const k of keys) {
    const r = byKey.get(k);
    if (r) return { targetBp: r.targetBp, floorBp: r.floorBp, source: k };
  }
  return { targetBp: DEFAULT_MARGIN_BP, floorBp: DEFAULT_FLOOR_BP, source: 'built-in' };
}

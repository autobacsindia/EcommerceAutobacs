import { STOCK_STATUS } from './stockStatus.js';

/**
 * Pure stock-transition detection for the back-in-stock notification feature.
 * Kept dependency-free (no models/queues) so it's trivially unit-testable and
 * importable from ProductSchema hooks without an import cycle.
 */

/**
 * Snapshot the availability of a product doc: the parent status plus a per-variant
 * status map keyed by variant _id (as strings). Works on a Mongoose doc or a lean
 * object. Returns null for a missing doc (e.g. a create — nothing to recover from).
 *
 * @param {object|null} doc
 * @returns {{ parent: string, variants: Record<string,string> }|null}
 */
export function snapshotStock(doc) {
  if (!doc) return null;
  const variants = {};
  for (const v of doc.variants || []) {
    if (v && v._id) variants[v._id.toString()] = v.stock;
  }
  return { parent: doc.stock, variants };
}

/** A target is "recovered" when it went from out-of-stock to purchasable (in/low). */
function isRecovered(prev, next) {
  return prev === STOCK_STATUS.OUT && (next === STOCK_STATUS.IN || next === STOCK_STATUS.LOW);
}

/**
 * Diff two snapshots and return the fan-out targets that just became purchasable.
 * Each target is a variant _id string, or `null` for a simple product's whole-item
 * transition. Only true out → in/low edges qualify — no fire on new variants,
 * price-only edits, or in→low churn.
 *
 * A variable product is handled purely per-variant (it always has variants), so a
 * restock of one model never notifies shoppers waiting on a different one. A
 * simple product (no variants) uses the parent-level transition.
 *
 * @param {ReturnType<typeof snapshotStock>} before
 * @param {ReturnType<typeof snapshotStock>} after
 * @returns {Array<string|null>}
 */
export function diffRecoveredTargets(before, after) {
  if (!before || !after) return [];
  const targets = [];

  const hasVariants = Object.keys(after.variants).length > 0;

  // Simple product: whole-item transition (variantId = null).
  if (!hasVariants && isRecovered(before.parent, after.parent)) {
    targets.push(null);
  }

  // Variable product: each variant that recovered on its own.
  for (const [id, next] of Object.entries(after.variants)) {
    if (isRecovered(before.variants[id], next)) targets.push(id);
  }

  return targets;
}

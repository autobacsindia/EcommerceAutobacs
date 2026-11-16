/**
 * Size class (Small / Medium / Large / XL) — bulk setter, per-class list and the
 * admin-editable standard boxes. The single-product write lives in the product
 * editor's save (controllers/productImageController.js → applyShippingClass);
 * both follow the same rules in utils/shippingClass.js.
 *
 * Nothing here is charged: the class and its box feed a later shipping-fee
 * estimate. They are admin-only fields the storefront never renders, so a change
 * does not purge the public catalogue cache (same call as the SEO-review marker).
 */

import productRepository from '../repositories/productRepository.js';
import shippingClassConfigRepository from '../repositories/shippingClassConfigRepository.js';
import auditLogger from './auditLogger.js';
import AppError from '../utils/AppError.js';
import {
  BOXED_SHIPPING_CLASSES,
  DEFAULT_CLASS_BOXES,
  parseShippingClassInput,
  resolveShippingClass,
} from '../utils/shippingClass.js';
import { SHIPPING_SIZE_FIELDS, SHIPPING_SIZE_LIMITS } from '../utils/shippingSize.js';

export const MAX_BULK_SHIPPING_CLASS = 200;
export const MAX_SHIPPING_CLASS_PAGE = 100;

const fail = (message, status = 400) => new AppError(message, status, { expose: true });
const keyOf = (r) => `${r.shippingClass ?? ''}|${r.shippingClassSource ?? ''}`;

/**
 * Apply one class — or "Automatic" (follow each product's sizes) — to many products.
 * Only real changes are written and audited, so a repeat click is a no-op.
 *
 * @returns {{ requested, updated, unchanged, notFound: string[] }}
 */
export async function setProductsShippingClass(req, { productIds, shippingClass }) {
  const ids = [...new Set((productIds || []).map(String))];
  if (ids.length === 0) throw fail('Choose at least one product');
  if (ids.length > MAX_BULK_SHIPPING_CLASS) throw fail(`Choose at most ${MAX_BULK_SHIPPING_CLASS} products at a time`);

  let requested;
  try {
    requested = parseShippingClassInput(shippingClass);
  } catch {
    throw fail('Size class must be Small, Medium, Large, XL or Automatic');
  }
  if (requested === undefined) throw fail('Choose a size class');

  const products = await productRepository.findForShippingClassChange(ids);
  const foundIds = new Set(products.map((p) => String(p._id)));
  const notFound = ids.filter((id) => !foundIds.has(id));

  // "Automatic" can land each product on a different class, so group by target:
  // at most one update per (class, source) pair — five, whatever the batch size.
  const groups = new Map();
  const changes = [];
  for (const p of products) {
    const target = resolveShippingClass({ requested, current: p, sizes: p });
    if (keyOf(target) === keyOf(p)) continue;
    const k = keyOf(target);
    if (!groups.has(k)) groups.set(k, { target, ids: [] });
    groups.get(k).ids.push(p._id);
    changes.push({ product: String(p._id), name: p.name, from: p.shippingClass ?? null, to: target.shippingClass });
  }
  if (changes.length === 0) {
    return { requested: ids.length, updated: 0, unchanged: products.length, notFound };
  }

  let updated = 0;
  for (const { target, ids: groupIds } of groups.values()) {
    updated += await productRepository.setShippingClass(groupIds, target);
  }

  await auditLogger.logAction(
    req,
    'SHIPPING_CLASS_SET',
    'Product',
    changes.length === 1 ? changes[0].product : null,
    { to: requested, changes },
  );

  return { requested: ids.length, updated, unchanged: products.length - changes.length, notFound };
}

/** One keyset page of products in a class ('none' = not set yet). */
export async function listProductsByShippingClass({ shippingClass, cursor = null, limit = 50 } = {}) {
  const pageSize = Math.min(Math.max(1, Number(limit) || 50), MAX_SHIPPING_CLASS_PAGE);
  const rows = await productRepository.findByShippingClass({
    shippingClass: shippingClass === 'none' ? null : shippingClass,
    afterId: cursor,
    limit: pageSize + 1,
  });
  const hasMore = rows.length > pageSize;
  const products = hasMore ? rows.slice(0, pageSize) : rows;
  return { products, nextCursor: hasMore ? String(products[products.length - 1]._id) : null };
}

const toPlainBoxes = (boxes) => Object.fromEntries(BOXED_SHIPPING_CLASSES.map((c) => [
  c,
  Object.fromEntries(SHIPPING_SIZE_FIELDS.map((k) => [k, boxes?.[c]?.[k] ?? DEFAULT_CLASS_BOXES[c][k]])),
]));

/** The standard box per class. Never writes: a missing document reads as the defaults. */
export async function getClassBoxes() {
  const doc = await shippingClassConfigRepository.find();
  return { boxes: toPlainBoxes(doc?.boxes), updatedAt: doc?.updatedAt ?? null };
}

/** Parse one admin-typed box: four numbers inside the courier limits. */
function parseBox(cls, raw) {
  const out = {};
  for (const k of SHIPPING_SIZE_FIELDS) {
    const v = raw?.[k];
    const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN);
    const { min, max } = SHIPPING_SIZE_LIMITS[k];
    if (!Number.isFinite(n) || n < min || n > max) {
      throw fail(`${cls[0].toUpperCase()}${cls.slice(1)} box: ${k.replace(/(Kg|Cm)$/, '')} must be between ${min} and ${max}`);
    }
    out[k] = n;
  }
  return out;
}

/** Replace the standard boxes (all three sent together, so a save is never half-applied). */
export async function updateClassBoxes(req, rawBoxes) {
  const boxes = Object.fromEntries(BOXED_SHIPPING_CLASSES.map((c) => [c, parseBox(c, rawBoxes?.[c])]));
  const before = await getClassBoxes();
  const doc = await shippingClassConfigRepository.saveBoxes(boxes, req.user?._id);
  await auditLogger.logAction(req, 'SHIPPING_CLASS_BOXES', 'ShippingClassConfig', doc._id, { from: before.boxes, to: boxes });
  return { boxes: toPlainBoxes(doc.boxes), updatedAt: doc.updatedAt };
}

export default {
  setProductsShippingClass,
  listProductsByShippingClass,
  getClassBoxes,
  updateClassBoxes,
  MAX_BULK_SHIPPING_CLASS,
  MAX_SHIPPING_CLASS_PAGE,
};

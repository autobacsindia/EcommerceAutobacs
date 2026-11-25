/**
 * Delivery estimate per product, for the product page and the listing cards
 * ("Nothing Extra", 2026-11-23). The rule lives in utils/deliveryWindow.js; this
 * only loads what it needs. Display only: nothing here prices or commits anything.
 */
import productRepository from '../repositories/productRepository.js';
import { getCategoryIndex } from './deliveryFeeService.js';
import { classFromCategorySlugs, slugsWithAncestors } from '../utils/categoryShippingClass.js';
import { deliveryWindowFor, DELIVERY_WINDOWS } from '../utils/deliveryWindow.js';

/** Mirrors MAX_DELIVERY_ESTIMATE_IDS in Front-end/web/src/hooks/queries/useDeliveryEstimates.ts. */
export const MAX_DELIVERY_ESTIMATE_IDS = 60;

/**
 * @param {string[]} ids product ids (deduped, capped)
 * @returns {Promise<{ general: {minDays,maxDays}, products: Record<string, {minDays,maxDays,heavy}> }>}
 *   Unknown / inactive ids are simply absent; the caller shows nothing for them.
 */
export async function deliveryEstimates(ids) {
  const unique = [...new Set((Array.isArray(ids) ? ids : []).map((s) => String(s).trim()).filter(Boolean))]
    .slice(0, MAX_DELIVERY_ESTIMATE_IDS);
  const general = { ...DELIVERY_WINDOWS.general };
  if (!unique.length) return { general, products: {} };
  const [products, categoryIndex] = await Promise.all([
    productRepository.findDeliveryEstimateInputs(unique),
    getCategoryIndex(),
  ]);
  const out = {};
  for (const p of products) {
    out[String(p._id)] = deliveryWindowFor({
      shippingSize: p.shippingSize || null,
      listedSize: p.listedSize || null,
      shippingClass: p.shippingClass || null,
      categoryClass: classFromCategorySlugs(slugsWithAncestors(p.categories || [], categoryIndex)),
    });
  }
  return { general, products: out };
}

export default { deliveryEstimates, MAX_DELIVERY_ESTIMATE_IDS };

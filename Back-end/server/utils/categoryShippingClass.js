/**
 * Size class guessed from a product's CATEGORY — the fallback for a product that has
 * no measured box, no online-listed size and no stored class.
 *
 * Why it exists: on 2026-11-17 no live product had a size yet, so every cart was
 * priced as a ½ kg parcel (a ₹5,05,000 conversion kit to Kochi: ₹320 shipping). A
 * product's category is the best signal we always have: a body kit ships in a crate,
 * a filter in a pouch. Real sizes (shippingSize / listedSize / shippingClass) always
 * win over this; it only fills the gap.
 *
 * Matching: each rule lists category-slug KEYWORDS; a product matches a class when any
 * of its category slugs (or their parents' — "body-kits/conversion-kit") contains one.
 * A product in several categories takes the BIGGEST class it matches ("exterior" +
 * "conversion-kit" → XL): under-packing a crate is the costlier mistake, and the box
 * still has to physically fit the part. No match → `DEFAULT_CATEGORY_CLASS`.
 *
 * A keyword starting with "=" must equal the slug exactly.
 * Slugs come from the live catalogue (245 categories, Nov 2026). Matching is by
 * substring so "side-step", "side-steps", "electric-side-steps" share one keyword.
 */

const RULES = Object.freeze([
  Object.freeze({
    cls: 'xl',
    keywords: Object.freeze([
      'body-kit', 'conversion-kit', 'facelift', 'skirting-kit', 'bumper', 'bumber', 'bullbar', 'bull-bar',
      'roll-bar', 'roll-cage', 'sports-bar', 'canopy', 'roof-top-tent', 'roller-shutter', 'hard-top',
      'convertible-soft-top', 'bed-rack',
    ]),
  }),
  Object.freeze({
    cls: 'large',
    keywords: Object.freeze([
      'side-step', 'quick-step', 'foot-step', 'bonnet', 'hood', 'spoiler', 'diffuser', 'splitter', 'tailgate',
      'suspension', 'lift-kit', 'leveling-kit', 'coilover', 'coil-spring', 'shock-absorber', 'roof-carrier',
      'roof-rack', 'roof-rail', 'roof-box', 'cross-bar', 'ladder', 'awning', 'winch', 'snorkel', 'fender',
      'flare', 'grill', 'body-parts', 'underbody', 'rock-slider', 'fridge', 'refrigerator', 'recliner-seat',
      '=seat', 'brake-kit', 'exhaust', 'intercooler', 'tow-bar', 'rear-bar', 'lunar-carrier', 'door-cladding',
      'wheel-arch', 'tonneau', 'bed-liner', 'mud-tracks', 'reco-traks', 'recovory-boards', 'storage-box',
    ]),
  }),
  Object.freeze({
    cls: 'small',
    keywords: Object.freeze([
      'filter', 'key-case', 'keycase', 'snatch-strap', 'snatch-rope', 'strap', 'shackle', 'wiring',
      'harness', 'light-mount-clamp', 'bonnet-light-mount', 'gear-knob', 'bulb', 'tyre-deflator',
      'tyre-repair', 'wheel-lock-nuts', 'care-decor', 'door-switch', 'grab-handle',
    ]),
  }),
]);

/** No category rule matched: a mid-size parcel, never the ½ kg minimum. */
export const DEFAULT_CATEGORY_CLASS = 'medium';

const RANK = Object.freeze({ small: 0, medium: 1, large: 2, xl: 3 });

/** Class of ONE slug, or null when no rule matches. Bigger classes are tried first. */
function classOfSlug(slug) {
  const s = String(slug || '').toLowerCase();
  if (!s) return null;
  // "=slug" matches that slug exactly ("=seat" is a car seat, not "seat-cover").
  const hit = RULES.find((r) => r.keywords.some((k) => (k.startsWith('=') ? s === k.slice(1) : s.includes(k))));
  return hit ? hit.cls : null;
}

/**
 * The size class for a set of category slugs (a product's categories plus their
 * ancestors). Biggest matching class wins; nothing matches → DEFAULT_CATEGORY_CLASS.
 *
 * Small loses to any larger match, and a product whose only match is "small" stays
 * small: "accessories/filter" → small, "performance/air-filters" + "performance" → small.
 *
 * @param {string[]} slugs
 * @returns {'small'|'medium'|'large'|'xl'}
 */
export function classFromCategorySlugs(slugs) {
  let best = null;
  for (const slug of Array.isArray(slugs) ? slugs : []) {
    const cls = classOfSlug(slug);
    if (cls && (best == null || RANK[cls] > RANK[best])) best = cls;
  }
  return best || DEFAULT_CATEGORY_CLASS;
}

/**
 * Slugs for category ids, each with its ancestors' slugs (a subcategory such as
 * "conversion-kit" inherits "body-kits"). `index` maps id → { slug, parent }.
 *
 * @param {Array<string|object>} categoryIds
 * @param {Map<string, {slug:string, parent:string|null}>} index
 * @returns {string[]}
 */
export function slugsWithAncestors(categoryIds, index) {
  const out = new Set();
  for (const id of Array.isArray(categoryIds) ? categoryIds : []) {
    let cur = index.get(String(id));
    for (let depth = 0; cur && depth < 8; depth += 1) { // depth guard: a parent cycle can't loop
      if (cur.slug) out.add(cur.slug);
      cur = cur.parent ? index.get(String(cur.parent)) : null;
    }
  }
  return [...out];
}

export default { classFromCategorySlugs, slugsWithAncestors, DEFAULT_CATEGORY_CLASS };

/**
 * Brand resolution — shared by the brand sync and the WordPress importer so a
 * product always gets the same brand from the same inputs.
 *
 * Order: WP brands taxonomy → parts-manufacturer title aliases → car-make title
 * aliases → optional house fallback. Manufacturers are tried before makes so
 * "Toyota Hilux Brembo Brake Kit" resolves to Brembo, not Toyota.
 */
import { BRANDS, EXCLUDE_WP_SLUGS, HOUSE_FALLBACK } from '../brand-config.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole-word-ish: alias must be bounded by a non-alphanumeric char (or string
// edge), so "bat" doesn't match "battery" and "warn" doesn't match "warning".
function titleHasAlias(title, alias) {
  return new RegExp(`(^|[^a-z0-9])${escapeRe(alias)}([^a-z0-9]|$)`, 'i').test(title);
}

const bySlug = new Map(BRANDS.map((b) => [b.slug, b]));
const byWpSlug = new Map();
for (const b of BRANDS) for (const w of b.wpSlugs || []) byWpSlug.set(w, b);

const MANUFACTURERS = BRANDS.filter((b) => b.type === 'manufacturer');
const MAKES = BRANDS.filter((b) => b.type === 'make' || b.type === 'house');
const EXCLUDED = new Set(EXCLUDE_WP_SLUGS);

/**
 * @param {string} title           product title
 * @param {string[]} wpBrandSlugs  slugs from the product's WP `brands` array
 * @returns {{entry:object, via:'wp'|'manufacturer'|'make'|'house'}|null}
 */
export function resolveBrand(title = '', wpBrandSlugs = []) {
  for (const s of wpBrandSlugs) {
    if (EXCLUDED.has(s)) continue;
    const e = byWpSlug.get(s);
    if (e) return { entry: e, via: 'wp' };
  }
  const t = (title || '').toLowerCase();
  for (const b of MANUFACTURERS) for (const a of b.aliases) if (titleHasAlias(t, a)) return { entry: b, via: 'manufacturer' };
  for (const b of MAKES) for (const a of b.aliases) if (titleHasAlias(t, a)) return { entry: b, via: 'make' };
  if (HOUSE_FALLBACK && bySlug.has(HOUSE_FALLBACK)) return { entry: bySlug.get(HOUSE_FALLBACK), via: 'house' };
  return null;
}

export { BRANDS };

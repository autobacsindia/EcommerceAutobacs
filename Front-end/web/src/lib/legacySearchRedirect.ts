/**
 * Where a dead legacy slug should send the visitor: a product search for its words.
 *
 * Google, ads and old WhatsApp shares still carry hundreds of WooCommerce-era URLs
 * whose pages no longer exist — product-tag archives under /model/<tag> (570 of
 * them in the Sep 2026 Search Console export) and products that were since renamed.
 * A 404 there strands a customer who clicked an old link; a search for the same
 * words usually lands them on the product they wanted.
 *
 * Only call this once the slug is DEFINITELY unknown (the API answered 404). A
 * failed lookup must not redirect: the redirect is permanent and would be cached
 * for a page that really exists.
 */

/** Slug → search words. WordPress de-duplicated slugs with "-2"/"-3"; drop that. */
export function slugToSearchWords(slug: string): string {
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // Malformed escape sequence — use the raw slug.
  }
  const words = decoded
    .toLowerCase()
    .split(/[-_\s]+/)
    .filter(Boolean);
  if (words.length > 1 && /^\d{1,2}$/.test(words[words.length - 1])) words.pop();
  return words.join(' ').slice(0, 100).trim();
}

/** Product search path for a dead slug; the listing root when nothing usable remains. */
export function legacySearchPath(slug: string): string {
  const q = slugToSearchWords(slug);
  return q ? `/products/search?q=${encodeURIComponent(q)}` : '/products';
}

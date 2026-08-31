/**
 * Pure helpers shared by the search layer.
 *
 * Extracted from services/elasticsearchService.js during the Atlas Search
 * migration. They were static/instance members of the Elasticsearch service, so
 * the Atlas adapter had to import the Elasticsearch singleton purely to reach
 * two pure functions — a dependency that made no sense and blocked retiring the
 * old engine. Neither function has anything to do with Elasticsearch.
 */

/**
 * Normalize a product's `images` field into the canonical array shape the
 * frontend/API contract expects: [{ url, alt, isPrimary }]. Accepts the Mongoose
 * array form, a legacy single-string URL, or null/undefined. Returns [] when
 * there is no usable image.
 */
export function normalizeImages(images, productName = '') {
  if (Array.isArray(images)) {
    return images
      .filter((img) => img && (typeof img === 'string' ? img : img.url))
      .map((img) =>
        typeof img === 'string'
          ? { url: img, alt: productName, isPrimary: false }
          : { url: img.url, alt: img.alt || productName, isPrimary: !!img.isPrimary }
      );
  }
  if (typeof images === 'string' && images.trim() !== '') {
    return [{ url: images, alt: productName, isPrimary: true }];
  }
  return [];
}

/**
 * Clamp and clean free-text search input.
 *
 * 1. Length — capped at 200 chars, which comfortably covers real product search
 *    intent while bounding the work a single query can demand.
 * 2. Control characters — null bytes and ASCII control chars (0x00-0x1F, 0x7F)
 *    can break query parsing and produce unpredictable behaviour.
 */
export function sanitizeQuery(input, maxLength = 200) {
  if (typeof input !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, maxLength).trim();
}

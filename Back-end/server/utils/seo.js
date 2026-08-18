import SeoSchema from '../models/shared/seoSchema.js';

/**
 * Shared SEO normalization. Used by any controller that accepts a `seo`
 * sub-document (product, brand, category, article, job posting, page SEO) so
 * the rules stay in one place.
 *
 * Rules:
 *  - Only known keys are kept (ignore anything the client tacks on).
 *  - Text fields are trimmed, stripped of angle brackets (meta fields are
 *    plain text — never HTML), and hard-capped to the schema maxlengths.
 *  - URL fields (canonical, ogImage) must look like an absolute http(s) URL or
 *    a site-relative path; anything else is dropped rather than stored.
 *  - `noindex` is coerced to a real boolean.
 *  - Empty/blank fields are removed so an empty override never shadows the
 *    frontend's computed default.
 *
 * CONTRACT: whatever this returns MUST validate against SeoSchema. It is the
 * only guard between an admin's free-typed input and the model, and the update
 * path (findByIdAndUpdate + runValidators) surfaces a schema breach as an
 * opaque `ValidationError: Validation Error` that names no field in the logs.
 *
 * That is exactly what happened: the caps were hand-copied into a literal here
 * and `canonical` drifted (1000 here vs. 500 in the schema), so a pasted
 * >500-char canonical passed the normalizer and died at the schema — leaving the
 * admin unable to save the product with no indication of which field was at
 * fault. So the caps are READ OFF THE SCHEMA rather than restated: editing a
 * maxlength in seoSchema.js now moves this guard with it, and the two cannot
 * drift again.
 */

/** Read a field's maxlength straight off the schema — never restate it here. */
const capOf = (field) => {
  const cap = SeoSchema.path(field)?.options?.maxlength;
  if (typeof cap !== 'number') {
    // A renamed/removed schema path would otherwise silently disable the cap
    // and hand an over-long value to the validator.
    throw new Error(`[normalizeSeo] SeoSchema has no maxlength for "${field}"`);
  }
  return cap;
};

const CAPS = {
  metaTitle:       capOf('metaTitle'),
  metaDescription: capOf('metaDescription'),
  focusKeyword:    capOf('focusKeyword'),
  canonical:       capOf('canonical'),
  ogImage:         capOf('ogImage'),
};

const stripTags = (s) => String(s).replace(/<[^>]*>/g, '');

const cleanText = (value, cap) => {
  if (typeof value !== 'string') return undefined;
  const out = stripTags(value).replace(/\s+/g, ' ').trim().slice(0, cap);
  return out.length ? out : undefined;
};

// URLs are DROPPED when they breach the cap, not truncated. Half a URL is not a
// shorter URL — a sliced canonical would emit <link rel="canonical"> pointing at
// a route that doesn't exist, actively telling Google the wrong canonical. Blank
// canonicalises the page to itself, which is the safe fallback. (Text meta fields
// above are still truncated: half a title is a worse title, not a wrong one.)
const cleanUrl = (value, cap) => {
  if (typeof value !== 'string') return undefined;
  const out = value.trim();
  if (!out) return undefined;
  // Absolute http(s) or site-relative path only — blocks javascript:/data: etc.
  if (!/^https?:\/\//i.test(out) && !out.startsWith('/')) return undefined;
  if (out.length > cap) return undefined;
  return out;
};

export function normalizeSeo(raw) {
  // Tolerate a JSON-string payload (multipart/form-data fields arrive as
  // strings) so multipart and JSON callers can both pass `seo` straight in.
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return {}; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const seo = {};
  const metaTitle = cleanText(raw.metaTitle, CAPS.metaTitle);
  const metaDescription = cleanText(raw.metaDescription, CAPS.metaDescription);
  const focusKeyword = cleanText(raw.focusKeyword, CAPS.focusKeyword);
  const canonical = cleanUrl(raw.canonical, CAPS.canonical);
  const ogImage = cleanUrl(raw.ogImage, CAPS.ogImage);

  if (metaTitle) seo.metaTitle = metaTitle;
  if (metaDescription) seo.metaDescription = metaDescription;
  if (focusKeyword) seo.focusKeyword = focusKeyword;
  if (canonical) seo.canonical = canonical;
  if (ogImage) seo.ogImage = ogImage;

  // Only persist noindex when explicitly truthy; default (false) is the schema
  // default and need not be stored.
  if (raw.noindex === true || raw.noindex === 'true') seo.noindex = true;

  return seo;
}

/** The effective caps, exported so tests and callers can assert against them. */
export const SEO_FIELD_CAPS = Object.freeze({ ...CAPS });

export default normalizeSeo;

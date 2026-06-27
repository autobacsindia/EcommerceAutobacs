/**
 * Shared SEO normalization. Used by any controller that accepts a `seo`
 * sub-document (products today; blog/category/pages next) so the rules stay in
 * one place.
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
 */

const TEXT_CAPS = { metaTitle: 70, metaDescription: 200, focusKeyword: 100 };

const stripTags = (s) => String(s).replace(/<[^>]*>/g, '');

const cleanText = (value, cap) => {
  if (typeof value !== 'string') return undefined;
  const out = stripTags(value).replace(/\s+/g, ' ').trim().slice(0, cap);
  return out.length ? out : undefined;
};

const cleanUrl = (value) => {
  if (typeof value !== 'string') return undefined;
  const out = value.trim();
  if (!out) return undefined;
  // Absolute http(s) or site-relative path only — blocks javascript:/data: etc.
  return /^https?:\/\//i.test(out) || out.startsWith('/') ? out.slice(0, 1000) : undefined;
};

export function normalizeSeo(raw) {
  // Tolerate a JSON-string payload (multipart/form-data fields arrive as
  // strings) so multipart and JSON callers can both pass `seo` straight in.
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return {}; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const seo = {};
  const metaTitle = cleanText(raw.metaTitle, TEXT_CAPS.metaTitle);
  const metaDescription = cleanText(raw.metaDescription, TEXT_CAPS.metaDescription);
  const focusKeyword = cleanText(raw.focusKeyword, TEXT_CAPS.focusKeyword);
  const canonical = cleanUrl(raw.canonical);
  const ogImage = cleanUrl(raw.ogImage);

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

export default normalizeSeo;

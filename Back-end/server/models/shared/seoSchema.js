import mongoose from "mongoose";

/**
 * Reusable, embeddable SEO sub-document.
 *
 * Design: every field is an OPTIONAL override. When a field is blank the
 * frontend computes a sensible default from the parent entity (product name,
 * article title, etc.). This is what lets a brand-new product/blog be fully
 * indexable the instant it is saved — without any admin SEO step — while still
 * allowing per-page overrides on high-value pages.
 *
 * `_id: false` — this is always embedded, never queried on its own, so it
 * doesn't need its own ObjectId.
 *
 * NOTE ON `focusKeyword`: kept purely as an INTERNAL authoring note (parity with
 * Yoast/WooCommerce). It is never rendered to HTML and Google ignores the meta
 * keywords tag for ranking — so it must NOT be emitted into <head>.
 *
 * maxlength values are HARD caps that mirror the admin SeoPanel input limits.
 * The "ideal" SERP lengths (~60 title / ~155 description) are surfaced as soft
 * guidance in the UI, not enforced here, so admins are never blocked by a few
 * extra characters.
 */
const SeoSchema = new mongoose.Schema(
  {
    metaTitle:       { type: String, trim: true, maxlength: 70 },
    metaDescription: { type: String, trim: true, maxlength: 200 },
    // Absolute canonical URL override. Blank => page canonicalises to itself.
    canonical:       { type: String, trim: true, maxlength: 500 },
    // Social-share image override. Blank => entity's primary/cover image.
    ogImage:         { type: String, trim: true, maxlength: 1000 },
    // Keep this page out of the index (thin/duplicate/internal pages).
    noindex:         { type: Boolean, default: false },
    // Internal-only authoring aid. NEVER rendered. NOT used for ranking.
    focusKeyword:    { type: String, trim: true, maxlength: 100 },
  },
  { _id: false }
);

export default SeoSchema;

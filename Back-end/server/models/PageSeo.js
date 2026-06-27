import mongoose from "mongoose";
import SeoSchema from "./shared/seoSchema.js";

/**
 * Per-route SEO for static, entity-less pages (careers, contact, about, legal,
 * etc.) — the pages that have no Product/Article behind them to derive metadata
 * from. Keyed by the public route `path` (e.g. "/careers").
 *
 * The catalogue of known paths lives in config/staticPages.js (which also holds
 * the human label + computed-default copy). This collection only stores the
 * admin's overrides, embedded as the same reusable `seo` sub-document used by
 * Product/Article so the admin SeoPanel and normalizeSeo() work unchanged.
 */
const PageSeoSchema = new mongoose.Schema(
  {
    path: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    seo: { type: SeoSchema, default: () => ({}) },
    // Who last edited this row — for the admin audit trail.
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// Note: the unique index on `path` is declared inline via `unique: true` above.

export default mongoose.model("PageSeo", PageSeoSchema);

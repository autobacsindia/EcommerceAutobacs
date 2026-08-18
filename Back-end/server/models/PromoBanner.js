import mongoose from "mongoose";

/**
 * PromoBanner — the site-wide occasion strip (Onam, Diwali, New Year sale).
 *
 * Deliberately NOT part of Campaign. A Campaign owns money: who qualifies, what
 * percentage, capped at what, and it prices a managed Coupon. This owns an image
 * and a link. Keeping them apart means marketing can swap the Onam artwork at
 * 6am without touching anything that can change what a customer is charged.
 *
 * Several banners may exist at once (next month's festival prepared in advance);
 * exactly one renders. Which one is decided in ONE place —
 * services/promoBannerService.js resolveActiveBanner() — never re-derived here.
 * A second copy of that rule on the model is how the two drift apart.
 */

const PromoBannerSchema = new mongoose.Schema({
  /** Admin-facing label only ("Onam 2026"). Never rendered on the storefront. */
  title: { type: String, required: true, trim: true, maxlength: 120 },

  // ── Artwork (uploaded browser → Cloudinary via routes/uploads.js) ───────────
  // publicId is stored alongside every URL so replacing or deleting a banner can
  // delete the asset it orphans. Storing only the URL is what left dead images
  // in Cloudinary on the product gallery.
  /**
   * DESKTOP artwork (≥1024px viewports) and the fallback for every other size.
   *
   * Kept on the original flat `image*` field names rather than moved into a
   * subdocument: banners already exist in test/prod on these fields, and a
   * cosmetic rename would cost a migration and re-uploads for nothing.
   */
  imageUrl: { type: String, required: true, trim: true },
  imagePublicId: { type: String, trim: true, default: null },

  /**
   * Intrinsic pixel dimensions, captured from the Cloudinary upload response,
   * so the admin can warn about under-sized artwork before it ships. The strip
   * renders at a FIXED height per breakpoint, so these are diagnostics rather
   * than layout inputs.
   */
  imageWidth: { type: Number, default: null, min: 1 },
  imageHeight: { type: Number, default: null, min: 1 },

  /**
   * TABLET artwork (640–1023px). Optional — falls back to desktop.
   */
  tabletImageUrl: { type: String, trim: true, default: null },
  tabletImagePublicId: { type: String, trim: true, default: null },
  tabletImageWidth: { type: Number, default: null, min: 1 },
  tabletImageHeight: { type: Number, default: null, min: 1 },

  /**
   * MOBILE artwork (<640px). Optional — falls back to desktop.
   *
   * This is the slot that actually matters: a desktop strip is ~18:1, and
   * squeezed onto a phone it becomes an unreadable sliver. A separate, much
   * less wide crop with fewer words is the only way the campaign reads on the
   * majority of the traffic.
   */
  mobileImageUrl: { type: String, trim: true, default: null },
  mobileImagePublicId: { type: String, trim: true, default: null },
  mobileImageWidth: { type: Number, default: null, min: 1 },
  mobileImageHeight: { type: Number, default: null, min: 1 },

  /**
   * Required, not optional. The banner is a link whose entire message lives
   * inside an image, so with no alt text a screen-reader user gets a bare
   * anchor. This is the only copy such a user receives.
   */
  alt: { type: String, required: true, trim: true, maxlength: 200 },

  /**
   * Click destination. Same-site relative path only — validated again at the
   * route (validators/promoBanner.validator.js). An admin-editable field that
   * reaches an href is an open-redirect vector if it may hold an absolute URL.
   */
  linkPath: { type: String, trim: true, default: "/offers" },

  // ── Scheduling ─────────────────────────────────────────────────────────────
  /** Master switch. Off by default so an in-progress upload is never live. */
  isActive: { type: Boolean, default: false, index: true },
  /** null = no bound. Both are inclusive-from / exclusive-to at resolve time. */
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },

  /** Tie-break when two banners are live at once. Higher wins. */
  priority: { type: Number, default: 0 },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

/**
 * Serves resolveActiveBanner(): filter on isActive + the date window, then take
 * the highest priority / newest.
 *
 * NOT a TTL index, and `endsAt` must never become one. A TTL here would DELETE
 * the banner document when the campaign ended — the artwork and its settings are
 * wanted next year. Expiry means "stop rendering", never "destroy the record".
 */
PromoBannerSchema.index({ isActive: 1, startsAt: 1, endsAt: 1, priority: -1, createdAt: -1 });

export default mongoose.model("PromoBanner", PromoBannerSchema);

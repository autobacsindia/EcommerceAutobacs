import mongoose from "mongoose";
import SeoSchema from "./shared/seoSchema.js";

/**
 * JobPosting — one open seat on the /careers page.
 *
 * Replaces the hardcoded `rv-role-card` blocks that used to live in the frontend
 * MARKUP string: the same shape (department eyebrow, title, tagline, experience
 * tag, "what you'll own" / "what we need" bullets, the red "why this matters"
 * closer) now lives in the database so a role can be added or edited from the
 * admin without a code change + redeploy.
 *
 * SEO-backed like Article: the `seo` sub-doc is an optional override; blank
 * fields fall back to title/tagline on the frontend, so a role is indexable the
 * moment it is published. Emits JobPosting JSON-LD (Google Jobs) on its own page.
 */
const JobPostingSchema = new mongoose.Schema(
  {
    // Eyebrow label above the title, e.g. "Marketing", "Business Development".
    department: { type: String, required: true, trim: true, maxlength: 80 },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },

    // One-line hook under the title, e.g. "Own the story. Own the growth."
    tagline: { type: String, trim: true, maxlength: 200, default: "" },
    // Free-text experience chip, e.g. "3-5 years exp".
    experience: { type: String, trim: true, maxlength: 60, default: "" },

    // Intro paragraph shown when the card is expanded.
    intro: { type: String, trim: true, maxlength: 1000, default: "" },
    // "What you'll own" bullets.
    responsibilities: [{ type: String, trim: true, maxlength: 500 }],
    // "What we need" bullets.
    requirements: [{ type: String, trim: true, maxlength: 500 }],
    // The red-bordered closing line ("why this matters").
    closer: { type: String, trim: true, maxlength: 600, default: "" },

    // Optional structured fields for Google Jobs JSON-LD (blank => omitted).
    location: { type: String, trim: true, maxlength: 120, default: "" },
    employmentType: {
      type: String,
      enum: ["FULL_TIME", "PART_TIME", "CONTRACTOR", "INTERN", "TEMPORARY"],
      default: "FULL_TIME",
    },

    // draft  — not shown publicly (work in progress)
    // open   — live on /careers and selectable in the apply form
    // closed — role paused/withdrawn (hidden, kept for history)
    // filled — hired (hidden, kept for history)
    status: {
      type: String,
      enum: ["draft", "open", "closed", "filled"],
      default: "draft",
      index: true,
    },

    // Ascending display order on the page; new roles sort to the end.
    sortOrder: { type: Number, default: 0 },

    seo: { type: SeoSchema, default: () => ({}) },

    publishedAt: { type: Date },
  },
  { timestamps: true }
);

// Public list query: open roles in display order.
JobPostingSchema.index({ status: 1, sortOrder: 1, createdAt: 1 });

// Stamp publishedAt the first time a role goes open.
JobPostingSchema.pre("save", function (next) {
  if (this.isModified("status") && this.status === "open" && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  next();
});

export default mongoose.model("JobPosting", JobPostingSchema);

import mongoose from "mongoose";

// External press / media coverage cards rendered on the public /media page.
// Each card links OUT to a third-party publication (Business Standard, ThePrint, …),
// so unlike Article it has no internal slug/content/views — just display fields.
const PressCoverageSchema = new mongoose.Schema(
  {
    publication: { type: String, required: true, trim: true },   // e.g. "Business Standard"
    date: { type: String, trim: true, default: "" },             // display string, e.g. "MAR 2, 2026"
    headline: { type: String, required: true, trim: true },
    excerpt: { type: String, maxlength: 600, default: "" },
    url: { type: String, required: true, trim: true },           // external article link
    image: { type: String, default: "" },                        // poster / clipping image

    // Presentation hints (optional — the page auto-alternates when unset).
    tilt: { type: Number, default: null, min: -5, max: 5 },
    tape: { type: String, enum: ["", "left", "center", "right"], default: "" },

    order: { type: Number, default: 0 },                         // manual ordering (asc)
    featured: { type: Boolean, default: false },
    status: { type: String, enum: ["draft", "published"], default: "published" },
  },
  { timestamps: true }
);

// Public listing order: featured first, then manual order, then newest.
PressCoverageSchema.index({ status: 1, featured: -1, order: 1, createdAt: -1 });

export default mongoose.model("PressCoverage", PressCoverageSchema);

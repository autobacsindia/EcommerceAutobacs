import mongoose from "mongoose";

/**
 * CareerCategory — the managed vocabulary + display order for the sections that
 * group roles on the /careers page (e.g. "Leadership / Executive", "Growth").
 *
 * A JobPosting still stores its category as a plain `name` STRING (the public
 * page groups roles by that string), so this collection is NOT a foreign key —
 * it is the source of truth for which categories exist, their section order,
 * and safe rename/delete:
 *   - renaming a category cascades to every posting that uses the old name
 *     (see careerCategoryController.updateCategory);
 *   - deleting one is blocked while any posting still references it.
 *
 * Keeping the reference as a string avoids migrating existing postings and
 * keeps the public API shape unchanged, while still giving the admin a real
 * add / rename / reorder / delete surface.
 */
const CareerCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Ascending section order on the public /careers page; new categories append.
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Case-insensitive uniqueness on name so "Growth" and "growth" can't coexist
// as two separate sections. strength:2 = case/diacritic-insensitive compare.
CareerCategorySchema.index(
  { name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

// Admin list + section-order lookups.
CareerCategorySchema.index({ sortOrder: 1, name: 1 });

export default mongoose.model("CareerCategory", CareerCategorySchema);

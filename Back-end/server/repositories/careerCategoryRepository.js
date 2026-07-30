import CareerCategory from '../models/CareerCategory.js';
import JobPosting from '../models/JobPosting.js';
import { generateUniqueSlug } from '../utils/slug.js';

/**
 * CareerCategory data access. Passthrough to the model (same style as
 * jobPostingRepository) plus intent-named helpers so the controller never has
 * to import the models directly (repo-pattern eslint rule).
 *
 * `countPostingsUsing` / `renamePostingsCategory` bridge to JobPosting because
 * postings reference a category by NAME string — this repo owns that coupling
 * so the controller stays model-free.
 */
const CI = { collation: { locale: 'en', strength: 2 } }; // case-insensitive

class CareerCategoryRepository {
  findById(...args) { return CareerCategory.findById(...args); }
  create(...args) { return CareerCategory.create(...args); }

  /** All categories in display order (admin manage + section ordering). */
  findAllOrdered() {
    return CareerCategory.find({}).sort({ sortOrder: 1, name: 1 }).lean();
  }

  /** A category whose name matches case-insensitively (dedupe guard). */
  findByName(name, { excludeId } = {}) {
    const query = { name };
    if (excludeId) query._id = { $ne: excludeId };
    return CareerCategory.findOne(query).collation(CI.collation).lean();
  }

  /** Highest sortOrder in use, so a new category appends to the end. */
  async maxSortOrder() {
    const top = await CareerCategory.findOne({}).sort({ sortOrder: -1 }).select('sortOrder').lean();
    return top?.sortOrder ?? 0;
  }

  /** A slug derived from `base` that no other category already holds. */
  uniqueSlug(base, opts = {}) {
    return generateUniqueSlug(CareerCategory, base, opts);
  }

  findByIdAndDelete(...args) { return CareerCategory.findByIdAndDelete(...args); }

  /**
   * Persist a new display order in a single round-trip: each id's sortOrder
   * becomes its position in `orderedIds`. One request (bulkWrite) instead of N
   * PUTs, so a reorder can't half-apply and leave the list inconsistent.
   */
  bulkReorder(orderedIds) {
    if (!orderedIds.length) return Promise.resolve(null);
    const ops = orderedIds.map((id, i) => ({
      updateOne: { filter: { _id: id }, update: { $set: { sortOrder: i } } },
    }));
    return CareerCategory.bulkWrite(ops, { ordered: false });
  }

  /** How many roles (any status) currently carry this category name. */
  countPostingsUsing(name) {
    return JobPosting.countDocuments({ category: name }).collation(CI.collation);
  }

  /** Cascade a rename across every posting on the old name. Returns matched count. */
  async renamePostingsCategory(from, to) {
    const res = await JobPosting.updateMany({ category: from }, { $set: { category: to } })
      .collation(CI.collation);
    return res.modifiedCount ?? res.nModified ?? 0;
  }
}

export default new CareerCategoryRepository();

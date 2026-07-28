import JobPosting from '../models/JobPosting.js';
import { generateUniqueSlug } from '../utils/slug.js';

/**
 * JobPosting data access. Passthrough to the model (same style as
 * articleRepository) plus intent-named helpers so the controller never has to
 * import the model directly (repo-pattern eslint rule).
 */

// Public projection: everything the careers page needs to render a card + the
// apply-form <select>, minus internal bookkeeping.
const PUBLIC_FIELDS =
  'department title slug tagline experience intro responsibilities requirements closer location employmentType seo publishedAt';

class JobPostingRepository {
  findById(...args) { return JobPosting.findById(...args); }
  findByIdAndDelete(...args) { return JobPosting.findByIdAndDelete(...args); }
  create(...args) { return JobPosting.create(...args); }

  /** Open roles for the public careers page, projected + in display order. */
  findOpen() {
    return JobPosting.find({ status: 'open' })
      .select(PUBLIC_FIELDS)
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
  }

  /** A single open role by slug (public single-page + JSON-LD). */
  findOpenBySlug(slug) {
    return JobPosting.findOne({ slug, status: 'open' }).select(PUBLIC_FIELDS).lean();
  }

  /** All roles (any status) for admin management, in display order. */
  findAll(filter = {}) {
    return JobPosting.find(filter).sort({ sortOrder: 1, createdAt: 1 }).lean();
  }

  /** Highest sortOrder currently in use, so a new role appends to the end. */
  async maxSortOrder() {
    const top = await JobPosting.findOne({}).sort({ sortOrder: -1 }).select('sortOrder').lean();
    return top?.sortOrder ?? 0;
  }

  /** A slug derived from `base` that no other posting already holds. */
  uniqueSlug(base, opts = {}) {
    return generateUniqueSlug(JobPosting, base, opts);
  }
}

export default new JobPostingRepository();

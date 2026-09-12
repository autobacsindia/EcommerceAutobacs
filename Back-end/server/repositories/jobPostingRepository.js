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
  'department category title slug tagline experience intro responsibilities requirements closer location employmentType seo publishedAt';

/**
 * Field length caps, READ OFF THE SCHEMA rather than restated here.
 *
 * The controller validates against these before saving so an over-long field
 * comes back as a 400 naming the field, instead of a Mongoose ValidationError
 * that `errorMiddleware` whitelists down to the opaque string "Validation
 * Error". (That is exactly how a pasted 653-char paragraph in a single
 * `responsibilities` bullet blocked an admin save with no visible reason on
 * 2026-09-12 — same class as the `seo.canonical` cap drift, so the same fix:
 * derive, never restate. Editing a maxlength in the model moves this with it.)
 *
 * Exported from the repository, not the model, because controllers may not
 * import models directly (repo-pattern eslint rule).
 */
const capOf = (field) => {
  const path = JobPosting.schema.path(field);
  // Array-of-String paths carry maxlength on the caster, not the path itself.
  const cap = path?.options?.maxlength ?? path?.caster?.options?.maxlength;
  if (typeof cap !== 'number') {
    // A renamed/removed path would otherwise silently disable the guard and
    // hand the over-long value straight to the validator.
    throw new Error(`[jobPostingRepository] JobPosting has no maxlength for "${field}"`);
  }
  return cap;
};

export const FIELD_CAPS = Object.freeze({
  department: capOf('department'),
  category: capOf('category'),
  title: capOf('title'),
  tagline: capOf('tagline'),
  experience: capOf('experience'),
  intro: capOf('intro'),
  closer: capOf('closer'),
  location: capOf('location'),
  responsibilities: capOf('responsibilities'),
  requirements: capOf('requirements'),
});

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

  /** _id of an open role whose exact title matches — for application linkage. */
  findOpenIdByTitle(title) {
    return JobPosting.findOne({ status: 'open', title }).select('_id').lean();
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

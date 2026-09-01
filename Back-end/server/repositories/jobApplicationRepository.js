import JobApplication from '../models/JobApplication.js';

/**
 * JobApplication data access. Passthrough to the model plus a paginated admin
 * inbox query, keeping the model import isolated to the repository layer.
 */
class JobApplicationRepository {
  findById(...args) { return JobApplication.findById(...args); }
  create(...args) { return JobApplication.create(...args); }
  countDocuments(...args) { return JobApplication.countDocuments(...args); }
  save(doc) { return doc.save(); }

  /** Paginated admin list, newest first, optional status filter. */
  async listPaged({ filter = {}, page = 1, limit = 25 }) {
    const skip = (Math.max(1, page) - 1) * limit;
    const [items, total] = await Promise.all([
      JobApplication.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('posting', 'title slug department status')
        .lean(),
      JobApplication.countDocuments(filter),
    ]);
    return { items, total, page: Math.max(1, page), pages: Math.max(1, Math.ceil(total / limit)) };
  }

  /**
   * Applications referencing any of `publicIds` in any file slot.
   *
   * Used by the orphan-cleanup endpoint to refuse deletion of an asset that a
   * real application points at — the guard that makes a PUBLIC cleanup endpoint
   * safe. Projected to the file refs only; the caller needs no applicant PII to
   * answer "is this attached to something?".
   */
  findReferencingFiles(publicIds, slotKeys) {
    return JobApplication.find(
      { $or: slotKeys.map((k) => ({ [`files.${k}.publicId`]: { $in: publicIds } })) },
      slotKeys.map((k) => `files.${k}.publicId`).join(' '),
    ).lean();
  }

  findByIdPopulated(id) {
    return JobApplication.findById(id).populate('posting', 'title slug department status').lean();
  }
}

export default new JobApplicationRepository();

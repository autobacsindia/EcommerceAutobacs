import JobApplication, { REPLY_LIMIT } from '../models/JobApplication.js';

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
        // The inbox list never shows the reply history; it is up to REPLY_LIMIT
        // emails per row, so it is fetched only with the detail view.
        .select('-replies')
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

  /**
   * Atomically claim a reply draft: push `entry` only if no reply with the same
   * key exists AND the history is under REPLY_LIMIT. One round trip, so two
   * concurrent requests for the same key cannot both win (MongoDB applies the
   * filter + $push to the single document atomically).
   * @returns the updated application (lean) or null when the claim lost.
   */
  claimReply(id, entry) {
    return JobApplication.findOneAndUpdate(
      { _id: id, 'replies.key': { $ne: entry.key }, [`replies.${REPLY_LIMIT - 1}`]: { $exists: false } },
      { $push: { replies: entry } },
      { new: true, runValidators: true },
    ).select('email replies').lean();
  }

  /** Record the provider outcome on the claimed reply (matched by key). */
  settleReply(id, key, fields) {
    const set = Object.fromEntries(Object.entries(fields).map(([k, v]) => [`replies.$.${k}`, v]));
    return JobApplication.findOneAndUpdate(
      { _id: id, 'replies.key': key },
      { $set: set },
      { new: true },
    ).select('replies').lean();
  }

  findByIdPopulated(id) {
    return JobApplication.findById(id).populate('posting', 'title slug department status').lean();
  }
}

export default new JobApplicationRepository();

/**
 * Data access for the Google review bonus (services/googleReviewService.js).
 * Thin on purpose: the rules live in the service; this only names the queries
 * and the index each one uses.
 */
import GoogleReviewSubmission from '../models/GoogleReviewSubmission.js';

const HIDDEN = '-screenshot -dupKeys -submitId';

export const model = GoogleReviewSubmission;

/** A retried submit (index google_review_submit_once). */
export const findBySubmitId = (userId, submitId) =>
  GoogleReviewSubmission.findOne({ submittedBy: userId, submitId }).lean();

/** A live submission sharing any duplicate key (index google_review_dup_active). */
export const findLiveDuplicate = (dupKeys, excludeId = null) => GoogleReviewSubmission.findOne({
  active: true, dupKeys: { $in: dupKeys }, ...(excludeId ? { _id: { $ne: excludeId } } : {}),
}).select('dupKeys submittedByName').lean();

export const create = (doc) => GoogleReviewSubmission.create(doc);

export const findById = (id, select = '', session = null) => {
  const q = GoogleReviewSubmission.findById(id).select(select);
  if (session) q.session(session);
  return q.lean();
};

/** Compare-and-set on `version` (inside the caller's transaction). */
export const updateIfVersion = (id, version, update, session) => GoogleReviewSubmission.findOneAndUpdate(
  { _id: id, version }, update, { new: true, session, lean: true },
);

/** Newest first, `limit` rows (indexes google_review_status / google_review_by_person / _id). */
export const page = (filter, limit) => GoogleReviewSubmission.find(filter).select(HIDDEN).sort({ _id: -1 }).limit(limit).lean();

export const countPending = () => GoogleReviewSubmission.countDocuments({ status: 'pending' });

export default { model, findBySubmitId, findLiveDuplicate, create, findById, updateIfVersion, page, countPending };

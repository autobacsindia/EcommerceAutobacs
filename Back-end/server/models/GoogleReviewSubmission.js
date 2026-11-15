import mongoose from 'mongoose';

/**
 * A salesperson's claim that a customer posted a Google review for us, with a
 * screenshot as proof. The marketing head or an admin checks it and either
 * verifies it (with points, credited to Roav Points) or rejects it.
 *
 * Status:  pending → verified ⇄ rejected      (pending → rejected too)
 *   - verified → verified with other points = "points changed"
 *   - verified → rejected = "unverified" (the points are reversed)
 *
 * ── Concurrency ──────────────────────────────────────────────────────────────
 * Every change is a compare-and-set on `version` inside a transaction that also
 * writes the ledger row, so a double-click or two reviewers at once yield one
 * result, and the submission and the points can never disagree.
 *
 * `creditedCenti` is what the ledger holds for this submission right now (the
 * sum of its `review:<id>:v<n>` rows). It is only ever moved in the same
 * transaction as the row that changes it.
 *
 * ── Duplicates ───────────────────────────────────────────────────────────────
 * `dupKeys` lists what identifies the review: the screenshot's SHA-256 (`s:`),
 * the customer's phone (`p:`), the order (`o:`), and — only when there is
 * neither phone nor order — the customer's name (`n:`). A unique multikey index
 * over it, partial on `active: true`, refuses a second live submission that
 * shares ANY of them. A rejected submission is inactive, so a corrected one can
 * be sent.
 */
const HistorySchema = new mongoose.Schema(
  {
    action: { type: String, enum: ['submitted', 'verified', 'points_changed', 'unverified', 'rejected'], required: true },
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: '' },
    stars: { type: Number, default: null },
    points: { type: Number, default: null },
    deltaPoints: { type: Number, default: null },
    month: { type: String, default: null }, // the Roav Points month the change landed in
    reason: { type: String, default: '' },
  },
  { _id: false }
);

const GoogleReviewSubmissionSchema = new mongoose.Schema(
  {
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    submittedByName: { type: String, default: '' },
    // Made once per form by the screen, so a retried submit returns the first one.
    submitId: { type: String, required: true },

    customerName: { type: String, default: '' },
    customerPhone: { type: String, default: '' }, // last 10 digits
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    orderNumber: { type: String, default: '' },
    claimedStars: { type: Number, min: 1, max: 5, default: null },
    notes: { type: String, default: '' },

    screenshot: {
      publicId: { type: String, required: true },
      provider: { type: String, default: 'cloudinary' },
      url: { type: String, default: '' },
      contentType: { type: String, required: true },
      bytes: { type: Number, default: 0 },
      sha256: { type: String, required: true },
    },

    status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    active: { type: Boolean, default: true },
    dupKeys: { type: [String], default: [] },

    stars: { type: Number, min: 1, max: 5, default: null }, // as counted by the reviewer
    points: { type: Number, default: 0 },                   // current points while verified
    creditedCenti: { type: Number, default: 0 },            // what the ledger holds now
    creditMonth: { type: String, default: null },           // month of the first credit
    reason: { type: String, default: '' },                  // why it was rejected / unverified

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedByName: { type: String, default: '' },
    reviewedAt: { type: Date, default: null },

    version: { type: Number, default: 0 },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true }
);

// Same names and options as config/db.js ensureCriticalIndexes.
GoogleReviewSubmissionSchema.index(
  { dupKeys: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'google_review_dup_active' }
);
GoogleReviewSubmissionSchema.index({ submittedBy: 1, submitId: 1 }, { unique: true, name: 'google_review_submit_once' });
GoogleReviewSubmissionSchema.index({ submittedBy: 1, _id: -1 }, { name: 'google_review_by_person' });
GoogleReviewSubmissionSchema.index({ status: 1, _id: -1 }, { name: 'google_review_status' });

export default mongoose.model('GoogleReviewSubmission', GoogleReviewSubmissionSchema);

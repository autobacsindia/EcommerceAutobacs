import mongoose from "mongoose";

/**
 * JobApplication — one careers submission, replacing a row in the old Google
 * Sheet. Applicant PII + file references live here instead of in Drive/Sheets.
 *
 * Files are uploaded by the browser directly to Cloudinary (signed, private
 * `authenticated` delivery — see utils/careersCloudinary.generateCareersUploadSignature)
 * and only their { publicId } lands here. The public `url` of an
 * authenticated asset is NOT fetchable without a signature, so admins view them
 * via short signed URLs minted on read — never the "anyone with the link" access
 * the Drive flow used.
 *
 * Kept intentionally separate from the CRM Lead pipeline: candidates are not
 * sales leads and must not pollute lead scoring / attribution.
 */

const FileRefSchema = new mongoose.Schema(
  {
    url: { type: String, trim: true, default: "" },
    publicId: { type: String, trim: true, default: "" },
    // 'video' | 'raw' (pdf) — needed to mint the correct signed delivery URL.
    resourceType: { type: String, trim: true, default: "" },
    bytes: { type: Number, default: 0 },
  },
  { _id: false }
);

const JobApplicationSchema = new mongoose.Schema(
  {
    // The role applied for. `posting` may be null for an open application; the
    // snapshot title always survives, even if the posting is later edited/deleted.
    posting: { type: mongoose.Schema.Types.ObjectId, ref: "JobPosting", default: null },
    roleTitle: { type: String, required: true, trim: true },

    fullName: { type: String, required: true, trim: true, maxlength: 160 },
    city: { type: String, required: true, trim: true, maxlength: 160 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please use a valid email address"],
    },
    phone: { type: String, trim: true, maxlength: 40, default: "" },
    whatYouBring: { type: String, required: true, trim: true, maxlength: 5000 },
    howFound: { type: String, trim: true, maxlength: 200, default: "" },

    files: {
      videoOne: { type: FileRefSchema, default: () => ({}) },
      videoTwo: { type: FileRefSchema, default: () => ({}) },
      resume: { type: FileRefSchema, default: () => ({}) },
      support: { type: FileRefSchema, default: () => ({}) },
    },

    status: {
      type: String,
      enum: ["new", "reviewing", "shortlisted", "rejected", "hired"],
      default: "new",
      index: true,
    },
    adminNotes: { type: String, trim: true, maxlength: 5000, default: "" },

    // Applicant-facing email idempotency stamps — set only once the provider
    // accepts the send, so a BullMQ retry (or an admin toggling status back and
    // forth) never double-mails the candidate.
    acknowledgementEmailedAt: { type: Date, default: null },
    rejectionEmailedAt: { type: Date, default: null },

    /*
      Retention clock for the media-purge sweep: when this application ENTERED
      the `rejected` state. Cleared if it ever leaves that state.

      Deliberately NOT derived from `updatedAt`, which is the obvious shortcut
      and is wrong: `updatedAt` moves every time an admin edits a note, so a
      reviewer adding a comment would silently restart the retention window and
      the applicant's video would be kept indefinitely. A dedicated stamp makes
      the window mean what it says.

      Also not `rejectionEmailedAt` — that stamps when the rejection MAIL was
      accepted by the provider, is null when mail is disabled or fails, and is
      about idempotency rather than retention. It is used only to BACKFILL this
      field for applications rejected before it existed.
    */
    rejectedAt: { type: Date, default: null },

    /*
      When the media (videos / CV) was deleted under the retention policy. The
      application record, notes and decision are kept for audit; only the files
      go. Set together with clearing `files`, so the admin UI can say "media
      removed per retention policy" instead of rendering a signed URL for an
      object that no longer exists.
    */
    mediaPurgedAt: { type: Date, default: null },

    // Abuse triage only — never surfaced to the applicant.
    meta: {
      ip: { type: String, default: "" },
      userAgent: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

// Admin inbox: newest first, filterable by status.
JobApplicationSchema.index({ status: 1, createdAt: -1 });

/*
  Retention sweep lookup: "rejected, rejected before X, media not yet purged".
  Without this the daily cron scans the whole collection; with it the sweep
  touches only the rows it can act on. NOTE: prod runs autoIndex:false, so this
  declaration does NOT create the index on deploy — it needs a migration
  (npm run audit-index-drift will report it as missing until then).
*/
JobApplicationSchema.index({ status: 1, rejectedAt: 1, mediaPurgedAt: 1 });
JobApplicationSchema.index({ createdAt: -1 });
JobApplicationSchema.index({ email: 1 });
JobApplicationSchema.index({ posting: 1 });

export default mongoose.model("JobApplication", JobApplicationSchema);

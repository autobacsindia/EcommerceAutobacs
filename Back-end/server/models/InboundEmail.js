import mongoose from "mongoose";

/**
 * Durable landing zone for raw inbound email from the Postmark inbound stream.
 *
 * Why this exists as its own collection rather than parsing straight into a
 * ticket inside the webhook request:
 *
 * 1. **Ack fast, process async.** Postmark expects a prompt 200. Parsing,
 *    Cloudinary uploads and ticket resolution are far too slow to do inline, so
 *    the webhook writes the raw payload here, enqueues a job, and returns.
 *
 * 2. **Never lose a customer email.** If parsing throws — a malformed address, a
 *    Cloudinary outage, an unexpected MIME shape — the raw payload is still on
 *    disk and the job can be replayed after a fix. Losing inbound mail is the
 *    worst failure this system has, because it is silent: the customer believes
 *    they contacted us and simply never hears back.
 *
 * 3. **Idempotency.** Postmark retries on any non-2xx. The unique index on
 *    `messageId` makes a replay a no-op rather than a duplicate ticket.
 *
 * Retention: these rows hold full message bodies and are the most PII-dense
 * records in the database. They are pruned by TTL once processed — the parsed,
 * sanitised copy on SupportMessage is the long-lived record.
 */

const InboundEmailSchema = new mongoose.Schema({
  /**
   * RFC 5322 Message-ID. The idempotency key. Unique-sparse: a payload without
   * one still gets stored (we fall back to a content hash in the service), it
   * just cannot be deduped by header.
   */
  messageId: { type: String, default: null },

  /**
   * Content hash, used as the dedupe key when a payload carries no Message-ID.
   * Together with `messageId` this makes replay-safety total.
   */
  fingerprint: { type: String, default: null },

  /** Envelope fields, denormalised for querying without parsing `payload`. */
  fromEmail: { type: String, trim: true, lowercase: true, default: "" },
  fromName:  { type: String, trim: true, default: "" },
  toEmail:   { type: String, trim: true, lowercase: true, default: "" },
  subject:   { type: String, trim: true, default: "" },

  /**
   * The complete unmodified Postmark inbound payload. `Mixed` on purpose: this
   * is a forensic record, and imposing a schema on a third party's payload
   * would silently drop fields we later need. Never rendered to any UI.
   */
  payload: { type: mongoose.Schema.Types.Mixed, required: true },

  status: {
    type: String,
    enum: ["received", "processing", "processed", "spam", "rejected", "failed"],
    default: "received",
    index: true,
  },

  /** Set once a ticket has been resolved or created for this email. */
  ticket: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SupportTicket",
    default: null,
  },
  message: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SupportMessage",
    default: null,
  },

  /** Why it was rejected/failed — spam score, bad sender, parse error. */
  reason: { type: String, default: "" },

  /** Processing attempts, so a poison payload can be parked instead of looping. */
  attempts: { type: Number, default: 0 },

  processedAt: { type: Date, default: null },
}, {
  timestamps: true,
});

/** Replay safety by RFC header. */
InboundEmailSchema.index({ messageId: 1 }, { unique: true, sparse: true });

/** Replay safety for payloads with no Message-ID. */
InboundEmailSchema.index({ fingerprint: 1 }, { unique: true, sparse: true });

/** Ops view: what is stuck or failed, newest first. */
InboundEmailSchema.index({ status: 1, createdAt: -1 });

/**
 * TTL — raw payloads self-delete 30 days after processing. The sanitised message
 * on SupportMessage is the record of the conversation; keeping full raw MIME
 * (including attachments as base64) indefinitely is a storage and DPDP-retention
 * liability with no operational upside.
 *
 * Indexed on `processedAt`, which is only set once handling succeeded — so an
 * unprocessed or failed email is never expired out from under an engineer who
 * still needs to replay it.
 */
InboundEmailSchema.index(
  { processedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 }
);

export default mongoose.models.InboundEmail
  || mongoose.model("InboundEmail", InboundEmailSchema);

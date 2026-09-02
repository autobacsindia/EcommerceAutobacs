import mongoose from "mongoose";
import { MESSAGE_DIRECTIONS, MESSAGE_VISIBILITY } from "../config/supportPolicy.js";

/**
 * One message in a support thread: a customer email, an agent reply, or an
 * internal note.
 *
 * Separate collection by design — see the note at the top of SupportTicket.js.
 *
 * SECURITY: `bodyHtml` holds attacker-controlled markup from inbound email and
 * is the single highest-risk field in this feature. It is sanitised on write
 * (services/supportSanitizer.js) and additionally rendered inside a sandboxed
 * iframe by the admin UI. Never interpolate it into an admin page directly, and
 * never re-derive it from `bodyRaw` at read time — `bodyRaw` is kept only for
 * forensics and is never rendered.
 */

/**
 * A private Cloudinary asset attached to a message. Mirrors ReturnRequest's
 * CloudAssetSchema and JobApplication.files: we persist only server-derived
 * values, and the browsable URL is re-signed at view time, so a leaked stored
 * value is useless on its own.
 */
const AttachmentSchema = new mongoose.Schema({
  publicId:     { type: String, required: true },
  resourceType: { type: String, enum: ["image", "video", "raw"], required: true },
  // Original filename as supplied by the sender. Display-only, never used to
  // build a filesystem path or a Cloudinary public id.
  fileName:     { type: String, trim: true, default: "" },
  contentType:  { type: String, trim: true, default: "" },
  bytes:        { type: Number, default: 0 },
    /*
      Which store holds this asset. Absent on every row written before the
      Cloudinary -> R2 migration, and absent MUST mean Cloudinary — the read path
      tests `=== 'r2'` so a missing value routes to the legacy provider.
      Explicit rather than inferred: a Cloudinary public_id and an R2 object key
      are indistinguishable by shape.
    */
    provider: { type: String, enum: ['cloudinary', 'r2'], default: 'cloudinary' },

}, { _id: false });

/**
 * An attachment we refused. Recorded rather than silently dropped so an agent
 * can see "the customer did send a video, we rejected it" and ask for a resend
 * instead of the customer believing evidence was submitted.
 */
const RejectedAttachmentSchema = new mongoose.Schema({
  fileName:    { type: String, trim: true, default: "" },
  contentType: { type: String, trim: true, default: "" },
  bytes:       { type: Number, default: 0 },
  reason:      { type: String, trim: true, default: "" },
}, { _id: false });

const SupportMessageSchema = new mongoose.Schema({
  ticket: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SupportTicket",
    required: true,
    index: true,
  },

  direction: { type: String, enum: MESSAGE_DIRECTIONS, required: true },

  /**
   * `internal` notes are agent-only. The API filters on this field before
   * serialising for any customer-facing route — visibility is enforced server
   * side, never by the client choosing not to render it.
   */
  visibility: {
    type: String,
    enum: MESSAGE_VISIBILITY,
    default: "public",
    index: true,
  },

  /** Who wrote it. `user` is set for agents and for logged-in customers. */
  author: {
    user:  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    email: { type: String, trim: true, lowercase: true, default: "" },
    name:  { type: String, trim: true, default: "" },
    isAgent: { type: Boolean, default: false },
  },

  /**
   * Plain-text body with quoted history stripped — what the admin UI shows by
   * default and what any AI summarisation should read. This is the canonical
   * body; prefer it over bodyHtml everywhere it is sufficient.
   */
  bodyText: { type: String, default: "" },

  /** Sanitised HTML. Rendered only inside a sandboxed iframe. */
  bodyHtml: { type: String, default: "" },

  /**
   * The full original text INCLUDING quoted history, kept so an agent can expand
   * "show trimmed content" and so a bad strip is recoverable. Never rendered as
   * HTML.
   */
  bodyRaw: { type: String, default: "" },

  attachments:         { type: [AttachmentSchema], default: [] },
  rejectedAttachments: { type: [RejectedAttachmentSchema], default: [] },

  // ── Email threading ───────────────────────────────────────────────────────
  // RFC 5322 identifiers. `messageId` is unique-sparse: it is the idempotency
  // key that stops a Postmark webhook retry from appending the same customer
  // reply twice.
  messageId: { type: String, default: null },
  inReplyTo: { type: String, default: null },
  references: { type: [String], default: [] },

  /** Provider identifiers, for tracing a message back through Postmark. */
  providerMessageId: { type: String, default: null },
  providerStream:    { type: String, default: null },

  /**
   * Delivery state for outbound mail, updated by the Postmark delivery/bounce
   * webhooks. A `bounced` reply is why a customer "never heard back", so the
   * admin thread surfaces this per message rather than hiding it in a log.
   */
  deliveryStatus: {
    type: String,
    enum: ["pending", "sent", "delivered", "bounced", "spam_complaint", "failed"],
    default: "pending",
    index: true,
  },
  deliveryError: { type: String, default: "" },

  /**
   * True when this arrived from an auto-responder (out-of-office, mailer-daemon,
   * "we received your message"). Detected from Auto-Submitted / Precedence
   * headers. Auto-replies must not count as a customer response, must not
   * reopen a resolved ticket, and must never be acknowledged — that is the
   * ping-pong loop the guard exists to prevent.
   */
  isAutoReply: { type: Boolean, default: false },

  /** SpamAssassin score from the inbound payload, when present. */
  spamScore: { type: Number, default: null },
}, {
  timestamps: true,
});

// ── Indexes ─────────────────────────────────────────────────────────────────

/** Thread view: every message on a ticket, oldest first. */
SupportMessageSchema.index({ ticket: 1, createdAt: 1 });

/**
 * Threading lookup + inbound idempotency. Unique so a webhook retry that
 * replays the same RFC Message-ID cannot duplicate a message.
 *
 * PARTIAL on `$type: 'string'`, NOT `sparse` — and the difference is the whole
 * bug. `messageId` is declared `default: null`, so every in-app message (web
 * form, admin reply drafted in the UI) carries the field PRESENT with a null
 * value. `sparse` skips only ABSENT fields, so all of those nulls were indexed
 * and collided under `unique`. The index therefore never built: production had
 * 17 such rows and `createIndex` failed with E11000 on `{ messageId: null }`.
 *
 * That meant the idempotency guard described above DID NOT EXIST — a replayed
 * Postmark webhook could append the same customer reply twice.
 *
 * `$type: 'string'` indexes only rows that hold a real Message-ID, which is the
 * intent `sparse` was reaching for. Query through
 * `supportMessageRepository.messageIdFilter()`: the planner will not infer that
 * an equality predicate satisfies a `$type` partial filter, so a bare
 * `{ messageId }` silently COLLSCANs (same defect as repositories/cartRepository.js).
 */
SupportMessageSchema.index(
  { messageId: 1 },
  { unique: true, partialFilterExpression: { messageId: { $type: 'string' } } }
);

/**
 * Reverse threading: given an incoming reply's In-Reply-To / References, find
 * the message it answers and therefore the ticket it belongs to.
 */
SupportMessageSchema.index({ references: 1 });

export default mongoose.models.SupportMessage
  || mongoose.model("SupportMessage", SupportMessageSchema);

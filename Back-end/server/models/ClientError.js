import mongoose from 'mongoose';
import {
  CLIENT_ERROR_FEATURE_VALUES,
  CLIENT_ERROR_LEVELS,
  CLIENT_ERROR_STATUS_VALUES,
} from '../config/clientErrors.js';

/**
 * One customer-facing website error, GROUPED: every report with the same
 * signature (feature + step + error name + normalised message + top stack frame)
 * lands on this one document, which counts it and keeps the last few examples.
 * See config/clientErrors.js for the limits and services/clientErrorService.js
 * for the write path.
 *
 * Privacy: nothing here names a person. A customer is an account id or an order
 * id; messages, URLs and context are scrubbed of emails, phone numbers, tokens
 * and query strings before they arrive (utils/clientErrorScrub.js).
 *
 * Indexes are built by scripts/create-client-error-indexes.js — prod runs with
 * autoIndex off, so a deploy never builds them.
 */

const sampleSchema = new mongoose.Schema({
  at: { type: Date, required: true },
  url: String,             // path only, query string dropped
  message: String,
  stack: String,
  browser: String,         // "Chrome 131"
  os: String,              // "Android 14"
  device: { type: String, enum: ['mobile', 'tablet', 'desktop', 'unknown'], default: 'unknown' },
  release: String,         // the storefront build (git sha) that sent it
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  context: { type: Map, of: String, default: undefined },
}, { _id: false });

const clientErrorSchema = new mongoose.Schema({
  signature: { type: String, required: true },
  feature: { type: String, enum: CLIENT_ERROR_FEATURE_VALUES, required: true },
  step: { type: String, default: '' },
  level: { type: String, enum: CLIENT_ERROR_LEVELS, default: 'error' },
  name: { type: String, default: 'Error' },
  message: { type: String, required: true },
  /** The page the error was first seen on (path only). The samples hold the latest ones. */
  path: { type: String, default: '' },
  count: { type: Number, default: 0 },
  firstSeenAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
  lastRelease: { type: String, default: '' },
  samples: { type: [sampleSchema], default: [] },

  status: { type: String, enum: CLIENT_ERROR_STATUS_VALUES, default: 'open' },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedNote: { type: String, default: '' },
  /** Set when a resolved error happened again: it reopens itself. */
  reopenedAt: { type: Date, default: null },

  /** lastSeenAt + retention. The TTL monitor deletes the record at this time. */
  expireAt: { type: Date, required: true },
}, { timestamps: true, collection: 'clienterrors' });

// The upsert key: one document per signature. Unique, so two reports of a NEW error
// arriving at the same instant cannot create two documents (the loser retries as an update).
clientErrorSchema.index({ signature: 1 }, { unique: true, name: 'signature_1' });
// The lists: newest first, optionally narrowed to a feature / status. _id breaks ties for the cursor.
clientErrorSchema.index({ lastSeenAt: -1, _id: -1 }, { name: 'lastSeenAt_-1__id_-1' });
clientErrorSchema.index({ feature: 1, status: 1, lastSeenAt: -1, _id: -1 }, { name: 'feature_1_status_1_lastSeenAt_-1__id_-1' });
// Retention. A scalar date (never an array path — that would delete on the minimum), and
// scoped with a partial filter so only rows that carry a real expiry date can ever expire.
// `$type`, not `$ne`: MongoDB rejects `$ne` in a partialFilterExpression.
clientErrorSchema.index(
  { expireAt: 1 },
  { name: 'expireAt_ttl', expireAfterSeconds: 0, partialFilterExpression: { expireAt: { $type: 'date' } } },
);

export default mongoose.models.ClientError || mongoose.model('ClientError', clientErrorSchema);

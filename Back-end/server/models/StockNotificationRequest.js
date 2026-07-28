import mongoose from "mongoose";

/**
 * A logged-in customer's interest signal on an unavailable item. Two `kind`s
 * share this collection:
 *   • 'restock'   — the PDP "Notify me" button on an OUT-OF-STOCK item. Consumed
 *     by the restock hook on ProductSchema, which fans out one email per pending
 *     request when the item transitions out → purchasable (notificationWorker).
 *   • 'backorder' — the PDP "Join the waiting list" button on an ON-BACKORDER
 *     item. A sales-follow-up / demand list only: it is NEVER auto-emailed by the
 *     restock fan-out (that path filters to kind:'restock'), and each waitlister
 *     is also surfaced in the Sales CRM as a `backorder_waitlist` lead.
 *
 * Granularity is per-variant: `variantId` pins the exact model of a `variable`
 * product the shopper was looking at, so a restock of a sibling variant doesn't
 * spam them. For `simple` products `variantId` is null (whole-product signal).
 *
 * Lifecycle: pending → notified (delivered) | cancelled (user opted out). The
 * unique index below only guards `pending`, so a customer can sign up again after
 * a future out-of-stock cycle — each restock closes out its batch by flipping to
 * `notified`, freeing the slot.
 */
const StockNotificationRequestSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
    index: true,
  },
  // Variant subdoc _id for a `variable` product; null for `simple` products.
  variantId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  // Which list this row belongs to (see the file header). 'restock' is the
  // default so every pre-existing row is treated as a back-in-stock request.
  kind: {
    type: String,
    enum: ['restock', 'backorder'],
    default: 'restock',
    index: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  // Email snapshot at request time (for admin display + audit). The worker
  // re-reads the live User.email at send time so an address change is honoured.
  email: {
    type: String,
    trim: true,
    lowercase: true,
  },
  status: {
    type: String,
    enum: ['pending', 'notified', 'cancelled'],
    default: 'pending',
    index: true,
  },
  // Stamped when the back-in-stock email is enqueued (idempotency marker — set
  // BEFORE the send so BullMQ retries and repeated restock cycles never double-send).
  notifiedAt: {
    type: Date,
    default: null,
  },
  source: {
    type: String,
    default: 'pdp',
  },
}, {
  timestamps: true,
});

// One live request per (product, variant, user, kind). Partial on status so the
// guard only applies while pending — a notified/cancelled row doesn't block a
// fresh sign-up on the next cycle. `kind` is in the key so a shopper can be on
// BOTH the restock list and the backorder waiting list for the same target
// without colliding. variantId is always set (null for simple products) so the
// compound key is stable.
StockNotificationRequestSchema.index(
  { product: 1, variantId: 1, user: 1, kind: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

// Admin list + the restock fan-out both query pending rows for a product; this
// covers "all pending for product X (optionally variant Y) of a given kind".
StockNotificationRequestSchema.index({ product: 1, variantId: 1, kind: 1, status: 1 });

export default mongoose.model("StockNotificationRequest", StockNotificationRequestSchema);

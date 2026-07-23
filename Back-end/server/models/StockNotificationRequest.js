import mongoose from "mongoose";

/**
 * A logged-in customer's request to be emailed when an out-of-stock item comes
 * back. Created from the PDP "Notify me" button; consumed by the restock hook on
 * ProductSchema, which fans out one email per pending request when an item
 * transitions out → purchasable (see queue/workers/notificationWorker.js).
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

// One live request per (product, variant, user). Partial on status so the guard
// only applies while pending — a notified/cancelled row doesn't block a fresh
// sign-up on the next out-of-stock cycle. variantId is always set (null for
// simple products) so the compound key is stable.
StockNotificationRequestSchema.index(
  { product: 1, variantId: 1, user: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

// Admin list + the restock fan-out both query pending rows for a product; this
// covers "all pending for product X (optionally variant Y)".
StockNotificationRequestSchema.index({ product: 1, variantId: 1, status: 1 });

export default mongoose.model("StockNotificationRequest", StockNotificationRequestSchema);

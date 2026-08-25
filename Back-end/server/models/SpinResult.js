import mongoose from "mongoose";
import { SPIN_RESULT_STATUS, SPIN_RESULT_STATUSES, VOID_REASONS, PRIZE_KINDS } from "../config/spin.js";

/**
 * SpinResult — the immutable record of one spin.
 *
 * One row per order, forever. This collection is the audit trail for physical stock
 * that left the building, so rows are voided rather than deleted and the prize is
 * SNAPSHOTTED rather than dereferenced at read time — the same discipline orders use
 * for line items. Renaming a goodie next year must not rewrite what someone won last
 * year.
 */
const SpinResultSchema = new mongoose.Schema({
  /**
   * ⚠️ THE idempotency key. The unique index on this field is the entire "one spin per
   * order" guarantee.
   *
   * A refresh, a double-click, a retried request or two concurrent tabs all race to
   * insert here; the loser gets E11000, and spinService catches it, re-reads the
   * committed row and returns the SAME prize. This is exactly how
   * razorpayService.processPaymentSuccess serialises duplicate webhook deliveries on
   * gatewayPaymentId — a pre-check `findOne` alone cannot do it, because under
   * snapshot isolation neither transaction can see the other's uncommitted insert.
   *
   * ⚠️ The unique index is built ONLY in config/db.js (as `unique_spin_per_order`), and
   * deliberately NOT declared here as `unique: true`.
   *
   * Declaring it in both places is not redundancy, it is a silent failure. Outside
   * production autoIndex is ON, so Mongoose would build this key as `order_1` first;
   * config/db.js then asks for the same key under a different name and MongoDB rejects
   * it outright with "Index already exists with a different name". That error aborted
   * the whole index-verification pass, so EVERY spin index — including this one — was
   * quietly missing. Same shape as the AuditLog TTL that never got created.
   */
  order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },

  /** null for guest orders — they still spin, they just have no account to attach to. */
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },

  campaign: { type: mongoose.Schema.Types.ObjectId, ref: "SpinCampaign", required: true, index: true },
  prize: { type: mongoose.Schema.Types.ObjectId, ref: "SpinPrize", required: true },

  /**
   * Snapshot of the prize as it was when won. Never render a historical win from the
   * live SpinPrize doc — it may since have been renamed, retired or deleted.
   */
  prizeSnapshot: {
    name: { type: String, required: true },
    sku: { type: String, default: null },
    kind: { type: String, enum: PRIZE_KINDS, required: true },
    imageUrl: { type: String, default: null },
    isFloorPrize: { type: Boolean, default: false },
    /** The winner's OWN single-use code (kind='coupon'). Shown on the reveal + emailed. */
    couponCode: { type: String, default: null },
  },

  /** Which slice the wheel lands on. Decided server-side with the outcome. */
  segmentIndex: { type: Number, required: true, min: 0 },
  /** The slice labels this customer was shown, so a dispute can be reconstructed. */
  segmentLabels: { type: [String], default: [] },

  status: { type: String, enum: SPIN_RESULT_STATUSES, default: SPIN_RESULT_STATUS.GRANTED, index: true },
  voidReason: { type: String, enum: [...VOID_REASONS, null], default: null },
  voidedAt: { type: Date, default: null },
  /** True when the void returned a unit to stock — false if it had already shipped. */
  stockReturned: { type: Boolean, default: false },

  /** Set when a human confirms the goodie is physically in the parcel. */
  fulfilledAt: { type: Date, default: null },
  fulfilledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

  spunAt: { type: Date, default: Date.now },

  /** The Coupon document minted for this winner, so it can be audited or revoked. */
  awardedCoupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", default: null },

  /**
   * Idempotency guard for the prize email — one send per win, however many times BullMQ
   * retries the job. Mirrors Order.invoiceEmailedAt.
   */
  prizeEmailedAt: { type: Date, default: null },

  /** Hashed like Order.guestIPHash — abuse forensics without storing a raw IP. */
  ipHash: { type: String, default: null },

  /** Analytics only: did they click through to Google? Never gates the prize. */
  reviewCtaClickedAt: { type: Date, default: null },
}, { timestamps: true });

// The admin fulfilment queue: unshipped goodies, oldest first. Cursor-paginated.
SpinResultSchema.index({ campaign: 1, status: 1, fulfilledAt: 1, spunAt: -1 });
// Per-user campaign cap check.
SpinResultSchema.index({ user: 1, campaign: 1 });

export default mongoose.models.SpinResult || mongoose.model("SpinResult", SpinResultSchema);

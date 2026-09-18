/**
 * The fields that record a refund settled OUTSIDE the payment gateway, and the
 * fields that record an admin reverting such a record.
 *
 * Shared verbatim by `Order.refundDetails` and `Order.cancellations[].refund` so the
 * two refund surfaces cannot drift apart. `ReturnRequest.refund` already carries its
 * own `offlineMethod`/`reference`/`paidAt` (added 2026-08-29) and only gains the
 * reversal half — see `revertFields()` there.
 *
 * ⚠️ SCALARS ONLY — NO ARRAYS, AND NO `default:` ON ANY OF THESE.
 *
 * `refundDetails` is a Mongoose NESTED PATH, not a subdocument, so anything that
 * materialises it materialises it on EVERY order. A `default:` does that directly —
 * which is how a phantom ₹0 "pending" refund once ended up on every order in this
 * collection (see the note on `refundDetails.status`). A declared ARRAY does it
 * indirectly: Mongoose initialises one to `[]` and persists it.
 *
 * Verified rather than assumed: `refundDetails` ALREADY persists as
 * `{ paymentRecorded: false, itemsRefunded: [] }` on every new order, from the
 * existing default and array above. So the `{ refundDetails: { $exists: false } }`
 * clause in `orderRepository.markRefundProcessing` / `findWithRefunds` is already
 * dead for post-2026 orders — those paths only still work because each one ORs in a
 * `'refundDetails.status': { $exists: false }` clause, and `status` is the one field
 * deliberately left without a default. Adding a tenth field with a default or an
 * array would not change that, but it moves the load onto a single surviving clause
 * for no gain. Hence: scalars, no defaults.
 *
 * The consequence: there is no on-document history of repeated mark/revert cycles.
 * The last mark and the last revert are kept here; the full trail lives in `AuditLog`
 * (`ORDER_REFUND_MARKED_OFFLINE` / `ORDER_REFUND_REVERTED`), which is append-only and
 * built for exactly this.
 */

import mongoose from 'mongoose';
import { OFFLINE_METHODS } from '../../config/offlineRefund.js';

/**
 * @returns {object} a FRESH field map — never a shared object literal, because
 *   Mongoose mutates the definitions it is handed while compiling a schema.
 */
export const offlineRefundFields = () => ({
  // How the money physically went back. Only set when refundMethod === 'offline'.
  offlineMethod: { type: String, enum: [...OFFLINE_METHODS] },

  /*
    The operator's evidence: a UTR, cheque number, receipt number, or the Razorpay
    refund id when reconciling a refund issued by hand in the dashboard.

    Deliberately NOT stored in `refundDetails.transactionId`, which is what the
    return path does. That field is indexed and searched by `findOneByRefundId` to
    resolve an incoming refund webhook to an order; putting operator free-text in it
    means an arbitrary string can be matched by a gateway-id lookup.
  */
  offlineReference: { type: String, maxlength: 120 },

  // When the money actually moved, which is generally BEFORE it was recorded here.
  paidAt: Date,
  offlineRecordedAt: Date,
  offlineRecordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  /*
    What the affiliate commission clawback actually took, in paise, at mark time.
    Stored rather than recomputed so a revert reinstates EXACTLY the figure that was
    removed. Re-deriving it at revert time would use whatever the order looks like
    then, and any drift between the two lands in an affiliate's ledger as money that
    was never owed or never returned.
  */
  affiliateClawbackPaise: Number,

  /*
    WHAT ACTUALLY LANDED, in paise — not what was attempted.

    ⚠️ THESE EXIST BECAUSE THE ONCE-ONLY CLAIM FLAGS CANNOT ANSWER THE QUESTION.
    `paymentRecorded` / `paymentIncremented` / `ltvAdjusted` are set BEFORE the work, by
    design: they are exactly-once guards, not success records. So after a phase-2 write
    fails — which is reported as a warning and deliberately never rolled back — the flag
    still reads `true` while the money never moved.

    A revert that trusted the flag would subtract from `Payment.refundAmount` an amount
    that was never added, wiping a SIBLING refund's contribution off the row (the
    `Math.max(...)` floor in remainingRefundable) and un-flipping `Payment.status`. Same
    for LTV: it would credit back spend that was never taken.

    So the mark path writes these only on the success path, and the revert reverses
    exactly these figures. Absent or 0 means "nothing landed, reverse nothing" — which
    leaves headroom consumed rather than opening a double payout, the safe direction.
  */
  paymentRecordedPaise: Number,
  ltvDecrementedPaise: Number,

  ...revertFields(),
});

/**
 * The reversal half on its own, for records that already carry the offline fields.
 * @returns {object} a fresh field map.
 */
export const revertFields = () => ({
  revertedAt: Date,
  revertedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  revertReason: { type: String, maxlength: 500 },
});

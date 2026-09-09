import mongoose from "mongoose";
import {
  ATTRIBUTION_SOURCES,
  COMMISSION_STATUS,
  COMMISSION_STATUSES,
  COMMISSION_TYPES,
} from "../config/affiliate.js";

/**
 * AffiliateCommission — the ledger of what we owe an affiliate, and what we clawed back.
 *
 * This is OUR COST, not part of what the customer paid. It never appears in
 * Order.discount, on the invoice, or in any refund figure. Keeping it in a separate
 * ledger is what stops it becoming the second money pipeline that config/affiliate.js
 * and config/campaign.js both warn about.
 *
 * ── SHAPE: ONE MUTABLE ACCRUAL + APPEND-ONLY CORRECTIONS ─────────────────────────
 * models/KarmaLedger.js is the template, but a pure append-only ledger does not quite
 * fit: a commission has a lifecycle that must be queried and CLAIMED (pending →
 * approved → paid), and a payout batch claims rows by flipping them. So:
 *
 *   - exactly ONE `accrual` row per order, whose `status` moves through the lifecycle;
 *   - `clawback` and `adjust` rows are append-only and signed, never mutated.
 *
 * A `paid` row is IMMUTABLE. It records money that actually left the bank, so a refund
 * that lands afterwards writes a NEGATIVE row rather than rewriting it. Rewriting it
 * would stop the payout reconciling with the bank statement — the same instinct that
 * makes orders immutable financial records.
 *
 * ── THE PAYABLE BALANCE ──────────────────────────────────────────────────────────
 *   Σ amountPaise WHERE { affiliate, status: 'approved', payout: null }
 *
 * Because clawback rows are negative and land in exactly that set, a debt incurred
 * after a payout nets off the NEXT batch with no special code path. If the sum goes
 * negative the batch builder refuses and the debt carries forward.
 */
const AffiliateCommissionSchema = new mongoose.Schema(
  {
    affiliate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Affiliate",
      required: true,
    },

    /**
     * ⚠️ THE idempotency key. The partial-unique index on `{ order, type: 'accrual' }`
     * is the entire "one commission per order" guarantee.
     *
     * Razorpay retries webhooks and users double-click "Pay". processPaymentSuccess
     * gates the accrual on `createdHere`, but under snapshot isolation two concurrent
     * deliveries cannot see each other's uncommitted insert — the loser gets E11000 and
     * affiliateCommissionService treats it as success. Exactly how
     * payments.gatewayPaymentId serialises the capture itself.
     *
     * ⚠️ That unique index is built ONLY in config/db.js (as `unique_accrual_per_order`),
     * and deliberately NOT declared here.
     *
     * Declaring it in both places is not redundancy, it is a silent failure. Outside
     * production autoIndex is ON, so Mongoose would build the key first under its
     * generated name; config/db.js then asks for the same key under a different name,
     * MongoDB rejects it with "Index already exists with a different name", and that
     * error aborts the WHOLE index-verification pass — so every index after it goes
     * quietly missing. That is exactly what happened to the Spin-to-Win indexes (see
     * models/SpinResult.js) and to the AuditLog TTL.
     */
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },

    /** The BUYER. Kept for abuse forensics (self-referral, collusion clusters). */
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    type: { type: String, enum: COMMISSION_TYPES, required: true },

    /**
     * SIGNED, in integer paise. Positive on an accrual, negative on a clawback,
     * either way on an adjustment. All arithmetic in this system is integer paise
     * (utils/money.js); rupees exist only at the edges.
     */
    amountPaise: { type: Number, required: true },

    /**
     * What the amount was computed on — the order's net goods in paise
     * (refundMathService.orderGoodsNetPaise), or for a clawback the returned lines'
     * net share. Stored for audit: without it, "why is this ₹412?" is unanswerable
     * once the order has been partially returned.
     */
    basePaise: { type: Number, required: true, default: 0 },

    /** The rate actually used — the snapshot from Order.affiliate, never the live rate. */
    percent: { type: Number, required: true, min: 0, max: 100 },

    /** Attribution snapshots, so a later code rename cannot rewrite history. */
    code: { type: String, trim: true },
    source: { type: String, enum: ATTRIBUTION_SOURCES, default: undefined },

    status: {
      type: String,
      enum: COMMISSION_STATUSES,
      default: COMMISSION_STATUS.PENDING,
    },

    /**
     * When this becomes payable: the LAST delivered line's date plus the return window.
     *
     * Stamped on the `post-order-delivered` event so the maturation sweep is an indexed
     * range scan instead of a walk of every pending row. It is a HINT, not the gate —
     * the sweep re-verifies full delivery, the window and in-flight returns against the
     * live order before approving anything.
     *
     * ⚠️ `null` means "not delivered yet". Every sweep query MUST carry `$ne: null`
     * alongside `$lte: now`: in BSON sort order null sorts BELOW Date, so a bare
     * `{ maturesAt: { $lte: now } }` matches every un-stamped row and would approve
     * commissions on orders that never shipped. (`$ne` is banned inside a
     * partialFilterExpression, not inside a query — a different rule, easily conflated.)
     */
    maturesAt: { type: Date, default: null },

    approvedAt: { type: Date, default: null },

    /**
     * The payout batch that claimed this row. `null` on an unclaimed row, and that
     * null IS the concurrency guard: the batch builder's updateMany matches
     * `{ status: 'approved', payout: null }`, so a second admin's identical call
     * matches zero rows and 409s instead of paying twice.
     */
    payout: { type: mongoose.Schema.Types.ObjectId, ref: "AffiliatePayout", default: null },

    /** For a clawback/adjust: the accrual row it corrects. */
    reversalOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AffiliateCommission",
      default: null,
    },

    /** Why — 'order_cancelled', 'return_refunded', an admin's note. */
    note: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

/*
  ── READ PATHS ────────────────────────────────────────────────────────────────────
  The `{ order, type: 'accrual' }` partial-unique IDEMPOTENCY GUARD lives in
  config/db.js, not here — see the note on the `order` field for why declaring it in
  both places silently breaks index verification.

  ⚠️ THAT GUARD IS NOT A READ PATH — and these plain indexes are NOT redundant with it.

  MongoDB's planner will not use a partial index unless it can PROVE the query is
  contained by the filter, and it does not infer that from a plain equality predicate
  against a `$type` clause. So `find({ order, type: 'accrual' })` does not qualify, the
  partial index is discarded, and the query collection-scans a growing collection. That
  exact trap produced a 59,638-document scan per cart read and an Atlas query-targeting
  alert on this cluster once already (see repositories/cartRepository.js and the
  sessionId note in models/Order.js).

  So: do NOT "clean up the duplicate" by dropping `{ order: 1 }` below.
*/

// Clawback lookup: "find this order's accrual row".
AffiliateCommissionSchema.index({ order: 1 });

// Payout batching and the balance aggregate: rows for one affiliate in one STATE.
AffiliateCommissionSchema.index({ affiliate: 1, status: 1, createdAt: -1 });

/*
  The affiliate's own ledger page, which carries no status filter.
  
  Not redundant with the index above, and this was measured rather than assumed:
  without it, `find({affiliate}).sort({createdAt:-1}).limit(26)` cannot use
  {affiliate, status, createdAt} to satisfy the sort — `status` sits between the
  equality and the sort key — so Mongo walks EVERY key for that affiliate and sorts.
  At 100 rows that was 100 keys examined to return 26; it grows linearly, and it grows
  fastest for the most successful affiliates, who are the ones most likely to be
  looking at the page.
*/
AffiliateCommissionSchema.index({ affiliate: 1, createdAt: -1 });

// The maturation sweep: pending rows whose window has closed, oldest first.
AffiliateCommissionSchema.index({ status: 1, maturesAt: 1 });

// Payout detail view: "which rows did this batch pay?"
AffiliateCommissionSchema.index({ payout: 1 });

export default mongoose.model("AffiliateCommission", AffiliateCommissionSchema);

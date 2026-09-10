import mongoose from "mongoose";
import { PAYOUT_METHODS, PAYOUT_STATUS, PAYOUT_STATUSES } from "../config/affiliate.js";

/**
 * AffiliatePayout — a RECORD of a bank transfer that happened outside this system.
 *
 * We do not send money. There is no RazorpayX integration, no fund account, no KYC
 * flow. An admin batches an affiliate's approved commissions, transfers the net by
 * NEFT/IMPS/UPI from their own bank, and records the UTR here. The precedent is the
 * offline return refund (models/ReturnRequest.js), which is likewise "a RECORD of a
 * payout that already happened".
 *
 * ── WHERE THE CONCURRENCY GUARD LIVES ────────────────────────────────────────────
 * NOT here. The commission rows are the money, so the rows carry the claim:
 * affiliatePayoutService builds a batch by flipping
 * `{ affiliate, status: 'approved', payout: null } → { status: 'paid', payout: id }`
 * in one transaction. A second admin's identical updateMany matches zero rows and the
 * call 409s, so no second payout document with money on it can exist. Same shape as
 * couponUserUsageRepository's guarded upsert: counting is not atomic, a guarded write is.
 *
 * The totals are then summed FROM THE ROWS ACTUALLY CLAIMED, never from a read taken
 * before the claim — that gap is a TOCTOU window where a concurrent clawback would
 * make the payout overstate what it paid.
 *
 * ── NO PARTIAL STATE, DELIBERATELY ───────────────────────────────────────────────
 * A manual transfer is one instruction: it lands or it does not. `failed`/`cancelled`
 * RELEASE the claim (rows go back to `approved` / `payout: null` and can be re-batched).
 * A partial-payout state would require apportioning a bank event across rows using
 * information a bank statement does not give us.
 */
const AffiliatePayoutSchema = new mongoose.Schema(
  {
    affiliate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Affiliate",
      required: true,
    },

    status: {
      type: String,
      enum: PAYOUT_STATUSES,
      default: PAYOUT_STATUS.DRAFT,
    },

    // ── Money, all integer paise ────────────────────────────────────────────────
    /** Σ of the claimed rows. Computed AFTER the claim, from the rows themselves. */
    grossPaise: { type: Number, required: true, default: 0 },

    /**
     * TDS, snapshotted from Affiliate.tdsPercent at batch time.
     *
     * ⚠️ A RECORDED DEDUCTION, NOT A TAX ENGINE. See the note on Affiliate.tdsPercent:
     * which section applies (194H vs 194-O), at what rate, above what threshold, and
     * how GST is treated are a chartered accountant's determinations. This holds the
     * number so the payout reconciles with the bank statement and a 26Q export has
     * something to read. It computes nothing.
     */
    tdsPercent: { type: Number, min: 0, max: 100, default: 0 },
    tdsPaise: { type: Number, default: 0, min: 0 },

    /** gross − TDS. What actually leaves the bank. */
    netPaise: { type: Number, required: true, default: 0 },

    /** How many commission rows this batch claimed. Reporting only. */
    commissionCount: { type: Number, default: 0, min: 0 },

    // Oldest and newest claimed row, for the affiliate's statement. Derived, not filtered on.
    periodFrom: { type: Date, default: null },
    periodTo: { type: Date, default: null },

    /**
     * Who we paid, as it was at the time.
     *
     * A snapshot, because an affiliate can change their bank account and a payout must
     * always show the account the money actually went to. Never carries the full account
     * number or the PAN — `accountLast4` is enough to match a bank statement line, and
     * anything more would copy financial PII into a second, longer-lived collection.
     */
    bankSnapshot: {
      accountHolderName: { type: String, trim: true },
      accountLast4: { type: String, trim: true, maxlength: 4 },
      ifsc: { type: String, trim: true, uppercase: true },
      upiId: { type: String, trim: true },
    },

    method: { type: String, enum: PAYOUT_METHODS, default: undefined },

    /**
     * The bank's UTR / transaction reference — the same transfer can never be recorded
     * against two payouts, which is what catches an admin pasting a reference twice.
     *
     * ⚠️ The partial-unique index enforcing that is built ONLY in config/db.js (as
     * `unique_payout_reference`), never declared here. Outside production autoIndex is
     * ON, so a schema declaration would build the key under its generated name first,
     * config/db.js would then request the same key under a different name, MongoDB
     * would reject it, and that single error aborts the WHOLE index-verification pass —
     * silently dropping every index after it. See models/SpinResult.js for the incident.
     */
    reference: { type: String, trim: true, maxlength: 120, default: undefined },

    paidAt: { type: Date, default: null },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    failureReason: { type: String, trim: true, maxlength: 500 },
    notes: { type: String, trim: true, maxlength: 2000 },
  },
  { timestamps: true }
);

// Affiliate's payout history, newest first (also the self-serve portal's list).
AffiliatePayoutSchema.index({ affiliate: 1, createdAt: -1 });

// Admin queue: everything awaiting transfer, newest first.
AffiliatePayoutSchema.index({ status: 1, createdAt: -1 });

/*
  The `reference` partial-unique guard is in config/db.js — see the note on that field.

  It is a WRITE-SIDE GUARD only: the planner will not use a `$type` partial index for a
  plain `find({ reference })`, so a lookup-by-UTR would need its own plain index. Today
  nothing reads by reference, so none is declared.
*/

export default mongoose.model("AffiliatePayout", AffiliatePayoutSchema);

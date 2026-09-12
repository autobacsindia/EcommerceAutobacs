import mongoose from "mongoose";
import { encryptField } from "../utils/fieldEncryption.js";
import {
  AFFILIATE_STATUS,
  AFFILIATE_STATUSES,
  CODE_MAX_LENGTH,
  CODE_REGEX,
  DEFAULT_COMMISSION_PERCENT,
} from "../config/affiliate.js";

/**
 * Affiliate — a person who promotes the store and earns a percentage of what they bring in.
 *
 * ── OWNS THE DECISIONS, OWNS NO MONEY ────────────────────────────────────────────
 * This document decides WHO qualifies and at WHAT RATE. The buyer-facing discount is
 * applied through the managed Coupon at `coupon` (whose `code` equals this `code`), so
 * Order.discount, the invoice and refundMathService keep reading ONE set of figures.
 * The commission we owe is a separate ledger (models/AffiliateCommission.js) that never
 * touches the order's totals — it is our cost, not part of what the customer paid.
 *
 * Do NOT hand-edit an affiliate's managed coupon in the coupon admin. Change the
 * affiliate instead, or the two will disagree about what a buyer is owed. Same rule,
 * and same reason, as a campaign-managed coupon.
 *
 * ── WHY THIS IS NOT A `User.role` ────────────────────────────────────────────────
 * `User.role` stays `["customer","admin"]`. The house precedent for a new capability
 * is a flag resolved through a helper (`User.isSalesRep` → utils/salesReps.js), not a
 * widened role enum — see ADR-006. Here the Affiliate document IS the flag: a user is
 * an affiliate iff an active Affiliate row points at them. That also lets someone apply
 * before they have an account, and lets a non-customer partner (a garage, a channel)
 * exist without a login at all.
 */

/**
 * Bank / UPI details, collected only when there is money to send.
 *
 * ⚠️ FINANCIAL PII, AND THIS REPO HAS NO ENCRYPTION-AT-REST PRIMITIVE.
 * `accountNumber` and `panNumber` are `select: false`, so they are absent from every
 * query that does not explicitly ask for them — including every list endpoint, by
 * construction rather than by the repository remembering to project them out. The
 * repositories project them out as well; belt and braces, because the cost of getting
 * this wrong is bank details in an admin JSON response.
 *
 * `accountLast4` is maintained alongside `accountNumber` so the admin UI and the payout
 * snapshot can identify an account without ever reading the full number.
 *
 * Formats are validated, nothing more. There is no penny-drop / NPCI verification —
 * that is a vendor decision, and a format check must never be mistaken for one.
 */
const PayoutDetailsSchema = new mongoose.Schema(
  {
    accountHolderName: { type: String, trim: true, maxlength: 120 },

    /*
      ENCRYPTED AT REST (AES-256-GCM, utils/fieldEncryption.js).

      The setter runs on EVERY assignment path — Model.create, doc.set, findOneAndUpdate
      with runValidators — so no writer can forget to encrypt, and the format prefix makes
      it idempotent so re-saving a document cannot double-encrypt.

      There is deliberately NO getter. Decryption is explicit
      (affiliateRepository.decryptPayoutDetails), because an automatic getter would
      silently put a bank account number into any response that happened to serialise the
      document. Encryption you cannot forget; decryption you must ask for.

      `maxlength` is gone: the stored value is ciphertext, ~120 chars for a 12-digit
      account. Length is validated on the PLAINTEXT by the validators instead.
    */
    accountNumber: { type: String, trim: true, select: false, set: encryptField },

    /** Derived from the plaintext at write time, so readers never need to decrypt. */
    accountLast4: { type: String, trim: true, maxlength: 4 },

    ifsc: {
      type: String,
      trim: true,
      uppercase: true,
      // Standard RBI format: 4 alpha bank code, a literal 0, 6 alphanumeric branch.
      // Not encrypted: an IFSC identifies a bank BRANCH, not a person or an account —
      // it is public information printed on every cheque.
      match: [/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC code"],
    },

    upiId: { type: String, trim: true, maxlength: 120 },

    /*
      ENCRYPTED AT REST, same treatment as the account number.

      Mandatory to join the programme, because TDS deduction requires it and the rate is
      materially higher without one. That means it arrives on a PUBLIC form — which is
      exactly why it must not sit in the database in plaintext.

      ⚠️ The `match` validator cannot run here: the setter has already replaced the value
      with ciphertext by the time validation runs. PAN format is enforced on the plaintext
      in validators/affiliate.validator.js, which is the only place it is ever seen.
    */
    panNumber: { type: String, trim: true, select: false, set: encryptField },
  },
  { _id: false }
);

/**
 * Where the affiliate is, for GST place-of-supply.
 *
 * An affiliate's promotional work is a supply of services, and where that supply is
 * treated as made depends on their location — so this is collected up front rather than
 * chased later, when they have already crossed a threshold and need to invoice us.
 */
const AffiliateAddressSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200 },
    city: { type: String, trim: true, maxlength: 100 },
    /** Indian state/UT name, validated against config/gstStates.js on write. */
    state: { type: String, trim: true, maxlength: 100 },
    postalCode: { type: String, trim: true, maxlength: 10 },
    country: { type: String, trim: true, default: "India" },
  },
  { _id: false }
);

const AffiliateSchema = new mongoose.Schema(
  {
    /**
     * The promo code AND the `ref` value in the tracking link — deliberately one string,
     * so an affiliate has one thing to remember and one thing to share. Uppercased on
     * write; every lookup uppercases first, so matching is case-insensitive.
     *
     * ⚠️ NOT `required`, and NOT declared unique here. Both would be wrong:
     *
     *   - A PENDING application has no code. The code is minted at APPROVAL, because
     *     it is the capability — issuing one at submission time would let anyone mint
     *     a live-looking code by filling in a form. Marking this required makes the
     *     public application form reject every submission.
     *
     *   - A field-level `unique: true` builds a NON-sparse unique index, which indexes
     *     an absent path as null. The second pending application would then collide
     *     with the first on a duplicate key. The guard therefore lives in config/db.js
     *     as unique + SPARSE, so codeless applications are skipped entirely. Same trap,
     *     and same fix, as the `user` field below.
     *
     * affiliateService.approve is what guarantees an ACTIVE affiliate always has one.
     */
    code: {
      type: String,
      uppercase: true,
      trim: true,
      maxlength: CODE_MAX_LENGTH,
      match: [CODE_REGEX, "Invalid affiliate code"],
    },

    /**
     * The customer account this affiliate belongs to, once they have one.
     *
     * Optional: an application can arrive from someone with no account, and a partner
     * may never sign in at all (the SalesRep precedent). When set it is the strongest
     * self-referral signal we have — see services/affiliateAttributionService.js.
     *
     * ⚠️ NO `default: null`, deliberately — and never assign null to it either.
     *
     * The uniqueness guard below is SPARSE, and sparse skips only ABSENT fields: a
     * stored `null` is a value, so it gets indexed, and the SECOND account-less
     * application would collide with the first and be rejected. Leaving the path unset
     * is what makes "many affiliates without an account" representable at all.
     * tests/indexDrift.test.js fails on the `default: null` + sparse + unique combination
     * precisely because it is invisible until the second row arrives.
     *
     * To detach an affiliate from a user, `$unset` the path — do not set it to null.
     */
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    status: {
      type: String,
      enum: AFFILIATE_STATUSES,
      default: AFFILIATE_STATUS.PENDING,
    },

    /**
     * What WE pay the affiliate, as a percentage of the order's net goods
     * (refundMathService.orderGoodsNetPaise — subtotal minus discount, excluding
     * shipping and tax).
     *
     * ⚠️ This value is SNAPSHOTTED onto every order at creation (Order.affiliate
     * .commissionPercent) and the ledger reads the snapshot, never this field. Raising
     * a rate in March must not retroactively repay January — the same instinct that
     * makes orders snapshot their own money.
     */
    commissionPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: DEFAULT_COMMISSION_PERCENT,
    },

    /**
     * What we pay when the BUYER HAS ORDERED FROM US BEFORE.
     *
     * "Before" means before Autobacs, not before this affiliate. A returning buyer was
     * already ours: the affiliate reactivated them rather than acquiring them, and
     * reactivation is worth less than acquisition. This is the "new customer" rate split
     * every major affiliate network supports, and it is what makes paying on repeat
     * orders affordable instead of a silent leak.
     *
     * ⚠️ NO SCHEMA DEFAULT, for exactly the reason spelled out on `discountPercent`
     * below: approval fills the configured default only when the value `== null`, so a
     * schema default would make an admin's deliberate 0% unreachable — and 0 is the
     * supported way to say "pay nothing on repeat orders".
     *
     * ⚠️ Like `commissionPercent`, this is SNAPSHOTTED onto the order at creation and
     * the ledger reads the snapshot. Which of the two rates applied is recorded in
     * `Order.affiliate.newCustomer`.
     */
    repeatCommissionPercent: { type: Number, min: 0, max: 100 },

    /**
     * What the BUYER gets, as a percentage off. Mirrored onto the managed coupon's
     * `value` — this field is the affiliate-admin's view of it, the coupon is the money.
     *
     * ⚠️ NO DEFAULT, and NOT required. "Not yet decided" has to be representable.
     *
     * It was `default: 0`, which silently broke approval: affiliateService.approve fills
     * in the configured default only when the value `== null`, precisely so that an
     * admin's deliberate 0% is preserved. With a schema default of 0 it is never null,
     * so the fallback could never fire — every approved affiliate got a 0% buyer
     * discount and a managed coupon created INACTIVE, and the whole discount half of the
     * programme was dead on arrival.
     *
     * Left undefined on a pending application, set at approval. Do not reintroduce a
     * default here: the distinction between "unset" and "deliberately zero" is what the
     * approval logic reads.
     */
    discountPercent: { type: Number, min: 0, max: 100 },

    /*
     * ⚠️ `firstOrderOnly` USED TO LIVE HERE. Deliberately removed — do not reintroduce it.
     *
     * It restricted the managed coupon to buyers who had never ordered from Autobacs at
     * all, and it was the wrong tool twice over:
     *
     *   1. Its admin label said "only PAY on a customer's first order", but it only ever
     *      gated the COUPON. Commission accrual reads Order.affiliate and never looked at
     *      it, so a returning buyer arriving by tracking link earned the affiliate full
     *      commission while the customer got no discount — and typing the code instead
     *      hard-400'd the checkout outright. The two paths disagreed.
     *   2. It blocked affiliates from winning back a lapsed customer with a discount,
     *      which is real revenue.
     *
     * Both halves now live where they belong:
     *   - DISCOUNT: once per person, per code — the managed coupon's `usageLimitPerUser: 1`,
     *     enforced by the existing unique {coupon, user} index.
     *   - COMMISSION: `commissionPercent` vs `repeatCommissionPercent` above.
     *
     * `Coupon.firstOrderOnly` still exists and is still honoured for ORDINARY coupons.
     * It is only affiliate-managed coupons that stopped using it.
     */

    /**
     * The Coupon this affiliate manages. Created when the application is approved, in
     * the same transaction, so an active affiliate can never exist without its money path.
     */
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", default: null },

    // ── Application details ─────────────────────────────────────────────────────
    // Captured from the public form. `email` is the dedup key for an applicant with no
    // account, and one of the self-referral match keys.
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    phone: { type: String, trim: true, maxlength: 20 },
    website: { type: String, trim: true, maxlength: 500 },
    // How they intend to promote — free text, read by the human doing the approving.
    pitch: { type: String, trim: true, maxlength: 2000 },
    // Internal admin notes. Never surfaced to the affiliate.
    notes: { type: String, trim: true, maxlength: 2000 },

    payoutDetails: { type: PayoutDetailsSchema, default: () => ({}) },

    address: { type: AffiliateAddressSchema, default: () => ({}) },

    /**
     * Which version of the affiliate T&C this person accepted, and when.
     *
     * Stamped by the SERVER at application time from config/legalDocuments.js — never
     * taken from the request. A client that could name its own terms version could
     * choose which contract to be bound by, and the clauses here are substantive: a
     * commission rate, a payout cycle, a TDS deduction disclosure, a no-self-referral
     * rule and a termination clause. If any of those is disputed, "look at the current
     * page" is not an answer, because the page will have changed.
     *
     * `ipHash` is a sha256 of the applicant's IP — enough to evidence that a specific
     * request accepted the terms, without holding an address against a name. Mirrors
     * Order.legalAcceptance.
     */
    termsAcceptance: {
      version: { type: String },
      acceptedAt: { type: Date },
      ipHash: { type: String },
    },

    /** GSTIN, if the affiliate is registered. Optional — most will be below the threshold. */
    gstin: { type: String, trim: true, uppercase: true, maxlength: 15 },

    /**
     * TDS deducted at payout, as a percentage.
     *
     * ⚠️ RECORDED, NEVER DERIVED. Section 194H (commission/brokerage to a resident) very
     * likely applies, and 194-O may apply instead; both the rate and the annual threshold
     * change, and which section governs is a chartered accountant's determination, not a
     * developer's. Deducting, depositing and filing is a finance obligation — getting the
     * rate wrong is a penalty, not a bug.
     *
     * So this field HOLDS the number finance gives you and the payout snapshots it. There
     * is deliberately no threshold tracking, no financial-year aggregation, no 26Q
     * generation and no GST logic. Do not grow a tax engine here.
     */
    tdsPercent: { type: Number, min: 0, max: 100, default: 0 },

    /**
     * Transactional notifications already sent to this affiliate.
     *
     * A keyed set rather than a flag per email, following Order.notifiedStatuses: the
     * approval mail is keyed `approved`, a payout mail `payout:<batchId>`. That makes a
     * per-batch send naturally once-only without a new field each time we add a mail.
     *
     * Stamped only AFTER the provider accepts the message — stamping first would turn a
     * transient Postmark outage into a permanently unsent email.
     */
    notifiedEvents: { type: [String], default: [] },

    /**
     * The affiliate asked to be paid. A SIGNAL, NOT A MONEY ACTION.
     *
     * ⚠️ Nothing about this field moves, reserves, or authorises a rupee. It exists so a
     * person who can see a payable balance has a way to say "please send it" instead of
     * emailing support, and so the admin queue can show who is actually waiting rather
     * than treating every balance as equally urgent.
     *
     * The payout itself is still built by an admin (`POST /admin/:id/payouts`) and
     * settled by a human making a bank transfer. Cleared when a batch claims the rows,
     * so a stale request cannot make an already-paid affiliate look like they are still
     * waiting.
     *
     * `payoutRequestedBalancePaise` snapshots what they SAW when they asked. Kept purely
     * so the admin can spot a request that no longer matches reality — a clawback landing
     * between the request and the transfer is exactly when the two diverge.
     */
    payoutRequestedAt: { type: Date, default: null },
    payoutRequestedBalancePaise: { type: Number, default: null },

    approvedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    suspendedAt: { type: Date, default: null },
    suspendedReason: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

/**
 * Strip financial PII from every serialised response.
 *
 * `select: false` already keeps these out of ordinary reads; this catches the case
 * where a service legitimately selected them (to build a payout snapshot) and the
 * document then reaches a response body. Mirrors User.js stripping passwordHash.
 */
AffiliateSchema.set("toJSON", {
  transform: (_doc, ret) => {
    if (ret.payoutDetails) {
      delete ret.payoutDetails.accountNumber;
      delete ret.payoutDetails.panNumber;
    }
    return ret;
  },
});

// Admin list: filter by status, newest first.
AffiliateSchema.index({ status: 1, createdAt: -1 });
// One affiliate profile per customer account. Sparse, because `user` is ABSENT (never
// null — see the field note) on an application from someone without an account, and
// many such rows must be able to coexist.
AffiliateSchema.index({ user: 1 }, { unique: true, sparse: true });
/*
  `email` is uniquely indexed in config/db.js, not here.

  It is the dedup key for an application: affiliateService.apply looks a submission up
  by email and returns the existing row rather than creating a second. That lookup is a
  TOCTOU — two simultaneous submissions both see "no existing row" — so the unique index
  is what actually prevents a duplicate applicant, exactly as SalesRep's unique name
  backs its findByName pre-check.
*/

export default mongoose.model("Affiliate", AffiliateSchema);

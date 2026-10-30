import mongoose from "mongoose";
import {
  RETURN_REASONS,
  IN_FLIGHT_RETURN_STATUSES,
  FAULTS,
  DISPOSITIONS,
  RETURN_DESTINATIONS,
  PICKUP_MODES,
  FAILED_INSPECTION_ACTIONS,
  SUPPLIER_CLAIM_STATUSES,
  SUPPLIER_SETTLEMENT_KINDS,
  SUPPLIER_MONEY_METHODS,
} from "../config/returnPolicy.js";
import { revertFields } from "./shared/offlineRefundFields.js";

/**
 * A private (authenticated) Cloudinary asset attached to a return — the unboxing
 * video, proof-of-purchase, or an extra photo. We persist ONLY server-derived
 * values (publicId + type + bytes); the browsable URL is re-signed at view time
 * by an admin. Mirrors JobApplication.files so a leaked plain URL is useless.
 */
const CloudAssetSchema = new mongoose.Schema({
  publicId:     { type: String, required: true },
  resourceType: { type: String, enum: ["video", "image", "raw"], required: true },
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
 * Who caused the problem, for ONE line (rule 2). The customer's reason only claims a
 * fault; operations confirms it at review and may change it at inspection, always with
 * a note. The refund maths reads `confirmed ?? claimed` (returnPolicy.effectiveFault).
 * Absent on rows from before 2026-10-30 — those resolve through their reason.
 */
const LineFaultSchema = new mongoose.Schema({
  claimed:   { type: String, enum: FAULTS, default: null },
  confirmed: { type: String, enum: [...FAULTS, null], default: null },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  changedAt: { type: Date, default: null },
  note:      { type: String, trim: true, maxlength: 500, default: null },
}, { _id: false });

/**
 * One installation (service) line refunded with this return — a CUSTOM line on the
 * order (sales panel), picked by staff. `netPaidPaise` is the server's figure for what
 * the customer paid for it (its share of any discount taken off); `amountPaise` is what
 * is refunded, which staff may LOWER (with a reason) but never raise. A unique index
 * (db.js) makes one order line refundable at most once across all returns.
 */
const ServiceLineSchema = new mongoose.Schema({
  orderItemId:     { type: mongoose.Schema.Types.ObjectId, required: true },
  name:            { type: String, trim: true, maxlength: 200, default: '' },
  netPaidPaise:    { type: Number, min: 0, default: 0 },
  amountPaise:     { type: Number, min: 0, required: true },
  reductionReason: { type: String, trim: true, maxlength: 500, default: null },
}, { _id: false });

/**
 * A photo or PDF staff attached in the team panel (inspection photos, the supplier's
 * check, a courier receipt). Private, like parcel proofs: served only through the
 * staff route after the same permission check as the return itself.
 */
const StaffFileSchema = new mongoose.Schema({
  purpose:     { type: String, enum: ['inspection', 'supplier_check', 'supplier_ship_back', 'pickup'], required: true },
  claimId:     { type: mongoose.Schema.Types.ObjectId, default: null },
  publicId:    { type: String, required: true },
  provider:    { type: String, enum: ['cloudinary', 'r2'], default: 'cloudinary' },
  url:         String,
  contentType: { type: String, default: 'image/jpeg' },
  bytes:       { type: Number, default: 0 },
  name:        { type: String, default: '' },
  uploadedAt:  { type: Date, default: Date.now },
  uploadedBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
});

const ByAt = {
  by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  byName: { type: String, default: '' },
  at: { type: Date, default: null },
};

/**
 * The supplier track (rule 9.5B): procurement claims from the supplier the lines that
 * came from them, by hand, and records each step here; accounts confirms the money.
 * One claim per supplier on the return. Never blocks the customer refund.
 */
const SupplierClaimSchema = new mongoose.Schema({
  status:       { type: String, enum: SUPPLIER_CLAIM_STATUSES, default: 'open' },
  supplierName: { type: String, trim: true, maxlength: 120, required: true },
  supplier:     { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null },
  // The order lines (Order.items[]._id) this claim covers.
  orderItemIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  // The supplier payment request we paid for these lines (PR-0000), when one exists.
  paymentRequest:    { type: mongoose.Schema.Types.ObjectId, ref: "PaymentRequest", default: null },
  paymentRequestRef: { type: String, trim: true, maxlength: 20, default: null },
  openedAt:     { type: Date, default: Date.now },
  // The supplier's answer.
  answer: {
    accepted:  { type: Boolean, default: null },
    reference: { type: String, trim: true, maxlength: 120, default: null }, // their RMA / reference
    note:      { type: String, trim: true, maxlength: 1000, default: null },
    ...ByAt,
  },
  // The item on its way back to the supplier (when it came to our warehouse first).
  shipBack: {
    courier:        { type: String, trim: true, maxlength: 80, default: null },
    trackingNumber: { type: String, trim: true, maxlength: 80, default: null },
    ...ByAt,
  },
  // The supplier's own inspection.
  supplierCheck: {
    passed: { type: Boolean, default: null },
    notes:  { type: String, trim: true, maxlength: 1000, default: null },
    ...ByAt,
  },
  // What the supplier promised, and — set by accounts, once — that it arrived.
  settlement: {
    kind:        { type: String, enum: [...SUPPLIER_SETTLEMENT_KINDS, null], default: null },
    amountPaise: { type: Number, min: 0, default: null },
    reference:   { type: String, trim: true, maxlength: 120, default: null },
    promisedAt:  { type: Date, default: null },
    promisedBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    promisedByName: { type: String, default: '' },
    received: {
      method:          { type: String, enum: [...SUPPLIER_MONEY_METHODS, null], default: null },
      utr:             { type: String, trim: true, maxlength: 120, default: null },
      deductedFromRef: { type: String, trim: true, maxlength: 20, default: null }, // PR-0000
      deductedFrom:    { type: mongoose.Schema.Types.ObjectId, ref: "PaymentRequest", default: null },
      note:            { type: String, trim: true, maxlength: 500, default: null },
      ...ByAt,
    },
  },
  // Supplier rejected a claim operations confirmed as OUR fault: the customer is still
  // refunded, and the loss is recorded against the supplier here.
  loss: {
    recorded: { type: Boolean, default: false },
    note:     { type: String, trim: true, maxlength: 1000, default: null },
    ...ByAt,
  },
  closedAt: { type: Date, default: null },
});

const ReturnRequestSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Order",
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    // Required for a customer-raised return (it was raised from their account), but NOT
    // for one an admin records after the fact: legacy WooCommerce and guest orders carry
    // no user (Order.user has the same conditional shape), and those are exactly the
    // orders most likely to be settled over the counter. reverseReturnLtvOnce already
    // no-ops on a userless return, so net LTV is simply not adjusted for one.
    // A STAFF-raised return is the same: a salesperson raising one for a guest order.
    required: function () { return this.origin === "customer"; }
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true
    },
    /*
      The order line this return line came from (Order.items[]._id) — the exact handle.
      Product + variant is only NEARLY exact: one product can sit on two lines. Absent
      on rows from before 2026-10-30; matchOrderLine falls back to product + variant.
    */
    orderItemId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Set for a returned line of a variable product (which variant was bought).
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
    /**
     * Human-readable name of that variant, snapshotted from the ORDER LINE for the
     * same reason `unitPrice` below is — so the approval screen never re-reads a
     * since-renamed or since-deleted variant off the live product.
     *
     * Display only; nothing in the refund maths reads it (`matchOrderLine` keys on
     * `_id`, then product + `variantId`). It exists because `product.name` is the
     * PARENT product's name and routinely lists every option at once, so an admin
     * approving a return otherwise cannot tell WHICH model is coming back.
     *
     * `null` on a simple product, and absent on every return request created before
     * this field — those still carry `variantId`, so nothing is lost, but the label
     * simply does not render for them.
     */
    variantLabel: { type: String, default: null },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    reason: {
      type: String,
      enum: RETURN_REASONS,
      required: true
    },
    fault: { type: LineFaultSchema, default: undefined },
    // Charged price of ONE unit at request time (rupees). Snapshotted from the
    // order line so the refund calculation never re-reads a since-changed product
    // price. Sum(unitPrice × quantity) is the refundable product value.
    unitPrice: { type: Number, required: true, min: 0 }
  }],
  // Exchanges + store-credit were dropped by operations (2026-07-31). Every
  // accepted return refunds to the original payment method. Kept as a pinned
  // field for analytics / forward compatibility.
  type: {
    type: String,
    enum: ["return"],
    default: "return"
  },
  // How this record came into being.
  //   customer     → raised through the storefront, with the mandatory evidence and
  //                  inside the 4-day window. The normal path.
  //   admin_offline → the return happened off-platform (walk-in, phone, sales rep) and
  //                  an admin is RECORDING it. The policy gates (window, unboxing video,
  //                  proof of purchase, non-returnable classes, courier + inspection)
  //                  are deliberately not applied — there is nothing to apply them to.
  //                  The money guards still are: the refund base is recomputed from the
  //                  order and capped by remainingRefundable exactly as for any return.
  // Kept as a first-class field so finance can tell recorded-by-hand money apart from
  // gateway-driven money without inferring it from a missing video.
  // No `index: true`: nothing queries by origin today, and prod runs autoIndex:false —
  // a declared-but-never-built index is exactly the drift `npm run audit-index-drift`
  // exists to catch. Add it with a migration if an origin filter is ever needed.
  //   staff        → a salesperson / operations raised it ON THE CUSTOMER'S BEHALF
  //                  (phone, WhatsApp, walk-in). Unlike admin_offline, every policy
  //                  gate applies — window, evidence (at least one photo or video the
  //                  customer sent), returnable product — and it runs the full flow.
  origin: {
    type: String,
    enum: ["customer", "admin_offline", "staff"],
    default: "customer"
  },
  // The admin who recorded an offline return (null for a customer-raised one).
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  // The staff member who raised a `staff` return.
  raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  // Snapshots from the order, for the team panel: the seller (Order.salesUser) is told
  // at each step and sees the return under "Mine"; the phone counts a guest customer's
  // earlier returns (the repeat-returner flag). Absent on rows from before 2026-10-30.
  seller:        { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  customerPhone: { type: String, trim: true, maxlength: 15, default: null },
  // Check 1 (rule 9.2): who reviewed the evidence, and when — the 1-day target is
  // measured from createdAt to reviewedAt.
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
  // Refund only in phase 1. Same-product replacement is phase 2.
  resolution: { type: String, enum: ["refund"], default: "refund" },
  // Where the item goes, confirmed at check 1 (pre-filled from the order).
  destination: {
    kind:         { type: String, enum: [...RETURN_DESTINATIONS, null], default: null },
    supplierName: { type: String, trim: true, maxlength: 120, default: null },
  },
  // How it travels back. `courier` below holds the courier + AWB for both courier
  // modes; `bookedBy` says who booked a direct-to-supplier pickup.
  pickup: {
    mode:     { type: String, enum: [...PICKUP_MODES, null], default: null },
    bookedBy: { type: String, enum: ['us', 'supplier', null], default: null },
    note:     { type: String, trim: true, maxlength: 500, default: null },
    at:       { type: Date, default: null },
  },
  // A customer-reason return is allowed only for goods that are unused, uninstalled
  // and in the original box. When the customer (or staff, for them) declared that.
  unusedDeclaredAt: { type: Date, default: null },
  // Lifecycle:
  //   pending        → submitted, awaiting operations review
  //   approved       → operations approved; return courier to be booked by us
  //   courier_booked → pickup arranged (we always book the courier)
  //   received       → item is back at the warehouse
  //   refunded       → passed inspection and refund initiated to original payment
  //   rejected       → declined at review OR failed inspection (see rejectionReason)
  //   cancelled      → customer withdrew the request
  status: {
    type: String,
    enum: ["pending", "approved", "courier_booked", "received", "refunded", "rejected", "cancelled"],
    default: "pending"
  },

  // ── Mandatory documentation (all three required to submit; enforced in the
  //    controller against Cloudinary — matches "all three required or rejected").
  video:              { type: CloudAssetSchema, default: null }, // continuous unboxing video
  proofOfPurchase:    { type: CloudAssetSchema, default: null }, // invoice / payment proof
  problemDescription: { type: String, required: true, trim: true, maxlength: 2000 },
  images:             { type: [CloudAssetSchema], default: [] }, // optional extra photos

  // Who bears the return courier. All accepted reasons are Roavion-attributable,
  // so this defaults to 'roavion'; operations can flip it (goodwill/discretion)
  // and enter the actual shipping deduction when initiating the refund.
  shippingBorneBy: { type: String, enum: ["roavion", "customer"], default: "roavion" },
  // Set by bookCourier; BOTH fields are required to enter `courier_booked`. Editable
  // while still in `courier_booked` so a wrong AWB can be corrected (it is mandatory,
  // customer-emailed, and our claim handle), frozen from `received` onward.
  courier: {
    provider:       String,
    trackingNumber: String,
    // When the goods left the customer. Preserved across a correction — a courier
    // claim turns on the original handover, not on when we fixed a typo.
    bookedAt:       Date,
    correctedAt:    Date,
    bookedBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },

  // Warehouse inspection outcome. Refund is gated on `passed === true`; a failed
  // inspection moves the request to `rejected` with the reason.
  inspection: {
    passed: { type: Boolean, default: null },
    notes:  String,
    at:     Date,
    by:     { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // What happens to the item now. A record only — stock is the coarse in/low/out
    // enum, so nothing here moves a quantity.
    disposition: { type: String, enum: [...DISPOSITIONS, null], default: null },
    // Failed (customer damage): sent back at their cost, or held then disposed of.
    failAction:  { type: String, enum: [...FAILED_INSPECTION_ACTIONS, null], default: null },
    holdUntil:   { type: Date, default: null },
    // Direct-to-supplier: procurement records the supplier's check; operations then
    // confirms it (operations always owns the fault decision towards the customer).
    supplierCheck: {
      passed: { type: Boolean, default: null },
      notes:  { type: String, trim: true, maxlength: 1000, default: null },
      ...ByAt,
    },
  },

  // Photos / PDFs staff attached in the team panel (see StaffFileSchema).
  staffFiles: { type: [StaffFileSchema], default: [] },

  // The supplier track — one claim per supplier the returned lines came from.
  supplierClaims: { type: [SupplierClaimSchema], default: [] },

  // Each failed pickup attempt. MAX_FAILED_PICKUPS of them cancel the request.
  pickupAttempts: {
    type: [{
      at:   { type: Date, required: true },
      note: { type: String, trim: true, maxlength: 500 },
      by:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      _id: false,
    }],
    default: [],
  },

  // Refund is decided BY HAND at initiation (full, or minus shipping / restocking).
  // All amounts in rupees. finalAmount is what is sent to Razorpay.
  refund: {
    // What the customer ACTUALLY PAID for the returned lines: their gross value
    // minus their prorated share of the order-level discount (coupon + karma).
    // This — never the gross figure — is the base every refund is computed from.
    // See services/refundMathService.js for why, and note it is RECOMPUTED from the
    // order at refund-initiation time rather than trusted from this snapshot.
    productValue:         { type: Number, default: 0 },
    // Gross list value Σ(unitPrice × qty) and the discount share subtracted from it.
    // Display-only (the admin screen strikes `listValue` through and shows the
    // difference), but persisted so a past refund can be explained without
    // re-deriving it from an order that may since have been edited.
    listValue:            { type: Number, default: 0 },
    discountShare:        { type: Number, default: 0 },
    shippingDeduction:    { type: Number, default: 0 }, // manual, variable — mirrors pickupDeduction
    // Our-fault lines only: their share of the original shipping charge (rupees).
    shippingShare:        { type: Number, default: 0 },
    // Our-fault returns only: the installation line(s) refunded with this return.
    serviceLines:         { type: [ServiceLineSchema], default: [] },
    // Customer-reason lines only: the real pickup cost (rupees) and why. Kept beside
    // the legacy `shippingDeduction`, which carries the same figure for older readers.
    pickupDeduction:       { type: Number, default: 0 },
    pickupDeductionReason: { type: String, trim: true, maxlength: 500, default: null },
    // GST credit note number accounts types on the refund. Free text; never computed.
    creditNoteNo:          { type: String, trim: true, maxlength: 60, default: null },
    restockingDeduction:  { type: Number, default: 0 }, // 10% on >₹1L (suggested) / oversized (manual)
    finalAmount:          { type: Number, default: 0 },
    // original_payment → sent through Razorpay to the instrument that paid.
    // offline          → money already handed back outside the gateway (cash at the
    //                    counter, NEFT, UPI, cheque). Nothing is sent to Razorpay; this
    //                    is a RECORD of a payout that already happened, which is why
    //                    `reference` is mandatory for it — that string is the only
    //                    evidence the money moved.
    method:               { type: String, enum: ["original_payment", "offline"], default: "original_payment" },
    // Only for method === 'offline'.
    offlineMethod:        { type: String, enum: ["cash", "bank_transfer", "upi", "cheque", "other"], default: undefined },
    reference:            String, // UTR / cheque no / receipt no — required when offline
    paidAt:               Date,   // when the money actually left, if not now
    razorpayRefundId:     String,
    status:               { type: String, enum: ["pending", "processing", "completed", "failed"], default: "pending" },
    initiatedBy:          { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    initiatedAt:          Date,
    completedAt:          Date,
    failureReason:        String,
    // Once-only guard for the net-LTV reversal (subtract finalAmount from the
    // customer's totalSpentPaise). Flipped atomically the first time a completed
    // refund reverses LTV, so the immediate-completion path and the refund.processed
    // webhook can't both decrement (PAY-2 / ADR-006, partial-refund variant).
    ltvReversed:          { type: Boolean, default: false },
    // Same once-only shape, for the cumulative Payment.refundAmount write. That write
    // is an atomic $inc and therefore NOT idempotent: an instant refund whose
    // refund.processed webhook lands before this controller has persisted its status
    // would otherwise be counted twice on the payment row. Reset to false by
    // claimForRefund so a retry after a failed attempt can record again.
    paymentRecorded:      { type: Boolean, default: false },

    /*
      What the affiliate commission clawback actually took, in paise, when this refund
      completed. Persisted so a revert reinstates EXACTLY that figure rather than
      re-deriving it from an order that may have changed since — see
      models/shared/offlineRefundFields.js.
    */
    affiliateClawbackPaise: Number,

    /*
      What actually landed, in paise — see models/shared/offlineRefundFields.js for why
      the `paymentRecorded` / `ltvReversed` claim flags cannot stand in for these (they
      are set before the work, so they stay `true` when it fails).
    */
    paymentRecordedPaise: Number,
    ltvDecrementedPaise: Number,

    // Admin reversal of an OFFLINE refund record. Never available for a refund that
    // went through Razorpay: gateway money cannot be un-refunded by a field write.
    ...revertFields()
  },

  adminNotes:      String,
  rejectionReason: String,

  // Email idempotency stamp: set once the "request received" acknowledgement is
  // accepted by the provider, so a queue retry never double-mails the customer.
  submittedEmailedAt: { type: Date, default: null },
  // The same idea for every LATER email: one key per email actually accepted by the
  // provider ("approved", "refunded", "courier_booked:<AWB>"…). A queue retry or a
  // double-click finds the key and sends nothing. The courier key carries the AWB so a
  // CORRECTED AWB is still emailed — that is a different message, on purpose.
  emailsSent: {
    type: [{ key: { type: String, required: true }, at: { type: Date, required: true }, _id: false }],
    default: [],
  },

  timeline: [{
    status:    String,
    note:      String,
    timestamp: { type: Date, default: Date.now },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  }]
}, {
  timestamps: true
});

// Index for faster lookups
ReturnRequestSchema.index({ user: 1, status: 1 });
ReturnRequestSchema.index({ order: 1 });
ReturnRequestSchema.index({ status: 1, createdAt: -1 }); // admin queue (filter + sort)
// DB-level idempotency: one IN-FLIGHT return per order+product pair.
// This is the race-safe backstop the controller pre-check relies on — two
// concurrent POST /returns for the same line both pass the findOne check, then the
// second create() hits E11000 here instead of creating a duplicate return.
//   - `unique: true` is what actually enforces it (was missing → enforced nothing).
//   - The partial filter MUST use `$in` (an enumerated positive set): `$ne` is not a
//     supported operator in a partialFilterExpression, so the previous `$ne:'cancelled'`
//     form threw at index build and the index was never created at all. The status
//     list lives in returnPolicy.js so the controller pre-check uses the identical set.
// Multikey (items.product is an array): each returned line contributes a key, so the
// uniqueness is per (order, product) across in-flight returns — exactly the guarantee.
// autoIndex is off in prod, so db.js ensureCriticalIndexes builds this there too.
//
// ⚠️ SCOPED TO IN-FLIGHT, NOT "ACTIVE". It previously covered the terminal `refunded`
// and `rejected` too, which made a return one-shot per product for the life of the
// order: a customer who sent back 1 of 3 faulty items could never claim the other 2,
// even though the form let them choose a partial quantity. What bounds a repeat is now
// QUANTITY (checked in returnController against the units actually consumed); what this
// index bounds is CONCURRENCY — two simultaneous submissions both target `pending`, so
// the second still hits E11000 rather than creating a duplicate.
//
// ⚠️ NEW NAME on purpose. MongoDB refuses to recreate an existing index name with
// different options, and would fail the whole verification pass — db.js drops the old
// `unique_active_return_per_order_product` before building this one.
ReturnRequestSchema.index(
  { order: 1, 'items.product': 1 },
  {
    name: 'unique_inflight_return_per_order_product',
    unique: true,
    partialFilterExpression: { status: { $in: IN_FLIGHT_RETURN_STATUSES } }
  }
);

/*
  MONEY: an installation (service) line is refunded at most ONCE across every return on
  the order. Two returns refunded at the same moment by two people would each pass a
  read-then-write check, so the guarantee is this unique index: claimForRefund writes the
  service lines in the SAME atomic update that moves the refund to `processing`, and the
  second claim for the same order line hits E11000 instead of paying twice.

  Scoped to committed refunds only. A `failed` attempt or a reverted offline record drops
  out of the index, so the line can be claimed again by a retry. The `$exists` limb keeps
  every return WITHOUT service lines out of the index: a unique index treats a missing
  field as null, and every such return would otherwise collide with the next.
  Built by db.js ensureCriticalIndexes (autoIndex is off in prod).
*/
ReturnRequestSchema.index(
  { 'refund.serviceLines.orderItemId': 1 },
  {
    name: 'unique_refunded_service_line',
    unique: true,
    partialFilterExpression: {
      'refund.status': { $in: ['processing', 'completed'] },
      'refund.serviceLines.orderItemId': { $exists: true },
    },
  }
);

export default mongoose.model("ReturnRequest", ReturnRequestSchema);

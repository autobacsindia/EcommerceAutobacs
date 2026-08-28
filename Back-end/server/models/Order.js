import mongoose from "mongoose";

const OrderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    // Not required for historical WooCommerce orders (ADR-005); live orders always carry a user.
    required: function () { return this.source !== "woocommerce"; }
  },

  // WooCommerce migration linkage (ADR-005). Historical orders are flagged so they feed
  // analytics but stay out of live fulfilment queues.
  wpId: { type: Number, index: { unique: true, sparse: true } },
  // "offline" = deal closed by the sales team off-platform, entered by an admin.
  // The buyer becomes a real customer (order in their history) and sets a password
  // on first login. See orderController.createOfflineOrder.
  source: { type: String, enum: ["web", "woocommerce", "offline"], default: "web", index: true },
  // For offline deals: the name-only SalesRep credited with closing it. See SalesRep.js.
  salesRep: { type: mongoose.Schema.Types.ObjectId, ref: "SalesRep", default: null },
  // Razorpay Payment Link (offline "collect payment" flow): the order sits in
  // awaiting_payment until the customer pays the link, then the webhook confirms it.
  paymentLinkId: { type: String, default: null, index: true },
  paymentLinkUrl: { type: String, default: null },
  // The specific CRM lead this offline order closes. Set when payment is deferred
  // (link flow) so the webhook converts THAT lead even if its identity (e.g. a
  // phone-only consultation) differs from the order's. See leadSyncService.
  crmLeadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null },
  legacyStatus: String,

  // Marketing-attribution signals captured from the buyer's browser at order
  // creation, replayed to Meta's Conversions API on payment success (services/
  // metaCapiService.js). Improves ad match quality; server-side so it survives
  // iOS/ad-blocker loss of the client Pixel. All optional — absent for offline
  // orders and pre-Pixel orders.
  // All fields are client-controlled → length-capped (utils/metaTracking.js also
  // truncates/validates before write; these are defense-in-depth).
  tracking: {
    fbp: { type: String, maxlength: 256 },            // Meta browser id cookie (_fbp)
    fbc: { type: String, maxlength: 256 },            // Meta click id cookie (_fbc), set from fbclid
    clientIp: { type: String, maxlength: 64 },        // buyer IP at checkout (req.ip, trust proxy=2)
    userAgent: { type: String, maxlength: 512 },      // buyer UA at checkout
    eventSourceUrl: { type: String, maxlength: 1024 },// the checkout page URL (validated http/https)
  },

  items: [
    {
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        // Historical line items may reference products no longer in catalog; name/price are snapshotted.
        required: function () { return this.parent()?.source !== "woocommerce"; }
      },
      // Selected variant (variable products only). Snapshotted like name/price so
      // order history + invoices stay correct even if the variant is later edited
      // or the product is removed. null for simple products.
      variantId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
      },
      variantLabel: {
        type: String,
        default: null
      },
      quantity: {
        type: Number,
        required: true,
        min: 1
      },
      price: {
        type: Number,
        required: true
      },
      // Catalogue (list) price at the time of sale for an OFFLINE order line,
      // snapshotted ONLY when the sales rep charged `price` below list (a genuine
      // rep markdown). null = "no rep markdown on this line" — which is the case
      // for full-price offline sales AND for every online / legacy order.
      // Per-line rep discount = listPrice ? (listPrice - price) : 0.
      // IMPORTANT: this captures the OFFLINE rep markdown ONLY. Online-order
      // discounts (coupons, redeemed karma, sale markdowns) are NOT recorded here —
      // they live in the order-level `discount` / `couponDiscount` / `karmaDiscount`
      // fields. Any total-discount report must sum those too, never listPrice alone,
      // or online discounts will be under-reported as ₹0.
      listPrice: {
        type: Number,
        default: null
      },
      /**
       * This line's OWN share of the order's coupon discount, in INTEGER PAISE.
       *
       * Written only when the coupon was priced by a campaign's PER-PRODUCT tier ladder,
       * where each line can earn a different rate (3% / 5% / 8% / 4%, or 2% when the
       * product was already on offer). 0 or absent means "no per-line attribution" — the
       * case for every ordinary coupon, every cart-value campaign, and every historical
       * order — and refundMathService then falls back to prorating `discount` by line
       * gross value, which is exact when one rate covers the whole cart.
       *
       * WHY IT MUST BE SNAPSHOTTED: a blended cart cannot be un-blended afterwards.
       * Refunding a returned line means knowing what THAT line was discounted by, and
       * proration answers with the cart average — over-refunding the 2% item and
       * under-refunding the 8% one. Orders are immutable financial records; this is part
       * of the record.
       *
       * Paise, not rupees, deliberately: it is consumed by integer money maths and never
       * displayed directly, so a float round-trip would only add a way to be wrong.
       * Karma is NOT included — it is a whole-cart discount with no per-line meaning and
       * stays prorated.
       */
      discountPaise: {
        type: Number,
        default: 0,
        min: 0
      },
      name: String,
      image: String
    }
  ],
  shippingAddress: {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    addressLine1: { type: String, required: true },
    addressLine2: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: { type: String, required: true },
    country: { type: String, default: "India" }
  },
  payment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Payment"
  },
  assignedWarehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Warehouse"
  },
  deliveryZone: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "DeliveryZone"
  },
  subtotal: {
    type: Number,
    required: true
  },
  shippingCost: {
    type: Number,
    default: 0
  },
  tax: {
    type: Number,
    default: 0
  },
  discount: {
    type: Number,
    default: 0
  },
  // Discount breakdown (server-computed; see services/pricingService.js).
  // `discount` above is the goods-level total = couponDiscount + karmaDiscount.
  couponCode: { type: String, default: null },      // applied coupon code snapshot
  couponDiscount: { type: Number, default: 0 },     // rupee discount from the coupon (goods)
  karmaDiscount: { type: Number, default: 0 },      // rupee discount from redeemed karma
  karmaPointsUsed: { type: Number, default: 0 },     // points spent on this order
  karmaAwarded: { type: Boolean, default: false },   // earn-on-delivery idempotency flag
  purchaseCounted: { type: Boolean, default: false }, // once-only guard for the CRM purchase denorm + net LTV (markPurchased)
  purchaseReversed: { type: Boolean, default: false }, // once-only guard for the refund/return LTV reversal (reversePurchase) — PAY-2 / ADR-006
  totalAmount: {
    type: Number,
    required: true
  },
  // FULFILLMENT status only (the "where is the parcel?" axis). Payment lives on
  // paymentStatus below. `awaiting_payment` is the internal pre-payment state for a
  // just-created order (rendered as "—" in admin — not a real stage); it flips to
  // `processing` the moment payment is captured. Legacy values (pending/confirmed/
  // failed/refunded) were migrated out — see scripts/migrate-order-status-phase2.js.
  status: {
    type: String,
    enum: ["awaiting_payment", "processing", "shipped", "delivered", "returned", "cancelled"],
    default: "awaiting_payment"
  },

  // Denormalized PAYMENT state — the "did we get paid?" axis, kept separate from
  // `status` (the fulfillment axis). Source of truth is the Payment doc + the
  // Razorpay webhook; this mirror is maintained centrally in orderStatusService
  // and drives the admin "Payment" column. (Phase 1 of the payment/fulfillment
  // split — Phase 2 will slim `status` down to fulfillment-only stages.)
  // `cancelled` = the CUSTOMER cancelled the payment (dismissed the Razorpay
  // popup) — distinct from a `status: cancelled` admin order-cancellation. The
  // order stays `awaiting_payment` (retry still possible) and becomes a
  // "payment cancelled" lead.
  // `expired` = the customer never returned to pay (closed the tab / walked away).
  // Set by the abandoned-order sweep (services/leadSweepService.js) ONLY after the
  // payment-reconciliation window has closed, so a genuinely-paid-but-webhook-missed
  // order is never wrongly buried. Distinct from `failed` (gateway rejected an
  // attempt) and `cancelled` (popup dismissed). These drop out of the default admin
  // Orders view and live on as "left at checkout" CRM leads.
  paymentStatus: {
    type: String,
    enum: ["pending", "paid", "failed", "refunded", "cancelled", "expired"],
    default: "pending",
    index: true
  },

  // Contact email for guest orders — allows confirmation emails, support, and admin visibility
  // Not required for authenticated orders (user.email is the source of truth)
  guestEmail: {
    type: String,
    lowercase: true,
    trim: true,
    validate: {
      validator: v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      message: 'Invalid guest email address'
    }
  },

  // Razorpay order id (order_xxx) for the CURRENT payment attempt, stamped when
  // POST /razorpay/create-order mints the gateway order. Lets the reconciliation
  // sweep (services/paymentReconciliationService.js) ask Razorpay whether a stuck
  // awaiting_payment order was in fact captured — the safety net for a missed or
  // misconfigured webhook. Sparse: only gateway-checkout orders carry it (offline
  // payment-link orders are resolved by the payment_link.paid webhook instead).
  razorpayOrderId: { type: String, default: null },

  // Guest checkout session binding (prevents order hijacking)
  sessionId: String,  // Client-provided session ID (for initial order lookup)
  guestSessionHash: String,  // SHA256 hash of server-generated session token (defense-in-depth)
  sessionCreatedAt: Date,  // Timestamp when session was created (anti-replay)
  guestIPHash: String,  // SHA256 hash of guest IP (forensic visibility)
  guestUAHash: String,  // SHA256 hash of guest User-Agent (anomaly detection)
  securityFlags: [{  // Security event tracking
    type: String,
    enum: ['SESSION_EXPIRED_DURING_PAYMENT', 'SESSION_MISMATCH', 'REDIS_UNAVAILABLE', 'GUEST_UA_MISMATCH', 'GUEST_IP_MISMATCH']
  }],
  
  statusHistory: [{
    status: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    reason: String,
    notes: String,
    metadata: mongoose.Schema.Types.Mixed
  }],
  // Invoice/receipt (generated on payment success — see services/invoiceService.js).
  // invoiceNo is the monotonic, human-facing invoice number (assigned once at
  // issuance from the "invoice" Counter, then stable for the life of the order);
  // invoiceUrl/invoicePublicId are set only when Cloudinary storage is enabled;
  // invoiceEmailedAt is the idempotency guard so the invoice email fires once.
  invoiceNo: { type: Number, index: { unique: true, sparse: true } },
  invoiceUrl: String,
  invoicePublicId: String,
  invoiceEmailedAt: Date,
  // Fulfillment-status emails already sent to the customer. Idempotency guard so a
  // BullMQ retry of send-order-status-email never double-notifies (see services/orderStatusEmailService.js).
  notifiedStatuses: {
    type: [String],
    default: []
  },
  // Set once the +1-day post-delivery review-request email is sent, so the delayed
  // send-review-request job is idempotent (see services/reviewRequestService.js).
  reviewRequestedAt: Date,

  /**
   * The post-purchase Spin-to-Win reward, denormalised onto the order so the packing
   * team physically cannot miss it. Authoritative record is the SpinResult document;
   * this is a read-optimised snapshot for the admin order screen, the packing slip and
   * the order-placed alert email.
   *
   * ⚠️ DELIBERATELY *NOT* A LINE ITEM. Pushing the goodie into `items` would corrupt
   * every consumer of the financial record: refundMathService's proration base (which
   * has already over-refunded discounted orders once), the GST invoice PDF, Meta CAPI
   * and Google Ads conversion value, units-sold in LTV/analytics, and returns
   * eligibility — a free gift would become "returnable". Orders are immutable financial
   * records; a ₹0 prize is not part of what the customer was charged.
   *
   * ⚠️ Declared as a single-nested SUBDOCUMENT SCHEMA with `default: null`, never a bare
   * nested path with per-field defaults. A `default:` on a nested path materialises the
   * subdocument on EVERY order, and the admin UI then shows a phantom reward on orders
   * that never spun — the exact bug that produced phantom return/refund subdocs here.
   */
  spinReward: {
    type: new mongoose.Schema({
      result: { type: mongoose.Schema.Types.ObjectId, ref: "SpinResult", required: true },
      prize: { type: mongoose.Schema.Types.ObjectId, ref: "SpinPrize", required: true },
      name: { type: String, required: true },
      sku: { type: String, default: null },
      kind: { type: String, required: true },
      imageUrl: { type: String, default: null },
      wonAt: { type: Date, required: true },
      fulfilledAt: { type: Date, default: null },
      /** Set when the order is cancelled/refunded — renders as DO NOT PACK. */
      voidedAt: { type: Date, default: null },
    }, { _id: false }),
    default: null,
  },

  /*
    Set when an abandoned checkout's MONEY HOLDS were handed back — the coupon's global
    and per-user counters, the campaign redemption slot, and any karma points debited.

    All three are taken at order CREATION, before a rupee moves, because that is the only
    way two racing tabs can be stopped from both claiming the last one. The consequence is
    that a customer who never pays has still spent them: without this sweep they are told
    "you have already used this offer" for ever, and a campaign's cap drains on orders
    that were never orders. See sweepStaleCheckoutHolds in services/leadSweepService.js.

    It is also a GATE, not just a record: once the holds are gone the order must never be
    payable again, or the discount would be charged with nothing counting against the
    campaign's cap. routes/razorpay.js refuses to mint a gateway order for one of these.

    Distinct from the fulfilment and payment axes on purpose — releasing a hold says
    nothing about where the parcel is or what the gateway thinks, so it must not disturb
    either (CRM lead classification reads paymentStatus).
  */
  holdsReleasedAt: { type: Date, default: null },

  /**
   * PARCELS. An order can leave in more than one box — stock arrives at different
   * times, an oversized item goes by a different courier — and each parcel has its own
   * courier, AWB, slip and delivery date.
   *
   * ⚠️ `Order.status` REMAINS THE SIX-VALUE ENUM and is DERIVED from this array by
   * utils/orderFulfilment.js `rollUpStatus`. We deliberately did not add a
   * `partially_shipped` value: it would ripple through every consumer that switches on
   * status (admin filters, the {status,createdAt} index, CRM lead classification,
   * analytics reports) and buys nothing the roll-up cannot express. Partiality is a
   * DISPLAY label from `fulfilmentSummary`, never stored state.
   *
   * ⚠️ LEGACY ORDERS CARRY NONE OF THIS, deliberately. Every order placed before split
   * shipments existed has an empty array plus the flat `trackingNumber`/`carrier`/
   * `shippingSlip` fields below, and readers synthesize a single virtual parcel from
   * those (see `legacyShipment`). There is no backfill: rewriting historical financial
   * records to fit a new shape is risk with no reward, and `rollUpStatus` refuses to
   * recompute an order that has no shipments — so a delivered order can never be
   * dragged backwards into "pending" by this feature.
   *
   * Embedded rather than a separate collection: parcels are few per order, are always
   * read with the order, and are never queried on their own at scale.
   */
  shipments: [{
    // Human-facing parcel number within the order ("Parcel 2 of 3"). Assigned on push.
    sequence: { type: Number, required: true },
    status: {
      type: String,
      enum: ["packed", "shipped", "delivered", "lost"],
      default: "packed"
    },
    /**
     * Which order lines, and how many of each, are physically in THIS box.
     * `itemId` refers to an `Order.items[]._id`. The sum across all non-lost parcels
     * may never exceed the ordered quantity — enforced atomically at write time by
     * services/shipmentService.js, because two admins shipping at once would each
     * pass a read-then-write check and together over-ship.
     */
    lines: [{
      itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
      quantity: { type: Number, required: true, min: 1 },
      _id: false
    }],
    /**
     * The won Spin-to-Win goodie travels in exactly ONE parcel. Set true on the box the
     * packer puts it in; the service refuses a second. Until it is set on some parcel
     * the order is NOT fully shipped — which is what makes "don't forget the goodie" a
     * structural guarantee rather than a banner someone has to read.
     */
    includesReward: { type: Boolean, default: false },
    trackingNumber: String,
    carrier: {
      name: String,
      code: String,
      trackingUrl: String
    },
    // Per-parcel courier slip (PDF on Cloudinary, resource_type 'raw'), attached to
    // that parcel's shipped email.
    shippingSlip: {
      url: String,
      publicId: String,
      uploadedAt: Date
    },
    estimatedDelivery: Date,
    shippedAt: Date,
    deliveredAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    notes: String
  }],

  trackingNumber: String,
  carrier: {
    name: String,
    code: String,
    trackingUrl: String
  },
  // Optional courier shipping slip (PDF) uploaded by an admin when the order ships.
  // Stored on Cloudinary (resource_type 'raw'); the notification worker downloads
  // the URL and attaches the PDF to the customer's "order shipped" email.
  shippingSlip: {
    url: String,
    publicId: String,
    uploadedAt: Date
  },
  trackingEvents: [{
    timestamp: {
      type: Date,
      default: Date.now
    },
    status: String,
    location: String,
    description: String,
    scannedBy: String
  }],
  // estimatedDeliveryDate and actualDeliveryDate removed — unused duplicates of estimatedDelivery / deliveredAt
  estimatedDelivery: Date,
  deliveredAt: Date,
  cancelledAt: Date,
  cancellationReason: String,
  // WHO initiated the cancellation — drives the admin "Cancelled by …" label and
  // lets the CRM/analytics tell an admin cancel apart from a customer self-cancel.
  // `system` is reserved for automated/expiry cancels. Only set when status=cancelled.
  cancelledBy: {
    type: String,
    enum: ["admin", "customer", "system"]
  },
  fulfillmentMetrics: {
    confirmedAt: Date,
    processingStartedAt: Date,
    shippedAt: Date,
    deliveredAt: Date,
    timeToShip: Number, // hours from confirmation to shipping
    timeToDeliver: Number // hours from shipping to delivery
  },
  returnRequest: {
    requestedAt: Date,
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    reason: {
      type: String,
      enum: ["defective", "wrong_item", "other"]
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "item_received", "completed", "cancelled", "refund_processed"]
      // NO `default` here on purpose. `returnRequest` is a Mongoose *nested path*
      // (a plain object, not a sub-schema), so a leaf default would materialize the
      // whole subdoc on EVERY order at creation — a phantom "pending" return with no
      // requestedAt. That polluted the customer order page, hid the Return button
      // (its gate checks !returnRequest.status), and flooded the admin queue. The
      // status is always set explicitly by the real write paths (returnController /
      // orderController), which also stamp `requestedAt` — the "is this real?" marker.
    },
    items: [{
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product"
      },
      quantity: Number,
      reason: String
    }],
    images: [{
      url: String,
      description: String
    }],
    adminNotes: String,
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    approvedAt: Date,
    rejectedReason: String,
    returnShippingLabel: String,
    itemReceivedAt: Date,
    inspectionNotes: String
  },
  refundDetails: {
    requestedAt: Date,
    amount: Number,
    refundType: {
      type: String,
      enum: ["full", "partial"]
    },
    refundMethod: {
      type: String,
      enum: ["original_payment", "store_credit", "bank_transfer"]
    },
    itemsRefunded: [{
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product"
      },
      quantity: Number,
      amount: Number
    }],
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"]
      // NO `default` — same nested-path footgun as returnRequest above. A default
      // here stamped every order with a phantom ₹0 "pending" refund, which showed on
      // the order page and matched the admin refunds-queue filter. Real refunds are
      // always written with an explicit status + `requestedAt` by the refund flow.
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    processedAt: Date,
    transactionId: String,
    failureReason: String,
    // Free-text marker. `refundMathService.remainingRefundable` keys off the
    // "Return <id>" prefix to tell a return-sourced mirror apart from a real
    // cancellation refund, so markRefundProcessing CLEARS it when claiming a
    // cancellation — a stale note surviving from a prior return would otherwise
    // make a genuine cancellation refund invisible to the already-refunded total.
    notes: String,
    // Once-only guard for the cumulative Payment.refundAmount write ($inc, hence not
    // idempotent). Mirrors ReturnRequest.refund.paymentRecorded; reset by
    // markRefundProcessing so a retry after a failed attempt can record again.
    paymentRecorded: { type: Boolean, default: false }
  },
  notes: String
}, { 
  timestamps: true 
});

// Indexes for order queries
// COMPOUND indexes for common query patterns
OrderSchema.index({ user: 1, createdAt: -1 }); // User order history (sorted by date)
// Admin orders list: the 🎁 "has an unpacked reward" filter is served by a partial
// index built in config/db.js as `spin_reward_fulfilment`, NOT declared here.
// Declaring it in both places makes MongoDB reject the second one ("Index already
// exists with a different name"), which aborted the whole index-verification pass —
// see the note on SpinResult.order.
OrderSchema.index({ user: 1, status: 1 });      // User orders filtered by status (order tracking page)
OrderSchema.index({ status: 1, createdAt: -1 }); // Admin dashboard (filter by status, sort by date)

// SINGLE-FIELD indexes for specific lookups
// Declared retroactively from $indexStats (2026-08-21): these were hand-built in
// production and existed in NO schema, so `audit-index-drift` reported them as EXTRA
// forever and `--allow-drop` would have deleted indexes that real traffic depends on.
// The ops counts below are measured over a 162h window, not assumed.
OrderSchema.index({ status: 1 }); // 1,023 ops — status-only filters (admin counts)

OrderSchema.index({ trackingNumber: 1 }); // Tracking lookup
OrderSchema.index({ 'returnRequest.status': 1 }); // Return request queries
OrderSchema.index({ 'refundDetails.status': 1 }); // Refund status queries
// Refund-webhook fallback lookup by Razorpay refund id (findOneByRefundId). Sparse: only
// orders that have actually been refunded carry a transactionId.
OrderSchema.index({ 'refundDetails.transactionId': 1 }, { sparse: true });

// CRITICAL: Guest order lookup (order confirmation page, guest order tracking).
//
// PLAIN, deliberately — NOT `partialFilterExpression: { sessionId: { $type: 'string' } }`.
// That form was tried and is a trap: MongoDB's planner does not infer that an
// equality predicate satisfies a `$type` partial filter, so `findOne({ sessionId })`
// is not provably inside the filter, the index is discarded, and the query
// COLLSCANs — the exact scan this index exists to prevent. The identical mistake on
// `carts` cost a 59,638-document scan per cart read and triggered an Atlas
// query-targeting alert (see repositories/cartRepository.js).
//
// Unlike the cart indexes this one is NOT unique, so the partial filter bought no
// correctness — only a marginal index-size saving — while breaking every read.
// A plain index is always planner-usable and is what production actually has.
// Do not "fix the drift" by making this partial again.
OrderSchema.index({ sessionId: 1 });

// Pre-save middleware to add initial status to history
OrderSchema.pre('save', function(next) {
  // Only add to history if this is a new document or status changed
  if (this.isNew || this.isModified('status')) {
    // Initialize statusHistory if it doesn't exist
    if (!this.statusHistory) {
      this.statusHistory = [];
    }
    
    // Add current status to history if not already there
    const lastHistoryStatus = this.statusHistory.length > 0 
      ? this.statusHistory[this.statusHistory.length - 1].status 
      : null;
    
    if (lastHistoryStatus !== this.status) {
      this.statusHistory.push({
        status: this.status,
        timestamp: new Date()
      });
    }
  }
  next();
});

// Method to get valid next statuses
OrderSchema.methods.getValidNextStatuses = function() {
  const transitions = {
    'pending': ['confirmed', 'cancelled', 'failed'],
    'confirmed': ['processing', 'cancelled'],
    'processing': ['shipped', 'cancelled'],
    'shipped': ['delivered'],
    'delivered': ['refunded'],
    'cancelled': [],
    'refunded': [],
    'failed': []
  };
  return transitions[this.status] || [];
};

// Method to check if status transition is valid
OrderSchema.methods.canTransitionTo = function(newStatus) {
  const validStatuses = this.getValidNextStatuses();
  return validStatuses.includes(newStatus);
};

const Order = mongoose.model("Order", OrderSchema);

export default Order;

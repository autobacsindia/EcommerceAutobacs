/**
 * Pricing service — the single source of truth for an order's money breakdown.
 *
 * Runs in two places with identical logic:
 *   1. POST /checkout/quote  → read-only preview so the UI can show discounts live.
 *   2. orderService.createOrder → authoritative recompute; client values are ignored.
 *
 * Stacking (locked product decision): at most ONE coupon, then karma points on top
 * of the remaining goods amount. All arithmetic is done in integer paise (see
 * utils/money.js) and converted back to rupees only at the edges, so the persisted
 * totalAmount reconciles exactly with the paise figure Razorpay charges.
 *
 * Coupon eligibility is REPORTED, not thrown: computeQuote returns `couponError`
 * (a buyer-facing reason) and applies no discount when a coupon is invalid. The
 * checkout path turns that into a hard 400 via assertCouponApplied(); the quote
 * path shows the reason inline. Karma never errors — it silently clamps to what the
 * balance, threshold and cap allow, and reports `karmaPointsUsed`.
 */

import productRepository from '../repositories/productRepository.js';
import couponRepository from '../repositories/couponRepository.js';
import couponUserUsageRepository from '../repositories/couponUserUsageRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import userRepository from '../repositories/userRepository.js';
import AppError from '../utils/AppError.js';
import { STOCK_STATUS } from '../utils/stockStatus.js';
import { getLoyaltyConfig } from './loyaltyConfigService.js';
import { toPaise, fromPaise } from '../utils/money.js';

// Buyer-facing rejection reasons (all whitelisted in errorMiddleware so they survive).
const REASON = {
  INVALID: 'Invalid coupon code',
  INACTIVE: 'This coupon is no longer available',
  NOT_STARTED: 'This coupon is not yet active',
  EXPIRED: 'This coupon has expired',
  LIMIT: 'This coupon has reached its usage limit',
  PER_USER: 'You have already used this coupon',
  FIRST_ORDER: 'This coupon is valid on your first order only',
  LOGIN: 'Please log in to use this coupon',
  SCOPE: 'This coupon does not apply to the items in your cart',
  MIN: 'Your cart does not meet this coupon’s minimum value',
  MAX: 'Your cart exceeds this coupon’s maximum value'
};

class CouponRejected extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

/**
 * The price a buyer is actually charged for a product right now.
 *
 * Authoritative sale-expiry guard: if a product has a time-boxed sale
 * (saleEndsAt) that has already passed, the sale price (`price`) is ignored and
 * the effective price reverts UP to `originalPrice`. This holds even in the
 * seconds before the cron sweep normalizes the stored fields, so a sale can
 * never be charged past its end instant. Pre-expiry, or with no sale window,
 * the stored `price` is used unchanged.
 */
export function effectivePrice(product, now = new Date()) {
  if (
    product?.saleEndsAt &&
    now >= new Date(product.saleEndsAt) &&
    typeof product.originalPrice === 'number' &&
    product.originalPrice > product.price
  ) {
    return product.originalPrice;
  }
  return product.price;
}

class PricingService {
  /**
   * Validate each item against the catalogue and re-price from the DB.
   * Returns priced line items (incl. categories/brandSlug for coupon scoping) and
   * the integer-paise subtotal. Pure read — pass a session to join a transaction.
   */
  async priceItems(items, session = null) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError('No order items provided', 400);
    }

    const orderItems = [];
    let subtotalPaise = 0;

    for (const item of items) {
      const product = await productRepository.findActiveById(item.product, session);
      if (!product) throw new AppError(`Product ${item.product} not found or not available`, 400);
      if (product.stock === STOCK_STATUS.OUT) throw new AppError(`${product.name} is out of stock`, 400);

      const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
      const unitPrice = effectivePrice(product);   // honours an expired sale window
      orderItems.push({
        product: product._id,
        quantity,
        price: unitPrice,                // always DB price, never client price
        name: product.name,
        image: product.images?.[0]?.url,
        categories: product.categories || [],
        brandSlug: product.brandSlug || null
      });
      subtotalPaise += toPaise(unitPrice) * quantity;
    }

    return { orderItems, subtotalPaise };
  }

  /** Does a priced line item fall within a coupon's appliesTo scope? */
  _itemInScope(item, appliesTo) {
    const products   = (appliesTo?.products   || []).map(String);
    const categories = (appliesTo?.categories || []).map(String);
    const brandSlugs = (appliesTo?.brandSlugs || []);
    if (!products.length && !categories.length && !brandSlugs.length) return true; // whole-cart
    if (products.includes(String(item.product))) return true;
    if (item.brandSlug && brandSlugs.includes(item.brandSlug)) return true;
    if ((item.categories || []).some(c => categories.includes(String(c)))) return true;
    return false;
  }

  /**
   * Resolve + validate a coupon against the cart. Returns the integer-paise GOODS
   * discount (percentage/fixed) and whether free shipping is granted. Throws
   * CouponRejected with a buyer-facing reason on any eligibility failure.
   */
  async _evaluateCoupon(code, orderItems, userId, session, now = new Date()) {
    const coupon = await couponRepository.findByCode(String(code).trim().toUpperCase(), session);
    if (!coupon) throw new CouponRejected(REASON.INVALID);
    if (!coupon.isActive) throw new CouponRejected(REASON.INACTIVE);
    if (coupon.startsAt && now < coupon.startsAt) throw new CouponRejected(REASON.NOT_STARTED);
    if (coupon.expiresAt && now > coupon.expiresAt) throw new CouponRejected(REASON.EXPIRED);
    if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) throw new CouponRejected(REASON.LIMIT);

    // Eligible subset (for scoped coupons the discount + cart thresholds use only matching lines).
    const eligible = orderItems.filter(i => this._itemInScope(i, coupon.appliesTo));
    if (eligible.length === 0) throw new CouponRejected(REASON.SCOPE);
    const eligiblePaise = eligible.reduce((sum, i) => sum + toPaise(i.price) * i.quantity, 0);

    if (coupon.minCartValue && eligiblePaise < toPaise(coupon.minCartValue)) throw new CouponRejected(REASON.MIN);
    if (coupon.maxCartValue != null && eligiblePaise > toPaise(coupon.maxCartValue)) throw new CouponRejected(REASON.MAX);

    // First-order-only and per-user limits require an identified user.
    if (coupon.firstOrderOnly || coupon.usageLimitPerUser != null) {
      if (!userId) throw new CouponRejected(REASON.LOGIN);
    }
    if (coupon.firstOrderOnly) {
      const priorOrders = await orderRepository.countActiveByUser(userId, session);
      if (priorOrders > 0) throw new CouponRejected(REASON.FIRST_ORDER);
    }
    if (coupon.usageLimitPerUser != null) {
      const usage = await couponUserUsageRepository.findByCouponUser(coupon._id, userId, session);
      if (usage && usage.count >= coupon.usageLimitPerUser) throw new CouponRejected(REASON.PER_USER);
    }

    // ── Compute the discount in paise ──────────────────────────────────────────
    let goodsDiscountPaise = 0;
    let freeShipping = false;
    if (coupon.type === 'percentage') {
      goodsDiscountPaise = Math.floor((eligiblePaise * coupon.value) / 100);
      if (coupon.maxDiscountAmount) goodsDiscountPaise = Math.min(goodsDiscountPaise, toPaise(coupon.maxDiscountAmount));
    } else if (coupon.type === 'fixed') {
      goodsDiscountPaise = Math.min(toPaise(coupon.value), eligiblePaise); // never exceed eligible subtotal
    } else if (coupon.type === 'free_shipping') {
      freeShipping = true;
    }

    return { coupon, goodsDiscountPaise, freeShipping };
  }

  /**
   * Full breakdown for a cart + optional coupon + requested karma points.
   *
   * @param {Object}  args
   * @param {Array}   args.items                [{ product, quantity }]
   * @param {string}  [args.couponCode]
   * @param {number}  [args.redeemKarmaPoints]  points the buyer wants to spend
   * @param {string}  [args.userId]
   * @param {number}  [args.shippingCost]       rupees
   * @param {Object}  [args.session]            mongoose session (checkout path)
   * @returns full breakdown incl. priced `orderItems` for persistence.
   */
  async computeQuote({ items, couponCode, redeemKarmaPoints = 0, userId = null, shippingCost = 0, session = null }) {
    const { orderItems, subtotalPaise } = await this.priceItems(items, session);
    const shippingPaise = Math.max(0, toPaise(shippingCost));

    // ── Coupon (reported, not thrown) ──────────────────────────────────────────
    let goodsCouponPaise = 0;
    let shippingWaivePaise = 0;
    let appliedCoupon = null;
    let couponError = null;
    if (couponCode && String(couponCode).trim()) {
      try {
        const { coupon, goodsDiscountPaise, freeShipping } =
          await this._evaluateCoupon(couponCode, orderItems, userId, session);
        goodsCouponPaise = goodsDiscountPaise;
        shippingWaivePaise = freeShipping ? shippingPaise : 0;
        appliedCoupon = { code: coupon.code, type: coupon.type, value: coupon.value };
      } catch (err) {
        if (err instanceof CouponRejected) couponError = err.reason;
        else throw err;
      }
    }

    const amountAfterCouponPaise = subtotalPaise - goodsCouponPaise;
    const effectiveShippingPaise = shippingPaise - shippingWaivePaise;

    // ── Karma (clamped, never errors) ──────────────────────────────────────────
    const cfg = await getLoyaltyConfig();
    const pointValuePaise = toPaise(cfg.pointValueInRupees);
    let karmaPointsUsed = 0;
    let karmaDiscountPaise = 0;
    let maxRedeemablePoints = 0;

    if (cfg.enabled && pointValuePaise > 0) {
      const capByPercentPaise = Math.floor((amountAfterCouponPaise * cfg.redeemMaxPercent) / 100);
      const maxPointsByCap = Math.floor(capByPercentPaise / pointValuePaise);
      let balance = 0;
      if (userId) {
        const u = await userRepository.getKarma(userId, session);
        balance = u?.karmaPoints || 0;
      }
      maxRedeemablePoints = Math.max(0, Math.min(balance, maxPointsByCap));

      const requested = Math.max(0, parseInt(redeemKarmaPoints, 10) || 0);
      let used = Math.min(requested, maxRedeemablePoints);
      if (used < cfg.minRedeemPoints) used = 0;              // below threshold → no redemption
      karmaPointsUsed = used;
      karmaDiscountPaise = used * pointValuePaise;
    }

    // ── Totals ─────────────────────────────────────────────────────────────────
    let totalPaise = subtotalPaise - goodsCouponPaise - karmaDiscountPaise + effectiveShippingPaise;
    if (totalPaise <= 0) {
      // Pathological (e.g. 100% redeem cap, no shipping): trim karma so a positive total remains.
      const deficit = 1 - totalPaise; // paise needed to reach +1
      const trimmedPoints = Math.min(karmaPointsUsed, Math.ceil(deficit / pointValuePaise));
      karmaPointsUsed -= trimmedPoints;
      karmaDiscountPaise = karmaPointsUsed * pointValuePaise;
      totalPaise = subtotalPaise - goodsCouponPaise - karmaDiscountPaise + effectiveShippingPaise;
    }

    // Order.discount convention: goods-level discount only; shipping waiver is reflected in shippingCost.
    const discountPaise = goodsCouponPaise + karmaDiscountPaise;
    // GST is embedded in prices; tax is the portion of the net GOODS amount, for display only.
    const goodsNetPaise = subtotalPaise - goodsCouponPaise - karmaDiscountPaise;
    const taxPaise = Math.round(goodsNetPaise - goodsNetPaise / 1.18);

    return {
      subtotal: fromPaise(subtotalPaise),
      couponDiscount: fromPaise(goodsCouponPaise),
      freeShippingApplied: shippingWaivePaise > 0,
      karmaDiscount: fromPaise(karmaDiscountPaise),
      discount: fromPaise(discountPaise),
      shippingCost: fromPaise(effectiveShippingPaise),
      tax: fromPaise(taxPaise),
      totalAmount: fromPaise(totalPaise),
      appliedCoupon,
      couponError,
      karmaPointsUsed,
      karmaPointValue: cfg.pointValueInRupees,
      maxRedeemablePoints,
      orderItems
    };
  }

  /** Checkout guard: turn a reported coupon rejection into a hard 400. */
  assertCouponApplied(quote, couponCode) {
    if (couponCode && String(couponCode).trim() && quote.couponError) {
      throw new AppError(quote.couponError, 400);
    }
  }
}

const pricingService = new PricingService();
export default pricingService;
export { PricingService, REASON };

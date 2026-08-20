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
import campaignRepository from '../repositories/campaignRepository.js';
import campaignProductTierRepository from '../repositories/campaignProductTierRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import userRepository from '../repositories/userRepository.js';
import campaignService from './campaignService.js';
import AppError from '../utils/AppError.js';
import { STOCK_STATUS, isPurchasable } from '../utils/stockStatus.js';
import { getLoyaltyConfig } from './loyaltyConfigService.js';
import { toPaise, fromPaise } from '../utils/money.js';
import { CAMPAIGN_REASON } from '../config/campaign.js';
import { resolveLinePercent, lineDiscountPaise, apportionCap } from '../utils/productTiers.js';

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

/**
 * Resolve a variable product's selected variant. The single implementation of
 * "find the variant by id, ensure it exists and is purchasable" — shared by the
 * checkout recompute (priceItems) and add-to-cart (routes/cart.js) so the two can
 * never drift. Returns `{ variant }` on success, or `{ reason }` describing the
 * failure ('unselected' | 'missing' | 'out' | 'backorder'); callers format their
 * own buyer-facing message. `variant` is included on 'out'/'backorder' for labels.
 */
export function resolveVariant(product, rawVariantId) {
  const selectedId = rawVariantId != null ? String(rawVariantId) : '';
  if (!selectedId) return { reason: 'unselected' };
  const variant = (product.variants || []).find(v => String(v._id) === selectedId);
  if (!variant) return { reason: 'missing' };
  if (!isPurchasable(variant.stock)) {
    return { reason: variant.stock === STOCK_STATUS.BACKORDER ? 'backorder' : 'out', variant };
  }
  return { variant };
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
    // What the buyer is ALREADY saving against MRP, before any coupon. Accumulated here
    // rather than stored per line: `Order.items[].listPrice` already exists and means
    // something else entirely (an offline sales-rep markdown), so reusing that name
    // would silently corrupt rep-discount reporting.
    let catalogSavingsPaise = 0;

    for (const item of items) {
      const product = await productRepository.findActiveById(item.product, session);
      if (!product) throw new AppError(`Product ${item.product} not found or not available`, 400);

      // Variable products: the price + stock come from the SELECTED variant, never
      // the parent. The client only sends a variantId; we resolve it against the DB
      // so a tampered/stale price can never be charged. A variable line with no or
      // an unknown variant is a hard error (the UI blocks add-to-cart until picked).
      let priceSource = product;              // what effectivePrice() reads
      let variantId = null;
      let variantLabel = null;
      if (product.productType === 'variable') {
        const { variant, reason } = resolveVariant(product, item.variantId);
        if (reason === 'unselected') throw new AppError(`Please select a variant for ${product.name}`, 400);
        if (reason === 'missing') throw new AppError(`Selected variant is no longer available for ${product.name}`, 400);
        if (reason) throw new AppError(`${product.name} (${variant.label}) is out of stock`, 400);
        priceSource = variant;
        variantId = variant._id;
        variantLabel = variant.label;
      } else if (product.stock === STOCK_STATUS.OUT) {
        throw new AppError(`${product.name} is out of stock`, 400);
      }

      const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
      const unitPrice = effectivePrice(priceSource);   // honours an expired sale window (product or variant)

      /*
        Is this line ALREADY discounted right now?

        Derived from `unitPrice`, which is effectivePrice() — NOT from a stored flag and
        not from the raw `price` field. A sale window that has closed reverts the charged
        price UP to originalPrice at the expiry instant, ahead of the cron sweep that
        normalizes the stored fields; reading a flag would keep calling that line "on
        sale" for as long as the sweep lagged, and cap its discount at 2% when it should
        have earned its full tier rate.

        Consumed by the product-tier ladder below. Deliberately not persisted onto the
        order: it is an input to the discount, and the discount itself is what gets
        snapshotted.
      */
      const listPrice = typeof priceSource.originalPrice === 'number' ? priceSource.originalPrice : null;
      const onSale = listPrice != null && listPrice > unitPrice;

      orderItems.push({
        product: product._id,
        variantId,                       // null for simple products
        variantLabel,                    // e.g. "COROLLA ALTIS 1.8 P" — snapshotted for history
        quantity,
        price: unitPrice,                // always DB price, never client price
        name: product.name,
        image: product.images?.[0]?.url,
        categories: product.categories || [],
        brandSlug: product.brandSlug || null,
        onSale,
        // Filled in by the product-tier ladder when one applies; 0 otherwise. This is
        // the figure refundMathService reads to refund a returned line at ITS OWN rate.
        discountPaise: 0
      });
      subtotalPaise += toPaise(unitPrice) * quantity;
      if (onSale) catalogSavingsPaise += (toPaise(listPrice) - toPaise(unitPrice)) * quantity;
    }

    return { orderItems, subtotalPaise, catalogSavingsPaise };
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
   * Price a cart against a campaign's PER-PRODUCT tier ladder.
   *
   * The structural difference from the cart-value ladder: that one picks ONE rate for
   * the whole cart, this one picks a rate PER LINE, so a single cart can hold 3%, 5%,
   * 8%, 4% and 2% lines at once. Every figure is integer paise and the per-line parts
   * are returned alongside the total, because those parts are what gets persisted onto
   * the order — refundMathService needs to refund a returned line at ITS OWN rate, and
   * cannot re-derive it from a blended order-level total.
   *
   * Membership comes from materialized CampaignProductTier rows scoped to this campaign.
   * A line with no row is not an error: it means "everything else" and takes the default
   * tier. The sale ceiling is applied per line from the LIVE `onSale` computed in
   * priceItems, never from a stored flag.
   *
   * @returns {{ totalPaise: number, lines: Array }}
   */
  async _priceProductTiers(campaign, eligibleItems, session = null) {
    const assignments = await campaignProductTierRepository.findForProducts(
      campaign._id,
      eligibleItems.map(i => i.product),
      session,
    );

    const resolved = eligibleItems.map((item) => {
      const linePaise = toPaise(item.price) * item.quantity;
      const assigned = assignments.get(String(item.product))?.tierCode || null;
      const { percent, tierCode, label, onSaleCapped } =
        resolveLinePercent(campaign.productTiers, assigned, item.onSale);
      return {
        product: String(item.product),
        variantId: item.variantId ? String(item.variantId) : null,
        name: item.name,
        quantity: item.quantity,
        linePaise,
        tierCode,
        tierLabel: label,
        percent,
        alreadyOnSale: Boolean(item.onSale),
        onSaleCapped,
        discountPaise: lineDiscountPaise(linePaise, percent),
      };
    });

    /*
      The order-wide ceiling has to land on the LINES, not just on the total.

      Capping only the sum would leave the per-line figures adding up to more than the
      order's actual discount, and refundMathService would then refund each returned line
      at its uncapped rate — quietly refunding more than was ever charged once several
      lines came back. apportionCap distributes it proportionally to what each line
      earned, with the leftover paise handed out by largest remainder so the parts sum to
      the cap EXACTLY.
    */
    const capPaise = campaign.maxDiscountPerOrder ? toPaise(campaign.maxDiscountPerOrder) : null;
    if (capPaise != null) {
      const capped = apportionCap(resolved.map(l => l.discountPaise), capPaise);
      resolved.forEach((line, i) => { line.discountPaise = capped[i]; });
    }

    return {
      totalPaise: resolved.reduce((sum, l) => sum + l.discountPaise, 0),
      lines: resolved,
    };
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

    // ── Campaign gate (only for campaign-managed coupons) ──────────────────────
    // A campaign coupon carries an extra eligibility test (allowlist / verified email
    // / campaign window / redemption cap) AND takes its percentage from the campaign's
    // tier ladder for this cart value rather than the coupon's static `value`. Ordinary
    // coupons skip this entirely — `coupon.campaign` is null and nothing below changes.
    //
    // Runs BEFORE the generic per-user/first-order gates on purpose: a campaign coupon
    // sets usageLimitPerUser, so the generic gate below would otherwise answer a
    // logged-out visitor with "Please log in to use this coupon" — useless copy for
    // someone who has just scanned a QR code and needs telling WHICH email to use.
    let campaign = null;
    let campaignTier = null;
    let productTierPricing = null;
    if (coupon.campaign) {
      campaign = await campaignRepository.findById(coupon.campaign, session);
      const evaluated = await campaignService.evaluate(campaign, userId, eligiblePaise, session, now);
      if (evaluated.reason) throw new CouponRejected(evaluated.reason);

      /*
        Two ladders, and a campaign carries exactly one (campaignService.assertValidConfig
        refuses both together — they price the same goods on different axes, so running
        them at once would stack two discounts).

        The presence of a product-tier ladder IS the switch. Nothing changes for any
        existing campaign: `productTiers` is undefined on every one of them, so this
        branch is unreachable until an operator configures a ladder and assigns products.
        That is a better gate than an env flag, which would have to be remembered,
        deployed, and eventually removed.
      */
      if (campaign.productTiers?.length) {
        productTierPricing = await this._priceProductTiers(campaign, eligible, session);
      } else {
        // Eligible, but this cart has not reached any tier yet — a distinct case from
        // being ineligible, and the only place it is a hard rejection is here, where we
        // are being asked to price an actual discount.
        if (!evaluated.tier) throw new CouponRejected(CAMPAIGN_REASON.NO_TIER);
        campaignTier = evaluated.tier;
      }
    }

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
      if (usage && usage.count >= coupon.usageLimitPerUser) {
        // Campaign wording for a campaign coupon — "offer", not "coupon", since the
        // buyer never typed a code; it was applied for them.
        throw new CouponRejected(coupon.campaign ? CAMPAIGN_REASON.ALREADY_USED : REASON.PER_USER);
      }
    }

    // ── Compute the discount in paise ──────────────────────────────────────────
    let goodsDiscountPaise = 0;
    let freeShipping = false;
    if (productTierPricing) {
      // Already capped and apportioned per line inside _priceProductTiers.
      goodsDiscountPaise = Math.min(productTierPricing.totalPaise, eligiblePaise);
    } else if (campaignTier) {
      // Already capped by the tier's own limit and the campaign ceiling, and clamped
      // to the eligible subtotal, inside resolveTier().
      goodsDiscountPaise = campaignTier.discountPaise;
    } else if (coupon.type === 'percentage') {
      goodsDiscountPaise = Math.floor((eligiblePaise * coupon.value) / 100);
      if (coupon.maxDiscountAmount) goodsDiscountPaise = Math.min(goodsDiscountPaise, toPaise(coupon.maxDiscountAmount));
    } else if (coupon.type === 'fixed') {
      goodsDiscountPaise = Math.min(toPaise(coupon.value), eligiblePaise); // never exceed eligible subtotal
    } else if (coupon.type === 'free_shipping') {
      freeShipping = true;
    }

    return { coupon, goodsDiscountPaise, freeShipping, campaign, campaignTier, productTierPricing };
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
    const { orderItems, subtotalPaise, catalogSavingsPaise } = await this.priceItems(items, session);
    const shippingPaise = Math.max(0, toPaise(shippingCost));

    // ── Coupon (reported, not thrown) ──────────────────────────────────────────
    let goodsCouponPaise = 0;
    let shippingWaivePaise = 0;
    let appliedCoupon = null;
    let couponError = null;
    let appliedCampaign = null;
    let allowKarma = true;
    let discountLines = null;
    if (couponCode && String(couponCode).trim()) {
      try {
        const { coupon, goodsDiscountPaise, freeShipping, campaign, campaignTier, productTierPricing } =
          await this._evaluateCoupon(couponCode, orderItems, userId, session);
        goodsCouponPaise = goodsDiscountPaise;
        shippingWaivePaise = freeShipping ? shippingPaise : 0;
        appliedCoupon = { code: coupon.code, type: coupon.type, value: coupon.value };
        if (campaign && campaignTier) {
          // Surfaced so the cart can show the tier the buyer has reached ("Festive 20")
          // and how much more would unlock the next one.
          appliedCampaign = {
            id: String(campaign._id),
            slug: campaign.slug,
            name: campaign.name,
            tierId: campaignTier.tierId,
            tierLabel: campaignTier.label,
            percent: campaignTier.percent,
          };
          // A campaign percentage is not compounded with loyalty points unless the
          // campaign explicitly opts in — 20% off plus karma is a margin decision,
          // not a default.
          if (!campaign.allowKarmaStacking) allowKarma = false;
        }

        if (productTierPricing) {
          /*
            Stamp each line's OWN discount onto the item that gets persisted.

            This is the load-bearing half of the per-product scheme. refundMathService
            prorates Order.discount by line gross value, which is exact while every line
            shares one percentage and WRONG the moment they do not: return the 2% item
            from a cart that also held an 8% item and the refund comes back at the cart's
            blended rate. That is the same class of defect as the list-price over-refund
            fixed on 2026-08-03, and the only way to avoid re-deriving it later is to
            write down what each line was actually given, at the moment it was given.
          */
          const byKey = new Map(
            productTierPricing.lines.map(l => [`${l.product}|${l.variantId || ''}`, l])
          );
          for (const item of orderItems) {
            const line = byKey.get(`${String(item.product)}|${item.variantId ? String(item.variantId) : ''}`);
            item.discountPaise = line?.discountPaise || 0;
          }
          discountLines = productTierPricing.lines;
        }
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

    if (cfg.enabled && pointValuePaise > 0 && allowKarma) {
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
      appliedCampaign,
      /*
        Per-line breakdown — present only for a product-tier campaign, null otherwise.
        The cart renders it (which line earned what rate, which was capped because it was
        already on offer) and the savings popup reads its totals. The BROWSER never
        computes any of it: money is server-confirmed before the UI commits to it.
      */
      discountLines,
      /*
        What to celebrate, computed on the SERVER.

        `catalog` is what the buyer already saves against MRP before any code is typed;
        `coupon` and `karma` are what the code and their points added. The popup shows
        `total`, because that is the honest number — quoting only the coupon would
        under-sell a cart full of already-discounted goods, and quoting the catalogue
        saving as if the coupon caused it would be a lie.

        Sent as a resolved block rather than left to the browser to add up: the browser
        renders money, it never derives it.
      */
      savings: {
        catalog: fromPaise(catalogSavingsPaise),
        coupon: fromPaise(goodsCouponPaise),
        karma: fromPaise(karmaDiscountPaise),
        total: fromPaise(catalogSavingsPaise + goodsCouponPaise + karmaDiscountPaise),
      },
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

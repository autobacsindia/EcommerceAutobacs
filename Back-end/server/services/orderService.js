import mongoose from 'mongoose';
import orderRepository from '../repositories/orderRepository.js';
import cartRepository from '../repositories/cartRepository.js';
import couponRepository from '../repositories/couponRepository.js';
import couponRedemptionRepository from '../repositories/couponRedemptionRepository.js';
import couponUserUsageRepository from '../repositories/couponUserUsageRepository.js';
import campaignRepository from '../repositories/campaignRepository.js';
import campaignMemberRepository from '../repositories/campaignMemberRepository.js';
import karmaLedgerRepository from '../repositories/karmaLedgerRepository.js';
import userRepository from '../repositories/userRepository.js';
import pricingService from './pricingService.js';
import AppError from '../utils/AppError.js';
import { getOrderQueue } from '../queue/queues.js';

class OrderService {
  /**
   * Validate + re-price items from the DB. Thin wrapper kept for callers that only
   * need pricing; the authoritative discount maths lives in pricingService.
   */
  async validateAndPriceItems(items) {
    const { orderItems, subtotalPaise } = await pricingService.priceItems(items);
    return { orderItems, subtotal: Math.round(subtotalPaise) / 100 };
  }

  /**
   * Atomically apply a coupon to an order inside the caller's transaction.
   * Increments the global counter with a guarded $inc, enforces the per-user limit
   * via a guarded upsert, and writes the audit redemption. Throws (aborting the
   * transaction) if any limit was reached between quote time and commit.
   */
  async _applyCoupon(code, userId, order, couponDiscount, session, now = new Date()) {
    // Guarded global counter: only increments while under the limit (or unlimited).
    const coupon = await couponRepository.incrementUsageGuarded(code, now, session);
    if (!coupon) throw new AppError('This coupon has reached its usage limit', 400);

    // Per-user cap: guarded upsert; a duplicate-key from the unique {coupon,user}
    // index means the user is already at the cap.
    //
    // firstOrderOnly implies a cap of 1. _evaluateCoupon's prior-order count runs on a
    // snapshot read and so cannot serialize two concurrent checkouts by the same user —
    // neither transaction sees the other's uncommitted order, and they conflict on no
    // shared document. Routing firstOrderOnly through this counter gives them one, so
    // the loser aborts instead of both earning the discount.
    const perUserCap = coupon.usageLimitPerUser ?? (coupon.firstOrderOnly ? 1 : null);
    if (perUserCap != null) {
      try {
        await couponUserUsageRepository.incrementGuarded(coupon._id, userId, perUserCap, session);
      } catch (err) {
        if (err?.code === 11000) throw new AppError('You have already used this coupon', 400);
        throw err;
      }
    }

    await couponRedemptionRepository.create({
      coupon: coupon._id,
      user: userId,
      order: order._id,
      code: coupon.code,
      discountAmount: couponDiscount
    }, session);
  }

  /**
   * Atomically consume a campaign redemption inside the caller's transaction.
   *
   * Two writes, in this order for a reason:
   *   1. the GUARDED global counter — the campaign's budget stop. A guarded $inc is the
   *      only thing that holds when two carts race for the last remaining slot; reading
   *      redeemedCount and comparing it would let both through. Failing here aborts the
   *      whole transaction, so no order exists for a redemption we could not reserve.
   *   2. the member's redemption record — reporting for the admin dashboard.
   *
   * "Once per customer" is NOT enforced here: that is the managed coupon's per-user
   * counter in _applyCoupon, which already runs in this same transaction against a
   * unique index. Duplicating the rule in two places would let the two disagree.
   */
  async _applyCampaign(appliedCampaign, userId, order, discountRupees, session) {
    const reserved = await campaignRepository.incrementRedemptionGuarded(
      appliedCampaign.id, discountRupees, session
    );
    if (!reserved) throw new AppError('This offer has been fully claimed', 400);

    // Email is passed so the member row can be found even when this buyer never hit
    // the eligibility endpoint (which is what normally links the account to the invite).
    const identity = await userRepository.getCampaignIdentity(userId, session);
    await campaignMemberRepository.markRedeemed(
      appliedCampaign.id, userId,
      { orderId: order._id, discountRupees, email: identity?.email },
      session
    );
  }

  /**
   * Atomically debit redeemed karma points inside the caller's transaction.
   * The guarded $gte filter prevents overdraw under concurrent checkouts.
   */
  async _redeemKarma(userId, points, order, session) {
    const updated = await userRepository.debitKarmaGuarded(userId, points, session);
    if (!updated) throw new AppError('Insufficient karma points', 400);

    await karmaLedgerRepository.create({
      user: userId,
      type: 'redeem',
      points: -points,
      balanceAfter: updated.karmaPoints,
      order: order._id,
      description: `Redeemed on order ${order._id}`
    }, session);
  }

  /**
   * Full order creation flow.
   *
   * Pricing + coupon/karma validation run OUTSIDE the transaction (pure reads).
   * The transaction then holds locks only for the writes: order insert, coupon
   * counter + audit, karma debit + ledger, and cart clear — all-or-nothing.
   *
   * @param {string|ObjectId} userId
   * @param {Array}  items            [{product, quantity}]
   * @param {Object} shippingAddress
   * @param {Object} orderData        raw request body (shippingCost, couponCode, redeemKarmaPoints)
   *                                  plus `buyer` / `legalAcceptance`, already
   *                                  validated by services/buyerService.js —
   *                                  this method does NOT re-derive them
   * @param {string} [paymentMethod]
   */
  async createOrder(userId, items, shippingAddress, orderData, paymentMethod) {
    const shippingCost = Math.max(0, Number(orderData.shippingCost) || 0);
    const couponCode = orderData.couponCode ? String(orderData.couponCode).trim().toUpperCase() : null;
    const redeemKarmaPoints = Math.max(0, parseInt(orderData.redeemKarmaPoints, 10) || 0);

    // Authoritative price breakdown — client-sent amounts are ignored entirely.
    const quote = await pricingService.computeQuote({
      items, couponCode, redeemKarmaPoints, userId, shippingCost
    });
    // An explicitly-supplied coupon that turned out invalid is a hard failure here.
    pricingService.assertCouponApplied(quote, couponCode);

    if (quote.totalAmount <= 0) throw new AppError('Order total must be greater than zero', 400);

    const appliedCode = quote.appliedCoupon?.code || null;

    // ── Atomic transaction ───────────────────────────────────────────────────
    const session = await mongoose.startSession();
    let order;
    try {
      await session.withTransaction(async () => {
        order = await orderRepository.create(
          {
            user: userId,
            items: quote.orderItems.map(({ product, variantId, variantLabel, quantity, price, name, image, discountPaise }) =>
              // `discountPaise` carries the line's OWN share of a per-product tier
              // discount, so a returned line can be refunded at its own rate rather than
              // the cart's blended average. 0 for every other pricing path.
              ({ product, variantId, variantLabel, quantity, price, name, image, discountPaise: discountPaise || 0 })),
            shippingAddress,
            subtotal: quote.subtotal,
            shippingCost: quote.shippingCost,
            tax: quote.tax,
            discount: quote.discount,
            couponCode: appliedCode,
            couponDiscount: quote.couponDiscount,
            karmaDiscount: quote.karmaDiscount,
            karmaPointsUsed: quote.karmaPointsUsed,
            totalAmount: quote.totalAmount,
            status: 'awaiting_payment',
            ...(paymentMethod && { paymentMethod }),
            ...(orderData.sessionId && { sessionId: orderData.sessionId }),
            ...(orderData.tracking && { tracking: orderData.tracking }),
            // Buyer identity + legal acceptance are resolved by the CALLER via
            // services/buyerService.js and passed in already validated. They are
            // spread conditionally so an individual order carries no empty
            // subdoc, and so the ~1,500 pre-existing orders stay shape-identical.
            ...(orderData.buyer && { buyer: orderData.buyer }),
            ...(orderData.legalAcceptance && { legalAcceptance: orderData.legalAcceptance })
          },
          session
        );

        if (appliedCode) {
          await this._applyCoupon(appliedCode, userId, order, quote.couponDiscount, session);
        }
        if (quote.appliedCampaign) {
          await this._applyCampaign(quote.appliedCampaign, userId, order, quote.couponDiscount, session);
        }
        if (quote.karmaPointsUsed > 0) {
          await this._redeemKarma(userId, quote.karmaPointsUsed, order, session);
        }

        await cartRepository.clearCart(userId, session);
      });
    } finally {
      await session.endSession();
    }

    // ── Post-order background work (best-effort, transaction already committed) ──
    // The order confirmation + invoice email is NOT sent here — the order is still
    // `pending` until payment. It is enqueued on payment success (see
    // razorpayService.processPaymentSuccess → 'send-order-invoice').
    if (process.env.REDIS_URL) {
      const enqueueErr = (name, err) =>
        console.error(`[Queue] Failed to enqueue ${name}:`, err.message);

      getOrderQueue()
        .add('post-order-created', {
          orderId: order._id.toString(),
          userId:  userId.toString()
        })
        .catch(err => enqueueErr('post-order-created', err));
    }

    return order;
  }
}

export default new OrderService();

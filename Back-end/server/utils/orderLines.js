/**
 * Order DISPLAY lines — the single derivation behind every surface that shows
 * "what is in this order": the admin order screen, the packing slip, the customer
 * order page, and the order emails.
 *
 * WHY THIS EXISTS
 * A won Spin-to-Win goodie is part of the parcel, so a packer and a customer must
 * both see it sitting in the item list — as a quantity-1, ₹0 line that is clearly
 * labelled a gift. But it is NOT part of what the customer was charged, so it must
 * never reach the money.
 *
 * ⚠️ THE GOODIE IS A *DISPLAY* LINE, NEVER AN `Order.items` ENTRY. See the long note
 * on `spinReward` in models/Order.js: pushing it into `items` corrupts
 * refundMathService's proration base, the GST invoice, Meta CAPI / Google Ads
 * conversion value, units-sold in analytics, and would make a free gift
 * "returnable". Orders are immutable financial records; a ₹0 prize is not part of
 * the record. This module is how the goodie appears in the list without entering it.
 *
 * Consumers must therefore keep using `order.items` for anything that is money,
 * tax, returns eligibility or analytics, and use these lines ONLY to render.
 *
 * The frontend mirrors this in Front-end/web/src/lib/orderLines.ts — the two encode
 * the same rules and must be updated together (same convention as
 * config/returnPolicy.js ↔ lib/constants.ts).
 */

import { PRIZE_KIND } from '../config/spin.js';

/** Line kinds. `sale` = the customer paid for it; `reward` = a free won goodie. */
export const LINE_KIND = Object.freeze({ SALE: 'sale', REWARD: 'reward' });

/**
 * Is this order's spin reward a PHYSICAL thing a human has to put in the parcel?
 *
 * Only `goodie` is. A `coupon` or `karma` prize is delivered by the coupon engine /
 * karma ledger and needs no picking — showing it as a packable line would have the
 * packer hunting a shelf for a discount code, and (once Phase 1 makes the goodie a
 * fulfilment blocker) would leave the order permanently un-completable.
 *
 * @param {object|null|undefined} spinReward - Order.spinReward subdocument
 * @returns {boolean}
 */
export const isPhysicalReward = (spinReward) =>
  Boolean(spinReward) && spinReward.kind === PRIZE_KIND.GOODIE;

/**
 * The goodie still owed to this order: physical, granted, and not withdrawn.
 *
 * A `voidedAt` reward (the order was cancelled or refunded) is NOT owed. Excluding
 * it here is what stops a withdrawn gift from blocking completion for ever.
 *
 * @param {object} order
 * @returns {boolean}
 */
export const owesGoodie = (order) =>
  isPhysicalReward(order?.spinReward) && !order.spinReward.voidedAt;

/**
 * Build the display lines for an order.
 *
 * @param {object} order - an Order document or lean object
 * @param {object} [opts]
 * @param {'admin'|'customer'} [opts.audience='customer'] - a VOIDED reward is shown
 *   to admins (as an explicit do-not-pack, because someone who already read the old
 *   instruction needs to be told it is withdrawn) and hidden from customers (the
 *   gift is gone; dangling it would be worse than silence).
 * @returns {Array<object>} display lines; sale lines first, the reward line last
 */
export const buildOrderLines = (order, { audience = 'customer' } = {}) => {
  const lines = (order?.items || []).map((item) => {
    const unitPrice = item.price || 0;
    const quantity = item.quantity || 0;
    return {
      kind: LINE_KIND.SALE,
      itemId: item._id ? String(item._id) : null,
      product: item.product ?? null,
      name: item.name || item.product?.name || null,
      image: item.image || item.product?.images?.[0]?.url || null,
      // Sale lines carry the catalogue SKU, reward lines the prize SKU — one field,
      // because both are what a picker reads off the shelf.
      sku: item.product?.sku ?? null,
      variantLabel: item.variantLabel ?? null,
      quantity,
      unitPrice,
      lineTotal: unitPrice * quantity,
      isFree: false,
      // Only paid goods are returnable/reviewable. The reward line overrides both.
      returnable: true,
      reviewable: true,
    };
  });

  const reward = order?.spinReward;
  if (isPhysicalReward(reward)) {
    const voided = Boolean(reward.voidedAt);
    if (!voided || audience === 'admin') {
      lines.push({
        kind: LINE_KIND.REWARD,
        itemId: null,
        product: null,
        name: reward.name,
        image: reward.imageUrl || null,
        sku: reward.sku || null,
        variantLabel: null,
        // Always exactly one. The prize ladder awards a single unit; a quantity
        // here would imply a stock decrement the spin engine never made.
        quantity: 1,
        unitPrice: 0,
        lineTotal: 0,
        isFree: true,
        // A gift was never charged for, so there is nothing to refund and nothing
        // to send back. Keep both false or the returns flow will offer it.
        returnable: false,
        reviewable: false,
        packed: Boolean(reward.fulfilledAt),
        voided,
      });
    }
  }

  return lines;
};

/**
 * Sum of a line set, for display assertions only.
 *
 * This MUST equal the order's goods subtotal — the reward contributes ₹0. It exists
 * so a test can prove the gift never moved the money, not so a caller can compute
 * a total: the authority for money remains pricingService / Order.totalAmount.
 *
 * @param {Array<object>} lines
 * @returns {number}
 */
export const linesGoodsTotal = (lines) =>
  (lines || []).reduce((sum, line) => sum + (line.lineTotal || 0), 0);

export default { LINE_KIND, buildOrderLines, isPhysicalReward, owesGoodie, linesGoodsTotal };

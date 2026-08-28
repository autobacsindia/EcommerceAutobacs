/**
 * Order DISPLAY lines — the single derivation behind every surface that shows
 * "what is in this order": the admin order screen, the packing slip, and the
 * customer order page.
 *
 * WHY THIS EXISTS
 * A won Spin-to-Win goodie is part of the parcel, so a packer and a customer must
 * both see it sitting in the item list — as a quantity-1, ₹0 line that is clearly
 * labelled a gift. But it is NOT part of what the customer was charged, so it must
 * never reach the money.
 *
 * ⚠️ THE GOODIE IS A *DISPLAY* LINE, NEVER AN `Order.items` ENTRY. See the note on
 * `spinReward` in Back-end/server/models/Order.js. Anything that is money, tax,
 * returns eligibility or analytics keeps reading `order.items`; these lines are for
 * rendering only.
 *
 * Mirrors Back-end/server/utils/orderLines.js — the two encode the same rules and
 * must be updated together (same convention as config/returnPolicy.js ↔ constants.ts).
 */

export type OrderLineKind = 'sale' | 'reward';

/** The `spinReward` subdocument as the order APIs return it. */
export interface SpinRewardSnapshot {
  name: string;
  sku?: string | null;
  kind: string;
  imageUrl?: string | null;
  fulfilledAt?: string | null;
  voidedAt?: string | null;
}

/** The subset of an order item these helpers need; callers may pass richer objects. */
export interface OrderLineSourceItem {
  _id?: string;
  product?: { _id?: string; name?: string; sku?: string; images?: Array<{ url: string }> } | string | null;
  quantity?: number;
  price?: number;
  name?: string;
  image?: string;
  variantLabel?: string | null;
}

export interface OrderLineSource {
  items?: OrderLineSourceItem[];
  spinReward?: SpinRewardSnapshot | null;
}

export interface OrderLine {
  kind: OrderLineKind;
  itemId: string | null;
  /** Present on sale lines only; the reward has no catalogue product. */
  product: OrderLineSourceItem['product'];
  name: string | null;
  image: string | null;
  /** Sale lines carry the catalogue SKU; reward lines carry the prize SKU. Both are
   *  what a picker reads off the shelf, so they live under one field. */
  sku: string | null;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  isFree: boolean;
  returnable: boolean;
  reviewable: boolean;
  /** Reward lines only. */
  packed?: boolean;
  voided?: boolean;
}

/** The prize kind that is a physical object someone has to pick off a shelf. */
const GOODIE = 'goodie';

/**
 * Is this order's spin reward a PHYSICAL thing a human has to put in the parcel?
 * Only `goodie` is — a `coupon` or `karma` prize is delivered by the coupon engine /
 * karma ledger and needs no picking.
 */
export const isPhysicalReward = (reward?: SpinRewardSnapshot | null): boolean =>
  Boolean(reward) && reward!.kind === GOODIE;

/**
 * The goodie still owed to this order: physical, granted, and not withdrawn.
 * A voided reward (order cancelled or refunded) is not owed.
 */
export const owesGoodie = (order: OrderLineSource): boolean =>
  isPhysicalReward(order?.spinReward) && !order.spinReward!.voidedAt;

/**
 * Build the display lines for an order.
 *
 * @param audience A VOIDED reward is shown to admins (an explicit do-not-pack, so
 *   anyone who already read the old instruction is told it is withdrawn) and hidden
 *   from customers (the gift is gone; dangling it would be worse than silence).
 */
export const buildOrderLines = (
  order: OrderLineSource,
  { audience = 'customer' }: { audience?: 'admin' | 'customer' } = {},
): OrderLine[] => {
  const productOf = (item: OrderLineSourceItem) =>
    item.product && typeof item.product === 'object' ? item.product : null;

  const lines: OrderLine[] = (order?.items || []).map((item) => {
    const unitPrice = item.price || 0;
    const quantity = item.quantity || 0;
    const product = productOf(item);
    return {
      kind: 'sale',
      itemId: item._id ?? null,
      product: item.product ?? null,
      // SNAPSHOT FIRST, live catalogue only as a fallback. An order is an immutable
      // financial record: if the product was renamed or its photo swapped after the
      // sale, the customer must still see what they actually bought. (The backend
      // mirror resolves these in the same order — they must not drift.)
      name: item.name || product?.name || null,
      image: item.image || product?.images?.[0]?.url || null,
      sku: product?.sku ?? null,
      variantLabel: item.variantLabel ?? null,
      quantity,
      unitPrice,
      lineTotal: unitPrice * quantity,
      isFree: false,
      returnable: true,
      reviewable: true,
    };
  });

  const reward = order?.spinReward;
  if (isPhysicalReward(reward)) {
    const voided = Boolean(reward!.voidedAt);
    if (!voided || audience === 'admin') {
      lines.push({
        kind: 'reward',
        itemId: null,
        product: null,
        name: reward!.name,
        image: reward!.imageUrl || null,
        sku: reward!.sku || null,
        variantLabel: null,
        // Always exactly one — the prize ladder awards a single unit.
        quantity: 1,
        unitPrice: 0,
        lineTotal: 0,
        isFree: true,
        // A gift was never charged for: nothing to refund, nothing to send back.
        returnable: false,
        reviewable: false,
        packed: Boolean(reward!.fulfilledAt),
        voided,
      });
    }
  }

  return lines;
};

/**
 * Sum of a line set, for display assertions only. MUST equal the order's goods
 * subtotal — the reward contributes ₹0. Money authority stays server-side.
 */
export const linesGoodsTotal = (lines: OrderLine[]): number =>
  (lines || []).reduce((sum, line) => sum + (line.lineTotal || 0), 0);

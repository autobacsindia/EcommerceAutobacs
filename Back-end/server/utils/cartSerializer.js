/**
 * Cart response serializer.
 *
 * Every cart-returning endpoint sends its cart through here so the shape is
 * decided in ONE place. Two jobs:
 *
 *   1. Attach `metaContentId` per line — the catalogue id shared by the Meta
 *      catalogue and Google Merchant Center (utils/metaCatalogId.js). The order
 *      API has done this for a while (controllers/orderController.js); without
 *      it the cart/checkout ad events can only report an internal Mongo _id,
 *      which matches no catalogue offer while looking like it should.
 *
 *   2. Strip `wpId` from the populated product. It is an internal WooCommerce
 *      migration id that we populate ONLY to derive the content id, and it must
 *      never reach the client — same rule the order serializer follows.
 *
 * `variants` is deliberately NOT stripped here (unlike the order serializer):
 * cart consumers already receive it and use it to render variant choices, so
 * removing it would be a breaking change for no benefit.
 */

import { contentIdForLineItem } from './metaCatalogId.js';

/**
 * @param {object} cart  Mongoose Cart document (populated) or plain object
 * @returns {object}     plain object safe to send to the client
 */
export function serializeCart(cart) {
  if (!cart) return cart;

  const plain = typeof cart.toObject === 'function' ? cart.toObject() : cart;
  if (!Array.isArray(plain.items)) return plain;

  return {
    ...plain,
    items: plain.items.map((item) => {
      // A populated product is a plain object with its own _id; an UNpopulated
      // ref is a bare ObjectId (no `_id` property). Only the former can yield a
      // content id — deriving one from a bare ref would produce `ab_undefined`.
      const isPopulated = !!(item.product && typeof item.product === 'object' && item.product._id);
      if (!isPopulated) return { ...item, metaContentId: null };

      const metaContentId = contentIdForLineItem(item.product, item.variantId);
      const { wpId: _wpId, ...product } = item.product;
      return { ...item, product, metaContentId };
    }),
  };
}

export default { serializeCart };

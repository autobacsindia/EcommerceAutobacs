/**
 * Google Merchant Center offer id — the id Google knows each product by.
 *
 * DECISION: Google deliberately reuses the SAME id scheme as the Meta catalogue
 * (utils/metaCatalogId.js). One product therefore has one id everywhere, which
 * means the `metaContentId` already attached to every order line item doubles as
 * the Google `item_id` for conversions-with-cart-data — no second id to compute,
 * store, or keep in sync.
 *
 * Unlike Meta, Google has NO legacy constraint: our Merchant Center account is
 * new, so nothing forces the WooCommerce-derived values. We adopt them anyway
 * because sharing one id is worth more than a prettier id, and because Merchant
 * Center ids are permanent in practice — changing an id later drops the item's
 * history and performance data, so it is a decision worth making once.
 *
 * This module exists as the SEAM: if the two channels ever must diverge, change
 * ONLY this file and the Google feed follows. Nothing else imports the Meta id
 * helpers for Google purposes.
 */

import {
  productContentId,
  variantContentId,
  itemGroupId,
} from './metaCatalogId.js';

/** Offer id for a simple product. */
export const googleOfferId = productContentId;

/** Offer id for one purchasable variant of a variable product. */
export const googleVariantOfferId = variantContentId;

/** item_group_id tying a variable product's variant rows together. */
export const googleItemGroupId = itemGroupId;

export default { googleOfferId, googleVariantOfferId, googleItemGroupId };

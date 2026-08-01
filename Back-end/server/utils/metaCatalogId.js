/**
 * Meta catalogue content-id — the SINGLE source of truth for the retailer_id we
 * report to Meta, shared by three consumers so they can never drift:
 *   1. the product feed  (services/metaFeedService.js)
 *   2. the client Pixel  (content_ids on ViewContent/AddToCart/Purchase)
 *   3. server CAPI        (services/metaCapiService.js)
 *
 * Matching these exactly is what lets Meta tie ad events to catalogue items
 * (dynamic retargeting / Advantage+ catalogue ads) and dedupe Pixel vs CAPI.
 *
 * Scheme confirmed against Commerce Manager (2026-07-29):
 *   • simple product   id = bare Woo post id       → String(wpId)
 *   • variant          id = bare Woo variation id   → String(variant.wpVariationId)
 *   • variable product item_group_id = "wc_post_id_" + Woo post id
 * Products created natively after the WooCommerce migration have no wpId →
 * deterministic `ab_<mongoId>` fallback (created fresh in Meta).
 *
 * ── 50-CHARACTER BUDGET (hard constraint) ────────────────────────────────────
 * Google Merchant Center caps `id` at 50 characters and warns above it; the same
 * ids feed Google (utils/googleCatalogId.js), so every form below MUST stay
 * inside that budget. A Mongo ObjectId is 24 hex chars, so `ab_<id>` = 27 and a
 * naive `ab_<productId>_<variantId>` = 52 — which is exactly the overflow
 * Merchant Center reported on 2026-08-01. Variant subdocument _ids are
 * themselves globally-unique ObjectIds, so the parent id adds nothing but
 * length: the variant fallback carries the VARIANT id alone (27 chars).
 * Any future change here must keep the longest possible id ≤ 50 (enforced by
 * tests in tests/unit/services/googleFeedService.test.js).
 */

/** Google Merchant Center's hard cap on the `id` attribute. */
export const MAX_CONTENT_ID_LENGTH = 50;

/** retailer_id for a simple product (or a variable product's parent fallback). */
export function productContentId(product) {
  return product?.wpId != null ? String(product.wpId) : `ab_${product?._id}`;
}

/**
 * retailer_id for one purchasable variant of a variable product.
 *
 * The no-wpVariationId fallback uses the variant's own ObjectId — unique on its
 * own, and 25 characters shorter than pairing it with the parent (see the
 * 50-character budget above). Only if a variant somehow has no _id do we fall
 * back to the parent-qualified form, which at least stays deterministic.
 */
export function variantContentId(product, variant) {
  if (variant?.wpVariationId != null) return String(variant.wpVariationId);
  if (variant?._id) return `ab_${variant._id}`;
  return `ab_${product?._id}_${variant?._id}`;
}

/** item_group_id grouping a variable product's variant rows. */
export function itemGroupId(product) {
  return product?.wpId != null ? `wc_post_id_${product.wpId}` : `ab_${product?._id}`;
}

/**
 * Content id for a purchased line item, resolving a variant by its subdoc id when
 * present. `product` must be a populated product doc (needs wpId + variants).
 * Used by CAPI (from the order) and the order API serializer.
 */
export function contentIdForLineItem(product, variantId) {
  if (!product) return null;
  if (variantId) {
    const variant = (product.variants || []).find(
      (v) => String(v._id) === String(variantId)
    );
    if (variant) return variantContentId(product, variant);
  }
  return productContentId(product);
}

/**
 * Attach `metaContentId` to a plain product object (and to each variant), so the
 * frontend Pixel can read a ready-made content_id instead of re-deriving the id
 * scheme (which would risk drifting from the feed). Pass a lean/toObject() copy.
 *
 * For a VARIABLE product the parent-level id is the `item_group_id` — the feed
 * emits no sellable row for the bare parent, only per-variant rows plus the group,
 * so a page-level ViewContent must reference the group (Meta then associates it
 * with all variants). Simple products use their own item id. The buyable unit
 * (AddToCart/Purchase) always uses the per-variant id below.
 */
export function attachContentIds(product) {
  if (!product) return product;
  const isVariable =
    product.productType === 'variable' && Array.isArray(product.variants) && product.variants.length > 0;
  const out = {
    ...product,
    metaContentId: isVariable ? itemGroupId(product) : productContentId(product),
  };
  if (Array.isArray(product.variants)) {
    out.variants = product.variants.map((v) => ({ ...v, metaContentId: variantContentId(product, v) }));
  }
  return out;
}

export default {
  productContentId,
  variantContentId,
  itemGroupId,
  contentIdForLineItem,
  attachContentIds,
};

/**
 * "Open this product on the website" from the admin and team panels.
 *
 * Panel screens mostly hold a product's ID, not its slug (orders snapshot the
 * name and price, never the URL), so every link goes through one resolver —
 * /team/product/<id> (app/team/product/[id]/route.ts) — which asks the backend
 * for the product's current slug and redirects to the storefront page. One
 * route instead of a slug on every staff endpoint, and a renamed slug or a
 * product taken off the website is handled at click time, not baked into a
 * list that was loaded an hour ago.
 */

const OBJECT_ID = /^[a-f\d]{24}$/i;

export const isObjectId = (v: unknown): v is string => typeof v === 'string' && OBJECT_ID.test(v);

/** A product reference as panel data carries it: an id, a populated doc, or nothing. */
export type ProductRef = string | { _id?: string | null; id?: string | null } | null | undefined;

export function productIdOf(ref: ProductRef): string | null {
  if (!ref) return null;
  const id = typeof ref === 'string' ? ref : ref._id || ref.id || null;
  return isObjectId(id) ? id : null;
}

/** The resolver URL for a product (and its variant), or null when there is nothing to link. */
export function productLinkHref(product: ProductRef, variantId?: string | null): string | null {
  const id = productIdOf(product);
  if (!id) return null;
  return isObjectId(variantId) ? `/team/product/${id}?variant=${variantId}` : `/team/product/${id}`;
}

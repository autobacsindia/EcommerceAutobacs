/**
 * The ONLY place the procurement partner flow writes a `Product`.
 *
 *   • A new product is created through the Product model (Product.create), so the
 *     slug, price-range, stockRank and validate hooks run exactly as for an admin
 *     create; SEO needs nothing stored (defaults derive from name/description,
 *     admin override → computed default → site default), and the sitemap lists
 *     it once `isActive` is true, like any admin-created product.
 *   • Price / stock on an existing product go through findOneAndUpdate, whose
 *     hooks keep stockRank right and send back-in-stock notices.
 *   • Every write is followed by the same purge the admin product editor runs:
 *     invalidateCache('products') (Redis tags + route/public globs + the
 *     Cloudflare URLs config/cdnPurgeUrls.js knows) and the Next.js tags.
 *   • The supplier's cost is NEVER part of a Product write. Callers pass a
 *     whitelisted set of fields; `assertNoCost` is a belt-and-braces check.
 */
import repo from '../../repositories/supplierPartnerAdminRepository.js';
import { invalidateCache } from '../../middleware/cacheMiddleware.js';
import { revalidateFrontendTags } from '../frontendRevalidator.js';
import { productTags } from '../../utils/nextTags.js';
import { putPublicAsset } from '../storage/publicUploads.js';
import { deleteHostedImages } from '../storage/publicImageDeletes.js';
import { cleanHTML } from '../../utils/htmlSanitizer.js';
import { fail, readSupplierFile, text } from './shared.js';

const PRODUCT_IMAGE_FOLDER = 'autobacs/products';
const FORBIDDEN = /cost|margin|supplier/i;

/** Throws if a Product write would carry anything supplier-side. */
export function assertNoCost(fields) {
  const bad = Object.keys(fields).filter((k) => FORBIDDEN.test(k));
  if (bad.length) throw new Error(`refusing to write supplier fields to Product: ${bad.join(', ')}`);
}

/** Purge every cache layer for one product — the admin editor's exact calls. */
export function purgeProduct(product) {
  invalidateCache('products');
  revalidateFrontendTags(productTags(product));
}

/**
 * Copy the supplier's private photos into the public product image store.
 * All-or-nothing: on any failure the copies already made are deleted.
 */
export async function copyListingImages(images, alt) {
  const copied = [];
  try {
    for (const img of images) {
      const buffer = await readSupplierFile(img);
      const up = await putPublicAsset(buffer, { folder: PRODUCT_IMAGE_FOLDER, contentType: img.contentType || 'image/jpeg' });
      copied.push({ url: up.secure_url, public_id: up.public_id });
    }
  } catch (err) {
    if (copied.length) await deleteHostedImages(copied);
    throw fail(`Could not copy the supplier's photos (${err.message}). Nothing was saved — try again.`, 502);
  }
  return copied.map((c, i) => ({ ...c, alt, isPrimary: i === 0, variantOwned: false }));
}

const slugOfBrand = (b) => b.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Procurement's edited product form → Product fields. The same rules the admin
 * create path enforces (utils: cleanHTML, brandSlug), plus category existence.
 */
export async function cleanProductForm(input = {}) {
  const name = text(input.name, 200);
  if (name.length < 3) throw fail('Product name: at least 3 characters.', 400);
  const description = cleanHTML(String(input.description ?? '').slice(0, 20000));
  if (description.replace(/<[^>]*>/g, '').trim().length < 10) throw fail('Description: at least 10 characters.', 400);
  const shortDescription = text(input.shortDescription, 200);
  const ids = [...new Set((Array.isArray(input.categories) ? input.categories : []).map(String))].filter((c) => /^[a-f0-9]{24}$/i.test(c)).slice(0, 10);
  if (!ids.length) throw fail('Pick at least one category.', 400);
  const found = await repo.findCategories(ids);
  if (found.length !== ids.length) throw fail('One of the categories was not found — pick again.', 400);
  const brand = text(input.brand, 80);
  const sku = text(input.sku, 80);
  const specifications = (Array.isArray(input.specifications) ? input.specifications : [])
    .slice(0, 40)
    .map((s) => ({ key: text(s?.key ?? s?.label, 60), value: text(s?.value, 200) }))
    .filter((s) => s.key && s.value);
  return {
    name,
    description,
    ...(shortDescription ? { shortDescription } : {}),
    categories: ids,
    brand,
    brandSlug: brand ? slugOfBrand(brand) : '',
    ...(sku ? { sku } : {}),
    specifications,
  };
}

/** Create the product. The caller owns the copied images (and deletes them if this throws). */
export async function createProduct(fields, images) {
  assertNoCost(fields);
  try {
    const product = await repo.createProduct({ ...fields, images });
    purgeProduct(product);
    return product;
  } catch (err) {
    if (err?.code === 11000 && /sku/.test(String(err.message))) throw fail('Another product already has that SKU / part number — link to it instead, or change the SKU.', 409);
    throw err;
  }
}

/**
 * Set price and/or stock on an existing product, then purge. `price` is whole
 * rupees incl. GST. Refuses on a running time-boxed sale (the sale sweep owns
 * those prices) and on variable products (each model has its own price).
 */
export async function updateProduct(product, { price = null, stock = null }) {
  const set = {};
  if (price != null && price !== product.price) {
    if (product.productType === 'variable') throw fail('This product has several models with their own prices — change them in Products.', 409);
    if (product.saleEndsAt && new Date(product.saleEndsAt) > new Date()) {
      throw fail('A timed sale is running on this product — change the price after it ends, or in Products.', 409);
    }
    Object.assign(set, { price, priceMin: price, priceMax: price });
    // A struck-through "was" price at or below the new price would be a false discount.
    if (product.originalPrice != null && product.originalPrice <= price) set.originalPrice = null;
  }
  if (stock != null && stock !== product.stock && product.productType !== 'variable') set.stock = stock;
  if (!Object.keys(set).length) return product;
  assertNoCost(set);
  const updated = await repo.setProductFields(product._id, set);
  if (!updated) throw fail('That product no longer exists.', 404);
  purgeProduct(updated);
  return updated;
}

export default { assertNoCost, purgeProduct, copyListingImages, cleanProductForm, createProduct, updateProduct };

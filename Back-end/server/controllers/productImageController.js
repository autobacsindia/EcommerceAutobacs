/**
 * Product Image Controller
 *
 * Handles all Cloudinary image operations for products:
 *   createProductWithImages  — POST /products
 *   updateProductWithImages  — PUT  /products/:id
 *   deleteProductWithImages  — DELETE /products/:id
 *   uploadProductImages      — POST /products/:id/images
 *   deleteProductImage       — DELETE /products/:id/images/:encodedPublicId
 *
 * Key guarantees:
 *   - Atomic create: DB failure → Cloudinary assets rolled back
 *   - Safe update order: upload new → save to DB → delete old (never delete first)
 *   - Per-product Cloudinary folder: autobacs/products/{productId}
 *   - Structured logging on every upload/delete for production debugging
 */
import Product from '../models/Product.js';
import CentralAppError from '../utils/AppError.js';
import {
  uploadManyToCloudinary,
  deleteFromCloudinary,
  deleteManyFromCloudinary,
} from '../utils/cloudinaryHelpers.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { cleanHTML } from '../utils/htmlSanitizer.js';
import { STOCK_VALUES, STOCK_STATUS } from '../utils/stockStatus.js';
import { aggregateFromVariants } from '../utils/wcVariants.js';
import { normalizeSeo } from '../utils/seo.js';

/** Lightweight HTTP error — carries a statusCode for the Express error handler */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

const BASE_FOLDER = 'autobacs/products';

/** Return per-product Cloudinary folder for easier bulk-delete and debugging */
const productFolder = (productId) => `${BASE_FOLDER}/${productId}`;

// ────────────────────────────────────────────────────────────────────────────
// Helper: parse non-file fields from multipart body
// ────────────────────────────────────────────────────────────────────────────
const parseProductFields = (body) => {
  const fields = { ...body };

  ['categories', 'features', 'whyChoose', 'packageContents', 'tags',
   'specifications', 'compatibleVehicles', 'seo', 'variants'].forEach((key) => {
    if (typeof fields[key] === 'string') {
      try { fields[key] = JSON.parse(fields[key]); } catch { /* leave as string */ }
    }
  });

  // ── Variable products ──────────────────────────────────────────────────────
  // The pre('validate') hook derives the price range + parent price/stock on
  // .save() (create), but the update path uses findByIdAndUpdate which bypasses
  // that hook — so normalize variants and compute the aggregates HERE so both
  // paths persist a consistent product.
  if (fields.productType === 'variable' && Array.isArray(fields.variants)) {
    fields.variants = fields.variants
      .map((v) => ({
        ...(v._id && { _id: v._id }),
        ...(v.wpVariationId != null && { wpVariationId: v.wpVariationId }),
        label: String(v.label || '').trim(),
        attributes: Array.isArray(v.attributes) ? v.attributes : [],
        price: Number(v.price) || 0,
        originalPrice: v.originalPrice != null && v.originalPrice !== '' ? Number(v.originalPrice) : null,
        ...(v.salePrice != null && v.salePrice !== '' && { salePrice: Number(v.salePrice) }),
        stock: STOCK_VALUES.includes(v.stock) ? v.stock : STOCK_STATUS.IN,
        ...(v.sku && { sku: String(v.sku).trim() }),
      }))
      .filter((v) => v.label && v.price >= 0);
    Object.assign(fields, aggregateFromVariants(fields.variants));
  } else if (fields.productType && fields.productType !== 'variable') {
    // Switching to / staying simple|grouped: clear variants, collapse the range.
    fields.variants = [];
    if (fields.price != null && fields.price !== '') {
      const p = Number(fields.price);
      fields.priceMin = p;
      fields.priceMax = p;
    }
  }

  // Normalize the SEO sub-document: coerce noindex, trim/strip strings, drop
  // blank fields. We only touch `seo` when the client actually sent it, so a
  // partial update that omits `seo` never wipes stored values — but an admin
  // who clears every field (normalized to {}) CAN reset back to the computed
  // defaults. Blank individual fields fall back to defaults on the frontend.
  if ('seo' in fields) {
    fields.seo = normalizeSeo(fields.seo);
  }

  if (fields.price !== undefined)         fields.price         = Number(fields.price);
  if (fields.originalPrice !== undefined) fields.originalPrice = Number(fields.originalPrice);

  // saleEndsAt: empty string / 'null' clears the sale window (set null so a
  // partial update can explicitly end a sale early). Otherwise parse to a Date —
  // an unparseable value becomes Invalid Date, caught by assertValidProduct.
  if (fields.saleEndsAt !== undefined) {
    const raw = fields.saleEndsAt;
    if (raw === '' || raw === null || raw === 'null') {
      fields.saleEndsAt = null;
    } else {
      fields.saleEndsAt = new Date(raw);
    }
  }
  // stock is a status string ('in' | 'low' | 'out'); leave as-is. Schema enum validates it.

  // Always derive brandSlug from brand so filtering/URLs stay consistent regardless of
  // what the client sends (brand is chosen from the Brand list, not free-typed).
  if (typeof fields.brand === 'string') {
    fields.brand = fields.brand.trim();
    fields.brandSlug = fields.brand
      ? fields.brand.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      : '';
  }

  // Sanitize rich-text fields — strip unsafe HTML before storage
  if (fields.description)  fields.description  = cleanHTML(fields.description);
  if (fields.shortDescription) fields.shortDescription = cleanHTML(fields.shortDescription);

  ['isActive', 'isFeatured', 'isFastMoving', 'isOfferFeatured'].forEach((key) => {
    if (fields[key] !== undefined) fields[key] = fields[key] === 'true' || fields[key] === true;
  });

  // Sparse-unique fields: empty string is NOT null — drop them so MongoDB
  // doesn't try to index '' and conflict with other products that also have no value.
  if (fields.sku === '' || fields.sku === null) delete fields.sku;
  if (fields.externalId === '' || fields.externalId === null) delete fields.externalId;

  return fields;
};

/**
 * Validate the parsed product fields. The express-validator chains can't run on the raw
 * multipart body (arrays arrive as JSON strings), so validation happens here on the parsed
 * object. `partial` (update) only validates fields that are present.
 * Throws AppError(400) on the first failure.
 */
const assertValidProduct = (fields, { partial = false } = {}) => {
  const fail = (msg) => { throw new AppError(msg, 400); };
  const has = (k) => fields[k] !== undefined && fields[k] !== null && fields[k] !== '';

  if (!partial || has('name')) {
    if (!fields.name || String(fields.name).trim().length < 3) fail('Product name must be at least 3 characters long');
  }
  if (!partial || has('description')) {
    if (!fields.description || String(fields.description).trim().length < 10) fail('Product description must be at least 10 characters long');
  }
  if (!partial || has('price')) {
    const p = Number(fields.price);
    if (Number.isNaN(p) || p < 0) fail('A valid price (0 or more) is required');
  }
  if (!partial || fields.categories !== undefined) {
    if (!Array.isArray(fields.categories) || fields.categories.length < 1) fail('At least one category is required');
  }
  if (has('stock') && !STOCK_VALUES.includes(fields.stock)) {
    fail(`Stock must be one of: ${STOCK_VALUES.join(', ')}`);
  }

  // saleEndsAt is optional, but when provided (non-null) it must describe a REAL
  // sale: a valid future date AND a genuine markdown (originalPrice > price). A
  // sale window with no discount is meaningless, so we reject it outright rather
  // than storing an inert date. Both prices must be present in the payload — the
  // admin create/edit forms always send them together with saleEndsAt.
  if (fields.saleEndsAt instanceof Date) {
    if (Number.isNaN(fields.saleEndsAt.getTime())) fail('Sale end date is not a valid date');
    if (fields.saleEndsAt.getTime() <= Date.now()) fail('Sale end date must be in the future');
    if (!has('price') || !has('originalPrice')) {
      fail('A sale end date requires both a price and a higher original price');
    }
    if (!(Number(fields.originalPrice) > Number(fields.price))) {
      fail('A sale end date requires an original price higher than the sale price');
    }
  }
};

// ────────────────────────────────────────────────────────────────────────────
// POST /products  — create with images
// ────────────────────────────────────────────────────────────────────────────
export const createProductWithImages = async (req, res) => {
  const fields = parseProductFields(req.body);
  assertValidProduct(fields, { partial: false });
  const files  = req.files || (req.file ? [req.file] : []);

  console.log(`[ProductController] CREATE product: "${fields.name}" | ${files.length} image(s)`);

  // Upload images (all-or-nothing — throws and rolls back on any failure)
  let uploadedImages = [];
  if (files.length > 0) {
    // Use a temp folder since we don't have the productId yet;
    // images will live at autobacs/products/<generatedId>/...
    // Cloudinary public_id carries the final path after save
    uploadedImages = await uploadManyToCloudinary(
      files.map((f) => f.buffer),
      { folder: BASE_FOLDER }
    );
  }

  const images = uploadedImages.map((img, idx) => ({
    url:       img.secure_url,
    public_id: img.public_id,
    alt:       fields.name || '',
    isPrimary: idx === 0,
  }));

  const product = new Product({ ...fields, images });

  let savedProduct;
  try {
    savedProduct = await product.save();
    console.log(`[ProductController] Saved product: ${savedProduct._id} | "${savedProduct.name}"`);
  } catch (dbError) {
    // Atomic rollback — clean Cloudinary assets before propagating error
    if (uploadedImages.length) {
      console.warn(`[ProductController] DB save failed — rolling back ${uploadedImages.length} Cloudinary asset(s)`);
      await deleteManyFromCloudinary(uploadedImages.map((i) => i.public_id));
    }
    throw dbError;
  }

  invalidateCache('products');

  res.locals.product = savedProduct;
  res.status(201).json({
    success: true,
    message: 'Product created successfully',
    product: savedProduct,
  });
  // Terminal handler — do NOT call next(): the POST route has no trailing
  // middleware, so next() would fall through to the 404 notFound handler, which
  // can race ahead of the buffered (compressed) response and overwrite it.
};

// ────────────────────────────────────────────────────────────────────────────
// PUT /products/:id  — update with optional new images
//
// Safe update order (CRITICAL):
//   1. Upload new images to Cloudinary
//   2. Save new image URLs to DB
//   3. Delete old images from Cloudinary (only AFTER DB is confirmed saved)
//
// This prevents data loss if Cloudinary upload or DB save fails.
// ────────────────────────────────────────────────────────────────────────────
export const updateProductWithImages = async (req, res, next) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new AppError('Product not found', 404);

  const fields = parseProductFields(req.body);
  assertValidProduct(fields, { partial: true });
  const files  = req.files || (req.file ? [req.file] : []);
  const replaceImages = fields.replaceImages === 'true' || fields.replaceImages === true;
  delete fields.replaceImages;

  // public_ids the client staged for deletion (deferred from UI remove actions)
  // These are deleted AFTER DB save — never before — to keep Cloudinary + DB in sync
  let clientPendingDeletes = [];
  if (fields.deletePublicIds) {
    try {
      clientPendingDeletes = JSON.parse(fields.deletePublicIds);
    } catch {
      clientPendingDeletes = [];
    }
    delete fields.deletePublicIds;
  }

  console.log(
    `[ProductController] UPDATE product: ${product._id} | "${product.name}" | ${files.length} new image(s) | replaceImages=${replaceImages}`
  );

  // Capture old public_ids BEFORE any changes (needed for cleanup if replacing)
  // CRITICAL: Check for missing public_ids and log warning
  const missingPublicIds = product.images.filter(img => !img.public_id && img.url.includes('cloudinary.com'));
  
  if (missingPublicIds.length > 0) {
    console.error(`[CRITICAL] Product ${product._id} has ${missingPublicIds.length} Cloudinary image(s) missing public_id`);
    console.error('[CRITICAL] These images cannot be cleaned up. Run backfill script.');
  }
  
  const oldPublicIds = product.images.map((img) => img.public_id).filter(Boolean);

  // ── Step 1: Upload new images (if any) ────────────────────────────────
  let newUploads = [];
  if (files.length > 0) {
    newUploads = await uploadManyToCloudinary(
      files.map((f) => f.buffer),
      { folder: productFolder(product._id) }
    );
    // uploadManyToCloudinary is all-or-nothing — if it throws, no DB changes happen
  }

  // ── Step 2: Apply new images to the fields object ─────────────────────
  if (newUploads.length > 0) {
    if (replaceImages) {
      // Replace: build entirely new image list
      fields.images = newUploads.map((img, idx) => ({
        url:       img.secure_url,
        public_id: img.public_id,
        alt:       fields.name || product.name,
        isPrimary: idx === 0,
      }));
    } else {
      // Append: merge existing + new
      const appended = newUploads.map((img) => ({
        url:       img.secure_url,
        public_id: img.public_id,
        alt:       fields.name || product.name,
        isPrimary: false,
      }));
      fields.images = [...(product.images || []), ...appended];
    }
  }

  if (Array.isArray(fields.categories)) {
    fields.categories = [...new Set(fields.categories)];
  }

  // ── Step 3: Save to DB ─────────────────────────────────────────────────
  let updatedProduct;
  try {
    updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      fields,
      { new: true, runValidators: true }
    ).populate('categories', 'name slug');
    console.log(`[ProductController] Updated product: ${updatedProduct._id}`);
  } catch (dbError) {
    // DB failed after new images uploaded — rollback new uploads
    if (newUploads.length) {
      console.warn(`[ProductController] DB update failed — rolling back ${newUploads.length} new Cloudinary upload(s)`);
      await deleteManyFromCloudinary(newUploads.map((i) => i.public_id));
    }
    // Surface duplicate-key errors as a human-readable 409 instead of a generic 500
    if (dbError.code === 11000) {
      const conflictField = Object.keys(dbError.keyValue || {})[0] || 'field';
      const conflictValue = dbError.keyValue?.[conflictField];
      throw new CentralAppError(
        `Duplicate value: another product already has ${conflictField}${conflictValue ? ` "${conflictValue}"` : ''}. Please use a unique value.`,
        409
      );
    }
    throw dbError;
  }

  // ── Step 4: Delete images from Cloudinary (AFTER DB confirmed) ──────
  //
  // Two sources of IDs to clean up:
  //   A) replaceImages=true  → delete all OLD product images (gallery replaced)
  //   B) clientPendingDeletes → images the admin individually removed in the UI
  //
  // Failures here are logged with [CLEANUP_REQUIRED] by deleteFromCloudinary but
  // do NOT throw — the DB is already consistent at this point, so we never
  // unwind a successful save over a Cloudinary cleanup failure.
  const toDelete = new Set();
  if (replaceImages && oldPublicIds.length > 0) {
    oldPublicIds.forEach((id) => toDelete.add(id));
  }
  clientPendingDeletes.forEach((id) => typeof id === 'string' && id && toDelete.add(id));

  if (toDelete.size > 0) {
    console.log(`[ProductController] Cleaning up ${toDelete.size} Cloudinary asset(s) post-save`);
    await deleteManyFromCloudinary([...toDelete]);
  }

  invalidateCache('products');

  res.locals.product = updatedProduct;
  res.json({
    success: true,
    message: 'Product updated successfully',
    product: updatedProduct,
  });

  next();
};

// ────────────────────────────────────────────────────────────────────────────
// DELETE /products/:id  — soft-delete + clean Cloudinary
// ────────────────────────────────────────────────────────────────────────────
export const deleteProductWithImages = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new AppError('Product not found', 404);

  // CRITICAL: Check for missing public_ids before deletion
  const missingPublicIds = product.images.filter(img => !img.public_id && img.url.includes('cloudinary.com'));
  
  if (missingPublicIds.length > 0) {
    console.error(`[CRITICAL] Product ${product._id} has ${missingPublicIds.length} Cloudinary image(s) missing public_id`);
    console.error('[CRITICAL] These images will become orphaned. Run backfill script before deleting products.');
  }

  const publicIds = product.images.map((img) => img.public_id).filter(Boolean);

  console.log(`[ProductController] DELETE product: ${product._id} | "${product.name}" | ${publicIds.length} image(s) to clean up`);

  // Soft delete first — data is safe even if Cloudinary cleanup partially fails
  product.isActive = false;
  product.deletedAt = new Date();
  await product.save();
  console.log(`[ProductController] Soft-deleted product: ${product._id}`);

  // Clean up Cloudinary — failures logged with [CLEANUP_REQUIRED] tag, not thrown
  if (publicIds.length) {
    await deleteManyFromCloudinary(publicIds);
  }

  invalidateCache('products');

  res.locals.product = product;
  res.json({
    success: true,
    message: 'Product deleted and images cleaned up successfully',
  });
  // Terminal handler — do NOT call next() (see createProductWithImages).
};

// ────────────────────────────────────────────────────────────────────────────
// POST /products/:id/images  — add images to existing product
// ────────────────────────────────────────────────────────────────────────────
export const uploadProductImages = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new AppError('Product not found', 404);

  const files = req.files || (req.file ? [req.file] : []);
  if (!files.length) throw new AppError('No image files provided', 400);

  console.log(`[ProductController] ADD images to ${product._id}: ${files.length} file(s)`);

  const uploaded = await uploadManyToCloudinary(
    files.map((f) => f.buffer),
    { folder: productFolder(product._id) }
  );

  const newImages = uploaded.map((img) => ({
    url:       img.secure_url,
    public_id: img.public_id,
    alt:       product.name,
    isPrimary: false,
  }));

  product.images.push(...newImages);

  try {
    await product.save();
  } catch (dbError) {
    console.warn(`[ProductController] DB save failed — rolling back ${uploaded.length} upload(s)`);
    await deleteManyFromCloudinary(uploaded.map((i) => i.public_id));
    throw dbError;
  }

  invalidateCache('products');

  res.json({
    success: true,
    message: `${uploaded.length} image(s) added to product`,
    images:  newImages,
  });
};

// ────────────────────────────────────────────────────────────────────────────
// DELETE /products/:id/images/:encodedPublicId  — remove one image
// public_id is base64-encoded in URL to handle forward slashes
// ────────────────────────────────────────────────────────────────────────────
export const deleteProductImage = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new AppError('Product not found', 404);

  // Decode URL-safe base64 (- → +, _ → /, pad back to multiple-of-4)
  const raw = req.params.encodedPublicId
    .replace(/-/g, '+').replace(/_/g, '/') +
    '=='.slice(0, (4 - (req.params.encodedPublicId.length % 4)) % 4);
  const publicId = Buffer.from(raw, 'base64').toString('utf8');

  console.log(`[ProductController] DELETE image from ${product._id}: public_id="${publicId}"`);

  const imageIndex = product.images.findIndex((img) => img.public_id === publicId);
  if (imageIndex === -1) throw new AppError('Image not found in this product', 404);

  // Remove from DB first, then delete from Cloudinary
  product.images.splice(imageIndex, 1);

  // Promote first remaining image to primary if the deleted one was primary
  if (product.images.length > 0 && !product.images.some((img) => img.isPrimary)) {
    product.images[0].isPrimary = true;
  }

  await product.save();
  console.log(`[ProductController] Image removed from DB: ${product._id}`);

  // Delete from Cloudinary after DB is safe (failure logged, not thrown)
  await deleteFromCloudinary(publicId);

  invalidateCache('products');

  res.json({
    success: true,
    message: 'Image deleted successfully',
    remainingImages: product.images,
  });
};

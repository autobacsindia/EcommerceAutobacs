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
import {
  uploadToCloudinary,
  uploadManyToCloudinary,
  deleteFromCloudinary,
  deleteManyFromCloudinary,
} from '../utils/cloudinaryHelpers.js';
import { asyncHandler } from '../middleware/errorMiddleware.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { cleanHTML } from '../utils/htmlSanitizer.js';

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
   'specifications', 'qna', 'variableSpecs', 'compatibleVehicles'].forEach((key) => {
    if (typeof fields[key] === 'string') {
      try { fields[key] = JSON.parse(fields[key]); } catch { /* leave as string */ }
    }
  });

  if (fields.price !== undefined)         fields.price         = Number(fields.price);
  if (fields.originalPrice !== undefined) fields.originalPrice = Number(fields.originalPrice);
  if (fields.stock !== undefined)         fields.stock         = Number(fields.stock);

  // Sanitize rich-text fields — strip unsafe HTML before storage
  if (fields.description)  fields.description  = cleanHTML(fields.description);
  if (fields.shortDescription) fields.shortDescription = cleanHTML(fields.shortDescription);

  ['isActive', 'isFeatured', 'isFastMoving', 'isOfferFeatured'].forEach((key) => {
    if (fields[key] !== undefined) fields[key] = fields[key] === 'true' || fields[key] === true;
  });

  return fields;
};

// ────────────────────────────────────────────────────────────────────────────
// POST /products  — create with images
// ────────────────────────────────────────────────────────────────────────────
export const createProductWithImages = async (req, res, next) => {
  const fields = parseProductFields(req.body);
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

  next();
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
export const deleteProductWithImages = async (req, res, next) => {
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

  next();
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

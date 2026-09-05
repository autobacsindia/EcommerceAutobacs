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
import Product, { isHostedImageUrl } from '../models/Product.js';
import CentralAppError from '../utils/AppError.js';
import {
  uploadManyToCloudinary,
  deleteManyFromCloudinary,
} from '../utils/cloudinaryHelpers.js';
import { deleteHostedImages } from '../services/storage/publicImageDeletes.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { revalidateFrontendTags } from '../services/frontendRevalidator.js';
import { productTags as productNextTags } from '../utils/nextTags.js';
import { cleanHTML } from '../utils/htmlSanitizer.js';
import { STOCK_VALUES, STOCK_STATUS } from '../utils/stockStatus.js';
import { aggregateFromVariants } from '../utils/wcVariants.js';
import { normalizeSeo } from '../utils/seo.js';
import { imageKey, orderGallery } from '../utils/productGallery.js';
import { pruneDanglingPointers, planVariantOwnedCleanup } from '../utils/variantImage.js';

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

/**
 * Hard cap on NEW images accepted per create/update request.
 *
 * Raised from 8 because one save can now legitimately carry a gallery batch AND
 * a photo for each model of a variable product — a seven-model light bar with a
 * few marketing shots clears 8 without anyone doing anything unusual.
 */
const MAX_NEW_IMAGES = 24;

/**
 * Read the optional `imageOrder` / `primaryImage` / `adoptImages` fields off the body.
 *
 * `adoptImages` is the admin's "keep this in the gallery" action: it lists image
 * keys that should stop being model-owned and become ordinary product photos,
 * surviving however many models come and go. Without it the only way to save a
 * model photo from its model was to promote it to primary, which is a different
 * decision entirely (it changes every product card and the PDP hero).
 *
 * Note the direction of failure. A stale, duplicated or forged `adoptImages`
 * can only ever make an image MORE permanent — it removes a deletion, never
 * causes one. That is the opposite of `deletePublicIds`, which is why that field
 * needs the derive-from-what-persisted guard below and this one does not.
 */
const takeSequencing = (fields) => {
  const order = Array.isArray(fields.imageOrder)
    ? fields.imageOrder.filter((k) => typeof k === 'string' && k)
    : null;
  const primary = typeof fields.primaryImage === 'string' && fields.primaryImage
    ? fields.primaryImage
    : null;
  const adopt = Array.isArray(fields.adoptImages)
    ? fields.adoptImages.filter((k) => typeof k === 'string' && k)
    : [];
  delete fields.imageOrder;
  delete fields.primaryImage;
  delete fields.adoptImages;
  return { order, primary, adopt };
};

/**
 * Apply the admin's "keep in gallery" choices: the named entries stop being
 * model-owned, so `planVariantOwnedCleanup` will never reclaim them.
 *
 * Returns new objects; the input is untouched.
 */
const applyAdoptions = (gallery, adoptKeys) => {
  if (!adoptKeys?.length) return gallery;
  const adopt = new Set(adoptKeys);
  return gallery.map((img) =>
    adopt.has(imageKey(img)) && img.variantOwned ? { ...img, variantOwned: false } : img
  );
};

/**
 * Validate image refs the browser uploaded DIRECTLY to storage (bypassing the
 * proxy body limit) and sent back as JSON. We only trust assets on a host WE
 * own — never an arbitrary client-supplied URL — and require a public_id (or R2
 * object key) so the asset can be cleaned up on delete/replace.
 *
 * ⚠ The host check must accept BOTH stores for as long as both hold live assets.
 * This function used to hard-match `https://res.cloudinary.com/`, which meant
 * that the moment STORAGE_PROVIDER flipped to r2 every uploaded image was
 * dropped here — and dropped SILENTLY: the file was safely in the bucket, the
 * product saved, the admin saw "updated successfully", and no image appeared.
 * It is delegated to Product.isHostedImageUrl now so the controller and the
 * schema validator can never disagree about what a legitimate image URL is.
 *
 * @param {unknown} raw
 * @returns {{ url: string, public_id: string }[]}
 * @throws  AppError(400) when any ref is rejected — see below.
 */
const normalizePreUploaded = (raw) => {
  if (!Array.isArray(raw)) return [];
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;

  const isOurs = (i) => {
    if (!isHostedImageUrl(i.url)) return false;
    // For a Cloudinary URL, additionally pin it to OUR cloud: res.cloudinary.com
    // serves every tenant, so the host alone proves nothing about ownership.
    // R2 URLs are already pinned by host (R2_PUBLIC_BASE_URL is ours alone).
    if (i.url.includes('res.cloudinary.com')) return !cloud || i.url.includes(`/${cloud}/`);
    return true;
  };

  /*
    Over-cap is REFUSED, not trimmed. `.slice()` used to silently drop the excess
    while the response still said "updated successfully" — the admin's files were
    in the bucket, unreferenced and unreachable, and no error told anyone. That is
    the same silent-drop shape the host check below was hardened against, so it
    gets the same treatment: nothing is saved and the message says why.
  */
  const eligibleRefs = raw.filter((i) => i && typeof i.url === 'string');
  if (eligibleRefs.length > MAX_NEW_IMAGES) {
    throw new CentralAppError(
      `Too many new images in one save (${eligibleRefs.length}); the limit is ${MAX_NEW_IMAGES}. ` +
      'Nothing was saved — please save in smaller batches.',
      400,
      { expose: true },
    );
  }

  const accepted = raw
    .filter((i) => i && typeof i.url === 'string' && typeof i.public_id === 'string' && i.public_id)
    .filter(isOurs)
    /*
      `variantOwned` marks a photo uploaded FROM a model row rather than added as
      a general product image. It decides whether the asset may be destroyed once
      no model points at it (see utils/variantImage.js). Coerced to a real boolean
      so a stray "false" string from a multipart body cannot make an ordinary
      gallery photo deletable.
    */
    .map((i) => ({ url: i.url, public_id: i.public_id, variantOwned: i.variantOwned === true || i.variantOwned === 'true' }));

  /*
    FAIL LOUDLY. This used to warn to the server log and carry on, which is how a
    provider flip turned into "the admin uploaded an image, was told the product
    saved, and the image was never there". A dropped ref means the bytes are in
    a bucket with nothing referencing them AND the admin's intent was lost — so
    the request must not report success.

    Over-cap is handled above, so anything missing here was refused by the host
    check and comparing against the full eligible count is correct.
  */
  const expected = eligibleRefs.length;
  if (accepted.length < expected) {
    const dropped = expected - accepted.length;
    console.error(
      `[ProductController] rejected ${dropped} image ref(s) from an unrecognised host — ` +
      `R2_PUBLIC_BASE_URL=${process.env.R2_PUBLIC_BASE_URL || '(unset)'}`
    );
    throw new CentralAppError(
      `${dropped} uploaded image${dropped === 1 ? '' : 's'} could not be attached because ` +
      'they are not hosted on a recognised storage domain. Nothing was saved — please retry.',
      400,
      { expose: true },
    );
  }
  return accepted;
};

// ────────────────────────────────────────────────────────────────────────────
// Helper: parse non-file fields from multipart body
// ────────────────────────────────────────────────────────────────────────────
const parseProductFields = (body) => {
  const fields = { ...body };

  ['categories', 'features', 'whyChoose', 'packageContents', 'tags',
   'specifications', 'compatibleVehicles', 'seo', 'variants', 'uploadedImages',
   'imageOrder', 'adoptImages', 'returnPolicy'].forEach((key) => {
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
        /*
          Spread conditionally: an absent pointer must stay ABSENT, because
          "absent" is what the read-time fallback to the product image keys off.
          Writing `imageKey: undefined` unconditionally would be equivalent here,
          but a later refactor to `?? null` would silently disable the fallback
          on every variant — so the intent is pinned in the shape.
        */
        ...(typeof v.imageKey === 'string' && v.imageKey.trim() && { imageKey: v.imageKey.trim() }),
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

  // Normalize specifications: both key and value are optional in the schema, so a
  // malformed client payload (or a legacy migrated row) could carry a null/missing
  // side. Coerce to trimmed strings and drop rows where either side is blank so we
  // never persist half-rows that later crash trim()-based consumers.
  if (Array.isArray(fields.specifications)) {
    fields.specifications = fields.specifications
      .filter((s) => s && typeof s === 'object')
      .map((s) => ({ key: String(s.key ?? '').trim(), value: String(s.value ?? '').trim() }))
      .filter((s) => s.key && s.value);
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
  // Images the browser already uploaded straight to Cloudinary (direct upload).
  const preUploaded = normalizePreUploaded(fields.uploadedImages);
  delete fields.uploadedImages;
  const { order: imageOrder, primary: primaryImage, adopt: adoptImages } = takeSequencing(fields);
  assertValidProduct(fields, { partial: false });
  const files  = req.files || (req.file ? [req.file] : []);

  console.log(`[ProductController] CREATE product: "${fields.name}" | ${files.length} file(s) + ${preUploaded.length} direct upload(s)`);

  // Legacy path: image bytes sent through our API (still supported) — all-or-nothing.
  let uploadedImages = [];
  if (files.length > 0) {
    uploadedImages = await uploadManyToCloudinary(
      files.map((f) => f.buffer),
      { folder: BASE_FOLDER }
    );
  }

  // Direct-uploaded refs first (they preserve the admin's chosen order), then any
  // server-side uploads. Both carry public_ids so both can be rolled back.
  const allRefs = [
    ...preUploaded,
    ...uploadedImages.map((img) => ({ url: img.secure_url, public_id: img.public_id })),
  ];

  // Sequence + thumbnail follow the admin's arrangement in the form; with no
  // explicit intent the upload order stands and the first image is primary.
  const composed = orderGallery(
    allRefs.map((img) => ({
      url:          img.url,
      public_id:    img.public_id,
      alt:          fields.name || '',
      isPrimary:    false,
      variantOwned: img.variantOwned === true,
    })),
    imageOrder,
    primaryImage,
  );

  const gallery = applyAdoptions(composed, adoptImages);

  /*
    Model pointers are resolved against the gallery that ACTUALLY persisted, not
    the one the client believes it sent: a pointer at an image that never made it
    (rejected host, dropped ref) is cleared rather than stored dangling.
  */
  if (Array.isArray(fields.variants) && fields.variants.length) {
    fields.variants = pruneDanglingPointers(gallery, fields.variants);
  }

  // A photo uploaded for a model that no longer exists in the payload is dead on
  // arrival — drop it here rather than storing an unreachable row. Assets are
  // cleaned below on the same rollback path as any other create failure.
  const { survivors: images, orphaned: bornOrphaned } =
    planVariantOwnedCleanup(gallery, fields.variants);

  const product = new Product({ ...fields, images });

  let savedProduct;
  try {
    savedProduct = await product.save();
    console.log(`[ProductController] Saved product: ${savedProduct._id} | "${savedProduct.name}"`);
  } catch (dbError) {
    // Atomic rollback — clean every Cloudinary asset (direct + server-side) before propagating
    // Refs carry their url, so each rollback lands in the store that actually
    // holds it — see services/storage/publicImageDeletes.js.
    const rollback = allRefs.filter((i) => i.public_id);
    if (rollback.length) {
      console.warn(`[ProductController] DB save failed — rolling back ${rollback.length} uploaded asset(s)`);
      await deleteHostedImages(rollback);
    }
    throw dbError;
  }

  // Assets uploaded for a model the payload did not keep. Deleted AFTER the save
  // so a failed create takes the rollback path above instead (which removes them
  // along with everything else), and never thrown — the product is already saved
  // and consistent, so a storage hiccup must not fail the request.
  if (bornOrphaned.length > 0) {
    console.log(`[ProductController] Discarding ${bornOrphaned.length} model image(s) with no model`);
    await deleteHostedImages(bornOrphaned);
  }

  invalidateCache('products');
  revalidateFrontendTags(productNextTags(savedProduct));

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
  // Images the browser already uploaded straight to Cloudinary (direct upload).
  const preUploaded = normalizePreUploaded(fields.uploadedImages);
  delete fields.uploadedImages;
  const { order: imageOrder, primary: primaryImage, adopt: adoptImages } = takeSequencing(fields);
  assertValidProduct(fields, { partial: true });
  const files  = req.files || (req.file ? [req.file] : []);
  const replaceImages = fields.replaceImages === 'true' || fields.replaceImages === true;
  delete fields.replaceImages;

  // Image keys the client staged for removal (deferred from UI remove actions).
  // Usually public_ids; a migrated image without one is keyed by URL. These drop
  // out of the saved gallery, and Step 4 then cleans up whatever that orphaned —
  // never the other way round, so DB and Cloudinary cannot disagree.
  let clientPendingDeletes = [];
  if (fields.deletePublicIds) {
    if (Array.isArray(fields.deletePublicIds)) {
      // Already an array — a JSON request body, rather than multipart.
      clientPendingDeletes = fields.deletePublicIds;
    } else {
      try {
        const parsed = JSON.parse(fields.deletePublicIds);
        // A non-array payload (e.g. `"5"`, `{}`) must degrade to "nothing
        // staged" rather than blowing up the update on a later .filter().
        if (Array.isArray(parsed)) clientPendingDeletes = parsed;
      } catch {
        clientPendingDeletes = [];
      }
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
  
  /*
    Keep the whole ref, not just the id: the url is what says WHICH STORE holds
    the asset, and it is only available here on the pre-update document. Reduced
    to ids, the cleanup below could only guess — and guessing wrong deletes
    nothing while reporting success.
  */
  const oldRefs = product.images
    .filter((img) => img.public_id)
    .map((img) => ({ public_id: img.public_id, url: img.url }));

  // ── Step 1: Upload new images (if any) ────────────────────────────────
  let newUploads = [];
  if (files.length > 0) {
    newUploads = await uploadManyToCloudinary(
      files.map((f) => f.buffer),
      { folder: productFolder(product._id) }
    );
    // uploadManyToCloudinary is all-or-nothing — if it throws, no DB changes happen
  }

  // Combine direct-uploaded refs (order preserved) with any server-side uploads.
  const newRefs = [
    ...preUploaded,
    ...newUploads.map((img) => ({ url: img.secure_url, public_id: img.public_id })),
  ];

  // ── Step 2: Compose the final gallery ─────────────────────────────────
  //
  // The gallery is ALWAYS recomposed from the request's intent, never left
  // untouched. It used to be rewritten only when new images arrived, so an
  // admin who merely removed an image saved a product whose DB gallery still
  // listed it — while Step 4 went ahead and deleted the asset from Cloudinary.
  // The result was a dead URL persisted against the product: a broken image on
  // the storefront that reappeared in the form on every reload.
  //
  //   kept     = current gallery minus anything explicitly staged for deletion
  //              (or nothing at all, when replacing outright)
  //   appended = images uploaded in this request
  //   order    = the admin's drag/arrow arrangement; primary = their choice
  //
  // With no images/order/deletes in the payload this recomposes the existing
  // gallery unchanged, so partial updates that never touch images are a no-op.
  const deleteSet = new Set(
    clientPendingDeletes.filter((id) => typeof id === 'string' && id)
  );

  // `replaceImages` only wipes the gallery when something replaces it — a
  // replace request carrying no new image must not strand the product with
  // zero images (and Step 4 would then delete every asset it still needs).
  //
  // Removal matches on the image KEY, not strictly on public_id: migrated
  // WooCommerce rows carry no public_id and are identified by URL, and those
  // were previously impossible to remove at all.
  const kept = (replaceImages && newRefs.length > 0)
    ? []
    : (product.images || [])
        .map((img) => ({
          url:       img.url,
          public_id: img.public_id,
          alt:       img.alt,
          // Provenance MUST survive a round trip. Dropping it here would silently
          // re-classify every model photo as an ordinary gallery image on the
          // next save, making it immortal — the leak this flag exists to close.
          variantOwned: img.variantOwned === true,
          isPrimary: img.isPrimary,
        }))
        .filter((img) => !deleteSet.has(imageKey(img)));

  const appended = newRefs.map((img) => ({
    url:          img.url,
    public_id:    img.public_id,
    alt:          fields.name || product.name,
    isPrimary:    false,
    variantOwned: img.variantOwned === true,
  }));

  const composed = applyAdoptions(
    orderGallery([...kept, ...appended], imageOrder, primaryImage),
    adoptImages,
  );

  /*
    ── Model images, resolved against the gallery that is about to persist ─────

    Two passes, in this order, and the order matters:

      1. pruneDanglingPointers — a model pointing at an image this request
         removed is cleared, so we never store a pointer to nothing.
      2. planVariantOwnedCleanup — a photo uploaded FOR a model that nothing
         points at any more is dropped from the gallery. Because Step 4 below
         derives its storage cleanup from "on the product before, absent from
         the saved gallery now", dropping the row here is what actually deletes
         the asset. No separate delete call, and therefore no second code path
         that can be forgotten.

    Running these AFTER orderGallery is deliberate: orderGallery decides which
    image is primary, and the adoption rule (a model photo promoted to primary
    is kept as an ordinary product photo) can only be evaluated once that is
    settled.

    `fields.variants` is only present when the request actually sent variants.
    When it is absent — a partial update touching only price or SEO — the
    product's CURRENT variants are what the gallery must be judged against, or a
    price-only edit would delete every model photo on the product.
  */
  const effectiveVariants = Array.isArray(fields.variants)
    ? fields.variants
    // Plain objects, not live subdocuments: the helpers below spread their input,
    // and spreading a Mongoose subdocument yields its internals ($__, _doc)
    // rather than its fields.
    : (product.variants || []).map((v) => (typeof v?.toObject === 'function' ? v.toObject() : v));
  const prunedVariants = pruneDanglingPointers(composed, effectiveVariants);
  if (Array.isArray(fields.variants)) fields.variants = prunedVariants;

  const { survivors } = planVariantOwnedCleanup(composed, prunedVariants);
  fields.images = survivors;

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
    // DB failed after new images landed on Cloudinary — rollback every new asset
    // (direct-uploaded + server-side) so nothing is orphaned.
    const rollback = newRefs.filter((i) => i.public_id);
    if (rollback.length) {
      console.warn(`[ProductController] DB update failed — rolling back ${rollback.length} new upload(s)`);
      await deleteHostedImages(rollback);
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
  // Cleanup is DERIVED from what actually persisted, not from what the client
  // asked us to delete: an asset is removed only when it was on the product
  // before and is absent from the saved gallery now. That makes "Cloudinary
  // deleted, DB still points at it" structurally impossible — the exact broken
  // image this used to produce — and it also means a forged or stale
  // `deletePublicIds` can never reach an asset the product still references
  // (or one belonging to a different product entirely).
  //
  // Failures here are logged with [CLEANUP_REQUIRED] by deleteHostedImages but
  // do NOT throw — the DB is already consistent at this point, so we never
  // unwind a successful save over a storage cleanup failure.
  const survivingIds = new Set(
    (updatedProduct.images || []).map((img) => img.public_id).filter(Boolean)
  );
  const toDelete = oldRefs.filter((ref) => !survivingIds.has(ref.public_id));

  if (toDelete.length > 0) {
    console.log(`[ProductController] Cleaning up ${toDelete.length} orphaned asset(s) post-save`);
    await deleteHostedImages(toDelete);
  }

  invalidateCache('products');
  revalidateFrontendTags(productNextTags(updatedProduct));

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

  const imageRefs = product.images
    .filter((img) => img.public_id)
    .map((img) => ({ public_id: img.public_id, url: img.url }));

  console.log(`[ProductController] DELETE product: ${product._id} | "${product.name}" | ${imageRefs.length} image(s) to clean up`);

  // Soft delete first — data is safe even if Cloudinary cleanup partially fails
  product.isActive = false;
  product.deletedAt = new Date();
  await product.save();
  console.log(`[ProductController] Soft-deleted product: ${product._id}`);

  // Clean up storage — failures logged with [CLEANUP_REQUIRED], never thrown.
  if (imageRefs.length) {
    await deleteHostedImages(imageRefs);
  }

  invalidateCache('products');
  revalidateFrontendTags(productNextTags(product));

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
    /*
      These came from uploadManyToCloudinary — the SERVER-side multer path, which
      always writes to Cloudinary regardless of STORAGE_PROVIDER — so the
      rollback is correctly Cloudinary-only. See the note on this route below.
    */
    console.warn(`[ProductController] DB save failed — rolling back ${uploaded.length} Cloudinary upload(s)`);
    await deleteManyFromCloudinary(uploaded.map((i) => i.public_id));
    throw dbError;
  }

  invalidateCache('products');
  revalidateFrontendTags(productNextTags(product));

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

  /*
    Capture the whole ref BEFORE the splice: the url is what says which store
    holds this asset, and it is gone from the document a line later. Deleting by
    id alone would send every R2 image to Cloudinary, which answers `not_found`
    and leaves the object — and its ~14 variants — orphaned.
  */
  const removedRef = {
    public_id: product.images[imageIndex].public_id,
    url: product.images[imageIndex].url,
  };

  // Remove from DB first, then delete from storage
  product.images.splice(imageIndex, 1);

  // Promote first remaining image to primary if the deleted one was primary
  if (product.images.length > 0 && !product.images.some((img) => img.isPrimary)) {
    product.images[0].isPrimary = true;
  }

  await product.save();
  console.log(`[ProductController] Image removed from DB: ${product._id}`);

  // Delete from storage after the DB is safe (failure logged, never thrown)
  await deleteHostedImages([removedRef]);

  invalidateCache('products');
  revalidateFrontendTags(productNextTags(product));

  res.json({
    success: true,
    message: 'Image deleted successfully',
    remainingImages: product.images,
  });
};

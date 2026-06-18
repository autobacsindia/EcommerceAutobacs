import express from "express";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import rateLimit from 'express-rate-limit';
import { searchRateLimit, searchBurstLimit, publicBrowsingRateLimit } from '../middleware/rateLimitMiddleware.js';
import {
  validateProductIdParam,
  validateStockUpdate,
  validateBrandParam,
  validateSearchSuggestions,
  validateSearchHistory,
  validateSearchTermParam,
  validateSearchAnalytics,
  validateProductSearch
} from "../middleware/validationMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { cacheMiddleware } from "../middleware/cacheControl.js";
import { publicCacheResponse, invalidatePublicCache } from "../middleware/publicCacheMiddleware.js";
import {
  uploadMultiple,
  handleMulterError,
  validateUploadedFiles,
  concurrentUploadGuard,
} from "../middleware/uploadMiddleware.js";
import {
  getProducts,
  getSearchSuggestions,
  getSearchAnalytics,
  getSearchHistory,
  clearSearchHistory,
  removeSearchHistoryTerm,
  getFeaturedProducts,
  getOfferProducts,
  getProductsByVehicle,
  getBrands,
  getSimilarProducts,
  getComplementaryProducts
} from "../controllers/productController.js";
import {
  createProductWithImages,
  updateProductWithImages,
  deleteProductWithImages,
  uploadProductImages,
  deleteProductImage,
} from "../controllers/productImageController.js";
import {
  getBrandProducts,
  getBrandDetails,
} from "../controllers/productBrandController.js";
import {
  getProductBySlug,
  updateStock,
  cleanupWordPress,
  getCleanupStatus,
} from "../controllers/productAdminController.js";
import Product from "../models/Product.js";
import {
  importWordPressProducts,
  getMissingWordPressProducts,
  previewWordPressImport,
  importBrandProducts,
  getImportStatus,
  getImportJobStatus,
  getScheduledImports,
  scheduleImport,
  importWordPressFull,
  importWordPressCategories,
} from "../controllers/productImportController.js";

const router = express.Router();

// CRITICAL: Rate limiting for public product endpoints (high-traffic)
const publicProductRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requests per 15 min (generous for legitimate traffic)
  message: { 
    success: false, 
    message: 'Too many requests. Please try again later.' 
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// @route   GET /products
// @desc    Get all products with filtering, sorting, and pagination
// @access  Public
// CRITICAL: Layered rate limiting for search (broad IP cap → burst → sustained)
router.get("/", publicBrowsingRateLimit, searchBurstLimit, searchRateLimit, cacheMiddleware('product-listing'), publicCacheResponse('PRODUCT_LIST'), validateProductSearch, asyncHandler(getProducts));

// @route   GET /products/suggestions
// @desc    Get search suggestions
// @access  Public
// CRITICAL: Rate limit search suggestions (autocomplete fires on every keystroke)
router.get("/suggestions", publicBrowsingRateLimit, searchBurstLimit, searchRateLimit, publicCacheResponse('PRODUCT_SEARCH'), validateSearchSuggestions, asyncHandler(getSearchSuggestions));

// @route   GET /products/analytics
// @desc    Get search analytics
// @access  Private/Admin
router.get("/analytics", protect, admin, validateSearchAnalytics, asyncHandler(getSearchAnalytics));

// @route   GET /products/history
// @desc    Get search history
// @access  Public
router.get("/history", validateSearchHistory, publicCacheResponse('PRODUCT_HISTORY'), asyncHandler(getSearchHistory));

// @route   DELETE /products/history
// @desc    Clear search history
// @access  Public
router.delete("/history", asyncHandler(clearSearchHistory));

// @route   DELETE /products/history/:term
// @desc    Remove term from search history
// @access  Public
router.delete("/history/:term", validateSearchTermParam, asyncHandler(removeSearchHistoryTerm));

// @route   GET /products/featured
// @desc    Get featured products
// @access  Public
router.get("/featured", publicProductRateLimit, publicCacheResponse('PRODUCT_FEATURED'), asyncHandler(getFeaturedProducts));

// @route   GET /products/offers
// @desc    Get products to showcase on Offers page
// @access  Public
router.get("/offers", publicCacheResponse('PRODUCT_OFFERS'), asyncHandler(getOfferProducts));

// @route   GET /products/by-vehicle/:vehicleId
// @desc    Get products compatible with a specific vehicle
// @access  Public
router.get('/by-vehicle/:vehicleId', asyncHandler(getProductsByVehicle));

// @route   GET /products/brands
// @desc    Get all available brands
// @access  Public
router.get('/brands', publicProductRateLimit, publicCacheResponse('PRODUCT_BRANDS'), asyncHandler(getBrands));

// @route   GET /products/brands/:brandName
// @desc    Get products for a specific brand
// @access  Public
router.get('/brands/:brandName', publicProductRateLimit, publicCacheResponse('PRODUCT_BRANDS'), asyncHandler(getBrandProducts));

// @route   GET /products/brands/:brandName/details
// @desc    Get details for a specific brand
// @access  Public
router.get('/brands/:brandName/details', asyncHandler(getBrandDetails));

// ── Import routes ──────────────────────────────────────────────────────────────

// @route   POST /products/import/wordpress
// @desc    Import products from WordPress
// @access  Private/Admin
router.post("/import/wordpress", protect, admin, asyncHandler(importWordPressProducts));

// @route   GET /products/import/wordpress/missing
// @desc    List WordPress products not yet in local DB
// @access  Private/Admin
router.get("/import/wordpress/missing", protect, admin, asyncHandler(getMissingWordPressProducts));

// @route   GET /products/import/wordpress/preview
// @desc    Preview what a WordPress import would create/update
// @access  Private/Admin
router.get("/import/wordpress/preview", protect, admin, asyncHandler(previewWordPressImport));

// @route   POST /products/import/wordpress/full
// @desc    Import all products and categories from WordPress
// @access  Private/Admin
router.post("/import/wordpress/full", protect, admin, asyncHandler(importWordPressFull));

// @route   POST /products/import/wordpress/categories
// @desc    Import only categories from WordPress
// @access  Private/Admin
router.post("/import/wordpress/categories", protect, admin, asyncHandler(importWordPressCategories));

// @route   POST /products/import/brand/:brandName
// @desc    Import products for a specific brand from WordPress
// @access  Private/Admin
router.post("/import/brand/:brandName", protect, admin, validateBrandParam, asyncHandler(importBrandProducts));

// @route   GET /products/import/status
// @desc    Get recent import job list
// @access  Private/Admin
router.get("/import/status", protect, admin, asyncHandler(getImportStatus));

// @route   GET /products/import/status/:jobId
// @desc    Get a specific import job status
// @access  Private/Admin
router.get("/import/status/:jobId", protect, admin, asyncHandler(getImportJobStatus));

// @route   GET /products/import/schedule
// @desc    List all scheduled imports
// @access  Private/Admin
router.get("/import/schedule", protect, admin, asyncHandler(getScheduledImports));

// @route   POST /products/import/schedule
// @desc    Schedule recurring imports
// @access  Private/Admin
router.post("/import/schedule", protect, admin, asyncHandler(scheduleImport));

// ── Cleanup routes ─────────────────────────────────────────────────────────────

// @route   POST /products/cleanup/wordpress
// @desc    Clean up WordPress imported products (remove HTML tags and categorise)
// @access  Private/Admin
router.post("/cleanup/wordpress", protect, admin, asyncHandler(cleanupWordPress));

// @route   GET /products/cleanup/status
// @desc    Get cleanup status
// @access  Private/Admin
router.get("/cleanup/status", protect, admin, asyncHandler(getCleanupStatus));

// ── Product CRUD ───────────────────────────────────────────────────────────────

// @route   GET /products/slug/:slug
// @desc    Get product by slug (SEO-friendly canonical URL)
// @access  Public
router.get("/slug/:slug", cacheMiddleware('product-detail'), publicCacheResponse('PRODUCT_DETAIL'), asyncHandler(getProductBySlug));

// @route   GET /products/:id
// @desc    301 redirect to slug-based canonical URL; preserves backlinks and prevents duplicate indexing
// @access  Public
router.get("/:id", validateProductIdParam, publicCacheResponse('PRODUCT_DETAIL'), asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).select('slug').lean();

  if (!product) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  if (product.slug) {
    // Permanent redirect — consolidates SEO authority and prevents duplicate indexing
    // Redirect to the slug-based endpoint with /api/v1/ prefix
    return res.redirect(301, `/api/v1/products/slug/${product.slug}`);
  }

  // Product exists but has no slug yet (pre-migration doc) — serve directly
  return (await import('../controllers/productAdminController.js')).getProduct(req, res);
}));

// @route   GET /products/:id/similar
// @desc    Get products similar to the specified product (same category/brand/tags)
// @access  Public
router.get('/:id/similar', validateProductIdParam, publicProductRateLimit, publicCacheResponse('PRODUCT_SIMILAR'), asyncHandler(getSimilarProducts));

// @route   GET /products/:id/complementary
// @desc    Get complementary products (commonly bought together)
// @access  Public
router.get('/:id/complementary', validateProductIdParam, publicProductRateLimit, publicCacheResponse('PRODUCT_COMPLEMENTARY'), asyncHandler(getComplementaryProducts));

// @route   POST /products
// @desc    Create a new product (supports multipart/form-data with images)
// @access  Private/Admin
router.post(
  "/",
  protect,
  admin,
  concurrentUploadGuard,
  uploadMultiple('images', 8),
  handleMulterError,
  validateUploadedFiles,
  asyncHandler(createProductWithImages)
);

// @route   PUT /products/:id
// @desc    Update product (supports multipart/form-data with optional new images)
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  admin,
  validateProductIdParam,
  concurrentUploadGuard,
  uploadMultiple('images', 8),
  handleMulterError,
  validateUploadedFiles,
  asyncHandler(updateProductWithImages),
  // Invalidate product detail and list cache after update.
  // updateProductWithImages has already sent the response; this runs as a
  // terminal side-effect and must NOT call next() — doing so would fall through
  // to the 404 notFound handler and race the buffered response.
  asyncHandler(async (req) => {
    try {
      await invalidatePublicCache(`PRODUCT_DETAIL:*${req.params.id}*`);
      await invalidatePublicCache('PRODUCT_LIST*');
      console.log(`[Cache] Invalidated product caches for ${req.params.id}`);
    } catch (error) {
      console.warn('[Cache] Failed to invalidate product cache:', error.message);
    }
  })
);

// @route   DELETE /products/:id
// @desc    Soft-delete product + remove all Cloudinary images
// @access  Private/Admin
router.delete(
  "/:id",
  protect,
  admin,
  validateProductIdParam,
  asyncHandler(deleteProductWithImages)
);

// @route   POST /products/:id/images
// @desc    Add more images to an existing product
// @access  Private/Admin
router.post(
  "/:id/images",
  protect,
  admin,
  concurrentUploadGuard,
  uploadMultiple('images', 8),
  handleMulterError,
  validateUploadedFiles,
  asyncHandler(uploadProductImages)
);

// @route   DELETE /products/:id/images/:encodedPublicId
// @desc    Remove a single image from a product (public_id base64-encoded in URL)
// @access  Private/Admin
router.delete(
  "/:id/images/:encodedPublicId",
  protect,
  admin,
  asyncHandler(deleteProductImage)
);

// @route   POST /products/:id/stock
// @desc    Update product stock
// @access  Private/Admin
router.post(
  "/:id/stock",
  protect,
  admin,
  validateStockUpdate,
  asyncHandler(updateStock),
  // Invalidate product detail cache after stock update
  asyncHandler(async (req, res, next) => {
    try {
      await invalidatePublicCache(`PRODUCT_DETAIL:*${req.params.id}*`);
      console.log(`[Cache] Invalidated product detail cache for ${req.params.id}`);
    } catch (error) {
      console.warn('[Cache] Failed to invalidate product cache:', error.message);
    }
    next();
  })
);

export default router;

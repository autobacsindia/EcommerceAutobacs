import express from "express";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import {
  validateProduct,
  validateProductIdParam,
  validateProductUpdate,
  validateStockUpdate,
  validateBrandParam,
  validateSearchSuggestions,
  validateSearchHistory,
  validateSearchTermParam,
  validateSearchAnalytics,
  validateProductSearch
} from "../middleware/validationMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { cacheResponse, invalidateCache } from "../middleware/cacheMiddleware.js";
import ElasticsearchSyncMiddleware from "../middleware/elasticsearchSyncMiddleware.js";
import {
  uploadMultiple,
  uploadFields,
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
  getBrands
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
  getProduct,
  updateStock,
  cleanupWordPress,
  getCleanupStatus,
} from "../controllers/productAdminController.js";
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

// @route   GET /products
// @desc    Get all products with filtering, sorting, and pagination
// @access  Public
router.get("/", cacheResponse(300), validateProductSearch, asyncHandler(getProducts));

// @route   GET /products/suggestions
// @desc    Get search suggestions
// @access  Public
router.get("/suggestions", cacheResponse(300), validateSearchSuggestions, asyncHandler(getSearchSuggestions));

// @route   GET /products/analytics
// @desc    Get search analytics
// @access  Private/Admin
router.get("/analytics", protect, admin, validateSearchAnalytics, asyncHandler(getSearchAnalytics));

// @route   GET /products/history
// @desc    Get search history
// @access  Public
router.get("/history", validateSearchHistory, asyncHandler(getSearchHistory));

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
router.get("/featured", cacheResponse(5 * 60), asyncHandler(getFeaturedProducts));

// @route   GET /products/offers
// @desc    Get products to showcase on Offers page
// @access  Public
router.get("/offers", cacheResponse(5 * 60), asyncHandler(getOfferProducts));

// @route   GET /products/by-vehicle/:vehicleId
// @desc    Get products compatible with a specific vehicle
// @access  Public
router.get('/by-vehicle/:vehicleId', asyncHandler(getProductsByVehicle));

// @route   GET /products/brands
// @desc    Get all available brands
// @access  Public
router.get('/brands', asyncHandler(getBrands));

// @route   GET /products/brands/:brandName
// @desc    Get products for a specific brand
// @access  Public
router.get('/brands/:brandName', asyncHandler(getBrandProducts));

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

// @route   GET /products/:id
// @desc    Get product by ID
// @access  Public
router.get("/:id", validateProductIdParam, asyncHandler(getProduct));

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
  asyncHandler(createProductWithImages),
  ElasticsearchSyncMiddleware.syncProduct
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
  ElasticsearchSyncMiddleware.syncProduct
);

// @route   DELETE /products/:id
// @desc    Soft-delete product + remove all Cloudinary images
// @access  Private/Admin
router.delete(
  "/:id",
  protect,
  admin,
  validateProductIdParam,
  asyncHandler(deleteProductWithImages),
  ElasticsearchSyncMiddleware.syncProduct
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
  ElasticsearchSyncMiddleware.syncProduct
);

export default router;

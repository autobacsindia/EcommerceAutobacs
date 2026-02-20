import express from "express";
import mongoose from "mongoose";
import Product from "../models/Product.js";
import SearchService from "../services/searchService.js";
import ProductImportService from "../services/productImportService.js";
import BrandProductImportService from "../services/brandProductImportService.js";
import ScheduledImportService from "../services/scheduledImportService.js";
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
import { cacheResponse } from "../middleware/cacheMiddleware.js";
import { cleanupWordPressProducts } from "../utils/wordpressProductCleanup.js";
import ElasticsearchSyncMiddleware from "../middleware/elasticsearchSyncMiddleware.js";
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
router.get("/featured", asyncHandler(getFeaturedProducts));

// @route   GET /products/offers
// @desc    Get products to showcase on Offers page
// @access  Public
router.get("/offers", asyncHandler(getOfferProducts));

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
router.get('/brands/:brandName', asyncHandler(async (req, res) => {
  const { brandName } = req.params;
  
  try {
    // Use the search service to find products by brand
    const searchResults = await SearchService.searchProducts({
      brand: brandName,
      page: req.query.page || 1,
      limit: req.query.limit || 12
    });
    
    res.json({
      success: true,
      count: searchResults.products.length,
      ...searchResults.pagination,
      products: searchResults.products
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch brand products',
      error: error.message
    });
  }
}));

// @route   GET /products/brands/:brandName/details
// @desc    Get details for a specific brand
// @access  Public
router.get('/brands/:brandName/details', asyncHandler(async (req, res) => {
  const { brandName } = req.params;
  
  try {
    const Brand = (await import('../models/Brand.js')).default;
    
    // Normalize the slug
    const normalizedSlug = brandName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    
    // Find brand by name or slug
    let brandDoc = await Brand.findOne({ 
      $or: [
        { name: { $regex: new RegExp(`^${brandName}$`, 'i') } },
        { slug: normalizedSlug }
      ]
    });
    
    if (!brandDoc) {
      // Check if any products exist with this brand name
      const productCount = await Product.countDocuments({
        brand: { $regex: new RegExp(`^${brandName}$`, 'i') },
        isActive: true
      });
      
      if (productCount === 0) {
        // Brand doesn't exist anywhere
        return res.status(404).json({
          success: false,
          message: 'Brand not found'
        });
      }
      
      // Brand exists in products but not in Brand collection - create placeholder
      // Find the exact brand name from products
      const product = await Product.findOne({
        brand: { $regex: new RegExp(`^${brandName}$`, 'i') },
        isActive: true
      });
      
      const actualBrandName = product ? product.brand : brandName;
      const slug = actualBrandName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      
      return res.json({
        success: true,
        brand: {
          id: null,
          name: actualBrandName,
          slug: slug,
          logo: `https://via.placeholder.com/150?text=${encodeURIComponent(actualBrandName)}`,
          description: 'Premium automotive accessories and performance parts'
        }
      });
    }
    
    res.json({
      success: true,
      brand: {
        id: brandDoc._id.toString(),
        name: brandDoc.name,
        slug: brandDoc.slug,
        logo: brandDoc.logo || `https://via.placeholder.com/150?text=${encodeURIComponent(brandDoc.name)}`,
        description: brandDoc.description || 'Premium automotive accessories and performance parts'
      }
    });
  } catch (error) {
    console.error('Error fetching brand details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch brand details',
      error: error.message
    });
  }
}));

// @route   GET /products/:id
// @desc    Get product by ID
// @access  Public
router.get("/:id", validateProductIdParam, asyncHandler(async (req, res) => {
  const id = req.params.id; // Sanitized by middleware

  const product = await Product.findById(id)
    .populate('categories', 'name slug description')
    .populate('compatibleVehicles', 'make model year variant');

  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found'
    });
  }

  res.json({
    success: true,
    product
  });
}));

// @route   POST /products
// @desc    Create a new product
// @access  Private/Admin
router.post("/", protect, admin, validateProduct, asyncHandler(async (req, res, next) => {
  const product = new Product(req.body);
  const savedProduct = await product.save();
  
  // Store product in response locals for middleware
  res.locals.product = savedProduct;

  res.status(201).json({
    success: true,
    message: 'Product created successfully',
    product: savedProduct
  });

  // Proceed to sync middleware
  next();
}), ElasticsearchSyncMiddleware.syncProduct);

// @route   PUT /products/:id
// @desc    Update product
// @access  Private/Admin
router.put("/:id", protect, admin, validateProductIdParam, validateProductUpdate, asyncHandler(async (req, res, next) => {
  console.log('PUT /products/:id body:', req.body);
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('categories', 'name slug');
    
    // Store product in response locals for middleware
    res.locals.product = updatedProduct;

    res.json({
      success: true,
      message: 'Product updated successfully',
      product: updatedProduct
    });

    // Proceed to sync middleware
    next();
  } catch (error) {
    console.error('Error updating product:', error);
    // Pass to global error handler
    throw error;
  }
}), ElasticsearchSyncMiddleware.syncProduct);

// @route   DELETE /products/:id
// @desc    Delete product (soft delete by setting isActive to false)
// @access  Private/Admin
router.delete("/:id", protect, admin, validateProductIdParam, asyncHandler(async (req, res, next) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found'
    });
  }

  // Soft delete
  product.isActive = false;
  await product.save();
  
  // Store product in response locals for middleware
  res.locals.product = product;

  res.json({
    success: true,
    message: 'Product deleted successfully'
  });

  // Proceed to sync middleware
  next();
}), ElasticsearchSyncMiddleware.syncProduct);

// @route   POST /products/:id/stock
// @desc    Update product stock
// @access  Private/Admin
router.post("/:id/stock", protect, admin, validateStockUpdate, asyncHandler(async (req, res, next) => {
  const { stock } = req.body;
  const id = req.params.id; // Sanitized by middleware
  
  const product = await Product.findByIdAndUpdate(
    id,
    { stock },
    { new: true }
  );
  
  // Store product in response locals for middleware
  res.locals.product = product;

  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found'
    });
  }

  res.json({
    success: true,
    message: 'Stock updated successfully',
    product
  });

  // Proceed to sync middleware
  next();
}), ElasticsearchSyncMiddleware.syncProduct);

// @route   POST /products/import/wordpress
// @desc    Import products from WordPress
// @access  Private/Admin
router.post("/import/wordpress", protect, admin, asyncHandler(async (req, res) => {
  try {
    const importService = new ProductImportService();
    
    // Generate a unique job ID
    const jobId = `import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Start import process
    const importResult = await importService.importAllProducts(jobId, req.user._id, (progress) => {
      // In a real implementation, we would emit progress events to the client
      // For now, we'll just log to console
      console.log(`Import progress: ${progress.progress}%`);
    });
    
    if (importResult.success) {
      res.status(200).json({
        success: true,
        message: 'Products imported successfully',
        jobId: importResult.jobId,
        summary: importResult.summary
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to import products',
        jobId: importResult.jobId,
        error: importResult.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to import products',
      error: error.message
    });
  }
}));

router.get("/import/wordpress/missing", protect, admin, asyncHandler(async (req, res) => {
  try {
    const importService = new ProductImportService();
    const result = await importService.findMissingWordPressProducts();
    res.json({
      success: true,
      summary: {
        totalWordPressProducts: result.totalWordPressProducts,
        totalLocalProducts: result.totalLocalProducts,
        missingCount: result.missingCount
      },
      missingProducts: result.missingProducts
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get missing WordPress products',
      error: error.message
    });
  }
}));

router.get("/import/wordpress/preview", protect, admin, asyncHandler(async (req, res) => {
  try {
    const importService = new ProductImportService();
    const result = await importService.previewImport();
    res.json({
      success: true,
      summary: {
        totalWordPressProducts: result.totalWordPressProducts,
        toCreateCount: result.toCreateCount,
        toUpdateCount: result.toUpdateCount,
        failedCount: result.failedCount
      },
      toCreate: result.toCreate,
      toUpdate: result.toUpdate,
      failed: result.failed
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get WordPress import preview',
      error: error.message
    });
  }
}));

// @route   POST /products/import/brand/:brandName
// @desc    Import products for a specific brand from WordPress
// @access  Private/Admin
router.post("/import/brand/:brandName", protect, admin, validateBrandParam, asyncHandler(async (req, res) => {
  try {
    const { brandName } = req.params;
    const importService = new BrandProductImportService();
    
    // Generate a unique job ID
    const jobId = `import-brand-${brandName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Start import process
    const importResult = await importService.importBrandProducts(jobId, brandName, req.user._id, (progress) => {
      // In a real implementation, we would emit progress events to the client
      // For now, we'll just log to console
      console.log(`Import progress for ${brandName}: ${progress.progress}%`);
    });
    
    if (importResult.success) {
      res.status(200).json({
        success: true,
        message: `Products for brand ${brandName} imported successfully`,
        jobId: importResult.jobId,
        summary: importResult.summary
      });
    } else {
      res.status(500).json({
        success: false,
        message: `Failed to import products for brand ${brandName}`,
        jobId: importResult.jobId,
        error: importResult.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to import brand products',
      error: error.message
    });
  }
}));

// @route   GET /products/import/status
// @desc    Get import status
// @access  Private/Admin
router.get("/import/status", protect, admin, asyncHandler(async (req, res) => {
  try {
    // Get recent import jobs, sorted by creation date
    const importJobs = await ImportJob.find({})
      .sort({ createdAt: -1 })
      .limit(10);
    
    res.json({
      success: true,
      jobs: importJobs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get import status',
      error: error.message
    });
  }
}));

// @route   GET /products/import/status/:jobId
// @desc    Get specific import job status
// @access  Private/Admin
router.get("/import/status/:jobId", protect, admin, asyncHandler(async (req, res) => {
  try {
    const importJob = await ImportJob.findOne({ jobId: req.params.jobId });
    
    if (!importJob) {
      return res.status(404).json({
        success: false,
        message: 'Import job not found'
      });
    }
    
    res.json({
      success: true,
      job: importJob
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get import job status',
      error: error.message
    });
  }
}));

// @route   GET /products/import/schedule
// @desc    Get all scheduled imports
// @access  Private/Admin
router.get("/import/schedule", protect, admin, asyncHandler(async (req, res) => {
  try {
    const scheduledImportService = new ScheduledImportService();
    const schedules = scheduledImportService.getScheduledImports();
    
    res.json({
      success: true,
      schedules
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get scheduled imports',
      error: error.message
    });
  }
}));

// @route   POST /products/import/schedule
// @desc    Schedule recurring imports
// @access  Private/Admin
router.post("/import/schedule", protect, admin, asyncHandler(async (req, res) => {
  try {
    const { frequency, time } = req.body;
    
    if (!frequency || !time) {
      return res.status(400).json({
        success: false,
        message: 'Frequency and time are required'
      });
    }
    
    const scheduledImportService = new ScheduledImportService();
    const result = await scheduledImportService.scheduleImport(frequency, time, req.user._id);
    
    if (result.success) {
      res.status(200).json({
        success: true,
        message: 'Import scheduled successfully',
        schedule: result.schedule
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to schedule import',
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to schedule import',
      error: error.message
    });
  }
}));

// @route   POST /products/import/wordpress/full
// @desc    Import all products and categories from WordPress
// @access  Private/Admin
router.post("/import/wordpress/full", protect, admin, asyncHandler(async (req, res) => {
  try {
    const MigrationOrchestrationService = (await import('../services/migrationOrchestrationService.js')).default;
    const migrationService = new MigrationOrchestrationService();
    
    // Generate a unique job ID
    const jobId = `import-full-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Start full migration process
    const migrationResult = await migrationService.executeFullMigration(jobId, req.user._id, (progress) => {
      // In a real implementation, we would emit progress events to the client
      // For now, we'll just log to console
      console.log(`Migration progress - ${progress.phase}: ${progress.message}`);
    });
    
    if (migrationResult.success) {
      res.status(200).json({
        success: true,
        message: 'Full migration completed successfully',
        jobId: migrationResult.jobId,
        summary: migrationResult.summary
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to complete full migration',
        jobId: migrationResult.jobId,
        error: migrationResult.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to execute full migration',
      error: error.message
    });
  }
}));

// @route   POST /products/import/wordpress/categories
// @desc    Import only categories from WordPress
// @access  Private/Admin
router.post("/import/wordpress/categories", protect, admin, asyncHandler(async (req, res) => {
  try {
    const MigrationOrchestrationService = (await import('../services/migrationOrchestrationService.js')).default;
    const migrationService = new MigrationOrchestrationService();
    
    // Generate a unique job ID
    const jobId = `import-categories-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Start category migration process
    const migrationResult = await migrationService.executeCategoryMigration(jobId, req.user._id, (progress) => {
      // In a real implementation, we would emit progress events to the client
      // For now, we'll just log to console
      console.log(`Category migration progress: ${progress.message}`);
    });
    
    if (migrationResult.success) {
      res.status(200).json({
        success: true,
        message: 'Category migration completed successfully',
        jobId: migrationResult.jobId,
        summary: migrationResult.summary
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to complete category migration',
        jobId: migrationResult.jobId,
        error: migrationResult.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to execute category migration',
      error: error.message
    });
  }
}));

// @route   POST /products/cleanup/wordpress
// @desc    Clean up WordPress imported products (remove HTML tags and categorize)
// @access  Private/Admin
router.post("/cleanup/wordpress", protect, admin, asyncHandler(async (req, res) => {
  try {
    const { batchSize } = req.body || {};
    
    // Start cleanup process
    const cleanupResult = await cleanupWordPressProducts(batchSize);
    
    if (cleanupResult.success) {
      res.status(200).json({
        success: true,
        message: 'WordPress products cleaned up successfully',
        summary: cleanupResult
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to clean up WordPress products',
        error: cleanupResult.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to clean up WordPress products',
      error: error.message
    });
  }
}));

// @route   GET /products/cleanup/status
// @desc    Get cleanup status
// @access  Private/Admin
router.get("/cleanup/status", protect, admin, asyncHandler(async (req, res) => {
  // In a more advanced implementation, we would track cleanup jobs in a database
  // For now, we'll return a placeholder response
  res.json({
    success: true,
    status: 'Ready to start cleanup',
    lastCleanup: null
  });
}));

export default router;

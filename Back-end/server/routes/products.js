import express from "express";
import Product from "../models/Product.js";
import SearchService from "../services/searchService.js";
import ProductImportService from "../services/productImportService.js";
import ScheduledImportService from "../services/scheduledImportService.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { validateProduct } from "../middleware/validationMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { cleanupWordPressProducts } from "../utils/wordpressProductCleanup.js";

const router = express.Router();

// @route   GET /products
// @desc    Get all products with filtering, sorting, and pagination
// @access  Public
router.get("/", asyncHandler(async (req, res) => {
  const searchResults = await SearchService.searchProducts(req.query);
  
  res.json({
    success: true,
    count: searchResults.products.length,
    ...searchResults.pagination,
    products: searchResults.products
  });
}));

// @route   GET /products/suggestions
// @desc    Get search suggestions
// @access  Public
router.get("/suggestions", asyncHandler(async (req, res) => {
  const { q, limit = 10 } = req.query;
  const suggestions = await SearchService.getSearchSuggestions(q, parseInt(limit));
  
  res.json({
    success: true,
    suggestions
  });
}));

// @route   GET /products/featured
// @desc    Get featured products
// @access  Public
router.get("/featured", asyncHandler(async (req, res) => {
  const { limit = 6 } = req.query;

  const products = await Product.find({ isActive: true, isFeatured: true })
    .populate('category', 'name slug')
    .limit(Number(limit))
    .sort({ createdAt: -1 });

  res.json({
    success: true,
    count: products.length,
    products
  });
}));

// @route   GET /products/:id
// @desc    Get product by ID
// @access  Public
router.get("/:id", asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate('category', 'name slug description')
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
router.post("/", protect, admin, validateProduct, asyncHandler(async (req, res) => {
  const product = new Product(req.body);
  const savedProduct = await product.save();

  res.status(201).json({
    success: true,
    message: 'Product created successfully',
    product: savedProduct
  });
}));

// @route   PUT /products/:id
// @desc    Update product
// @access  Private/Admin
router.put("/:id", protect, admin, asyncHandler(async (req, res) => {
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
  );

  res.json({
    success: true,
    message: 'Product updated successfully',
    product: updatedProduct
  });
}));

// @route   DELETE /products/:id
// @desc    Delete product (soft delete by setting isActive to false)
// @access  Private/Admin
router.delete("/:id", protect, admin, asyncHandler(async (req, res) => {
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

  res.json({
    success: true,
    message: 'Product deleted successfully'
  });
}));

// @route   POST /products/:id/stock
// @desc    Update product stock
// @access  Private/Admin
router.post("/:id/stock", protect, admin, asyncHandler(async (req, res) => {
  const { stock } = req.body;

  if (stock === undefined || stock < 0) {
    return res.status(400).json({
      success: false,
      message: 'Valid stock quantity is required'
    });
  }

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { stock },
    { new: true }
  );

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
}));

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

// @route   GET /products/import/status
// @desc    Get import status
// @access  Private/Admin
router.get("/import/status", protect, admin, asyncHandler(async (req, res) => {
  // In a real implementation, we would track import jobs in a database
  // For now, we'll return a placeholder response
  res.json({
    success: true,
    status: 'No import in progress',
    lastImport: null
  });
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
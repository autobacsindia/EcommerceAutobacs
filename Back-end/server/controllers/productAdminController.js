import Product from '../models/Product.js';
import { cleanupWordPressProducts } from '../utils/wordpressProductCleanup.js';

// @route   GET /products/:id
// @desc    Get product by ID
// @access  Public
export async function getProduct(req, res) {
  const id = req.params.id; // Sanitised by validateProductIdParam middleware

  const product = await Product.findById(id)
    .populate('categories', 'name slug description')
    .populate('compatibleVehicles', 'make model year variant');

  if (!product) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  res.json({ success: true, product });
}

// @desc    Get product by slug (SEO-friendly URL lookup)
// @route   GET /products/slug/:slug
// @access  Public
export async function getProductBySlug(req, res) {
  const { slug } = req.params;

  const product = await Product.findOne({ slug, isActive: true })
    .populate('categories', 'name slug description')
    .populate('compatibleVehicles', 'make model year variant');

  if (!product) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  res.json({ success: true, product });
}

// @route   POST /products/:id/stock
// @desc    Update product stock
// @access  Private/Admin
export async function updateStock(req, res, next) {
  const { stock } = req.body;
  const id = req.params.id; // Sanitised by validateStockUpdate middleware

  const product = await Product.findByIdAndUpdate(id, { stock }, { new: true });

  if (!product) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  res.json({ success: true, message: 'Stock updated successfully', product });

  // ES sync is handled by the post('findOneAndUpdate') hook on ProductSchema.
  next();
}

// @route   POST /products/cleanup/wordpress
// @desc    Clean up WordPress imported products (remove HTML tags and categorise)
// @access  Private/Admin
export async function cleanupWordPress(req, res) {
  const { batchSize } = req.body || {};

  const cleanupResult = await cleanupWordPressProducts(batchSize);

  if (cleanupResult.success) {
    return res.status(200).json({
      success: true,
      message: 'WordPress products cleaned up successfully',
      summary: cleanupResult,
    });
  }

  res.status(500).json({
    success: false,
    message: 'Failed to clean up WordPress products',
    error: cleanupResult.error,
  });
}

// @route   GET /products/cleanup/status
// @desc    Get cleanup status
// @access  Private/Admin
export async function getCleanupStatus(req, res) {
  // TODO: Track cleanup jobs in a database for persistent status reporting
  res.json({
    success: true,
    status: 'Ready to start cleanup',
    lastCleanup: null,
  });
}

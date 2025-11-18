import express from "express";
import Product from "../models/Product.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { validateProduct } from "../middleware/validationMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// @route   GET /products
// @desc    Get all products with filtering, sorting, and pagination
// @access  Public
router.get("/", asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 12,
    category,
    brand,
    minPrice,
    maxPrice,
    search,
    vehicle,
    isFeatured,
    sortBy = 'createdAt',
    order = 'desc'
  } = req.query;

  // Build query
  const query = { isActive: true };

  if (category) query.category = category;
  if (brand) query.brand = brand;
  if (minPrice || maxPrice) {
    query.price = {};
    if (minPrice) query.price.$gte = Number(minPrice);
    if (maxPrice) query.price.$lte = Number(maxPrice);
  }
  if (vehicle) query.compatibleVehicles = vehicle;
  if (isFeatured) query.isFeatured = isFeatured === 'true';
  if (search) {
    query.$text = { $search: search };
  }

  // Pagination
  const skip = (Number(page) - 1) * Number(limit);

  // Sorting
  const sortOptions = {};
  sortOptions[sortBy] = order === 'asc' ? 1 : -1;

  // Execute query
  const products = await Product.find(query)
    .populate('category', 'name slug')
    .populate('compatibleVehicles', 'make model year')
    .sort(sortOptions)
    .skip(skip)
    .limit(Number(limit));

  const total = await Product.countDocuments(query);

  res.json({
    success: true,
    count: products.length,
    total,
    pages: Math.ceil(total / Number(limit)),
    currentPage: Number(page),
    products
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

export default router;

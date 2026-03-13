import express from "express";
import Brand from "../models/Brand.js";
import Product from "../models/Product.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { 
  validateBrand, 
  validateBrandUpdate, 
  validateBrandProductMap, 
  validateIdParam,
  validateRouteProductId,
  validateBrandQuery
} from "../middleware/validationMiddleware.js";
import { cacheResponse, invalidateCache } from "../middleware/cacheMiddleware.js";

const router = express.Router();

// TTLs
const BRAND_LIST_TTL    = 10 * 60; // 10 min — brands rarely change
const BRAND_ITEM_TTL    = 10 * 60; // 10 min
const BRAND_PRODUCT_TTL =  5 * 60; //  5 min — product associations change more often

// Helper function to generate slug from name
const generateSlug = (name) => {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
};

// @route   GET /brands
// @desc    Get all brands with pagination
// @access  Public
router.get("/", cacheResponse(BRAND_LIST_TTL), asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const search = req.query.search || '';
  const skip = (page - 1) * limit;

  // Build query
  const query = {};
  if (search) {
    query.name = { $regex: search, $options: 'i' };
  }

  // Get total count for pagination
  const total = await Brand.countDocuments(query);

  // Get brands with product count
  const brands = await Brand.find(query)
    .sort({ name: 1 })
    .skip(skip)
    .limit(limit);

  // Get product counts for each brand
  const brandsWithCount = await Promise.all(
    brands.map(async (brand) => {
      const productCount = await Product.countDocuments({ 
        brand: { $regex: new RegExp(`^${brand.name}$`, 'i') },
        isActive: true 
      });
      return {
        ...brand.toJSON(),
        productCount
      };
    })
  );

  res.json({
    success: true,
    brands: brandsWithCount,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1
    }
  });
}));

// @route   GET /brands/:id
// @desc    Get brand by ID
// @access  Public
router.get("/:id", asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.id);

  if (!brand) {
    return res.status(404).json({
      success: false,
      message: 'Brand not found'
    });
  }

  // Get product count
  const productCount = await Product.countDocuments({ 
    brand: { $regex: new RegExp(`^${brand.name}$`, 'i') },
    isActive: true 
  });

  res.json({
    success: true,
    brand: {
      ...brand.toJSON(),
      productCount
    }
  });
}));

// @route   POST /brands
// @desc    Create new brand
// @access  Private/Admin
router.post("/", protect, admin, validateBrand, asyncHandler(async (req, res) => {
  const { name, logo, description } = req.body;

  // Generate slug from name
  const slug = generateSlug(name);

  // Check if brand with same name or slug exists
  const existingBrand = await Brand.findOne({
    $or: [{ name: { $regex: new RegExp(`^${name}$`, 'i') } }, { slug }]
  });

  if (existingBrand) {
    return res.status(400).json({
      success: false,
      message: 'A brand with this name already exists'
    });
  }

  const brand = await Brand.create({
    name,
    slug,
    logo,
    description,
    isActive: true
  });

  invalidateCache('brands');

  res.status(201).json({
    success: true,
    message: 'Brand created successfully',
    brand
  });
}));

// @route   PUT /brands/:id
// @desc    Update brand
// @access  Private/Admin
router.put("/:id", protect, admin, validateBrandUpdate, asyncHandler(async (req, res) => {
  const { name, logo, description, isActive } = req.body;

  const brand = await Brand.findById(req.params.id);

  if (!brand) {
    return res.status(404).json({
      success: false,
      message: 'Brand not found'
    });
  }

  // If name is being changed, check for duplicates and update slug
  if (name && name !== brand.name) {
    const existingBrand = await Brand.findOne({
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      _id: { $ne: req.params.id }
    });

    if (existingBrand) {
      return res.status(400).json({
        success: false,
        message: 'A brand with this name already exists'
      });
    }

    // Update products with the old brand name to the new name
    const oldBrandName = brand.name;
    await Product.updateMany(
      { brand: { $regex: new RegExp(`^${oldBrandName}$`, 'i') } },
      { $set: { brand: name } }
    );

    brand.name = name;
    brand.slug = generateSlug(name);
  }

  if (logo !== undefined) brand.logo = logo;
  if (description !== undefined) brand.description = description;
  if (isActive !== undefined) brand.isActive = isActive;

  await brand.save();

  invalidateCache('brands', 'products');

  res.json({
    success: true,
    message: 'Brand updated successfully',
    brand
  });
}));

// @route   DELETE /brands/:id
// @desc    Delete brand
// @access  Private/Admin
router.delete("/:id", protect, admin, validateIdParam, asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.id);

  if (!brand) {
    return res.status(404).json({
      success: false,
      message: 'Brand not found'
    });
  }

  // Count products associated with this brand
  const productCount = await Product.countDocuments({ 
    brand: { $regex: new RegExp(`^${brand.name}$`, 'i') } 
  });

  // Hard delete
  await Brand.findByIdAndDelete(req.params.id);

  invalidateCache('brands', 'products');

  res.json({
    success: true,
    message: `Brand deleted successfully. ${productCount} product(s) were associated with this brand.`,
    productCount
  });
}));

// @route   GET /brands/:id/products
// @desc    Get products for a specific brand
// @access  Public
router.get("/:id/products", cacheResponse(BRAND_PRODUCT_TTL), asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.id);

  if (!brand) {
    return res.status(404).json({
      success: false,
      message: 'Brand not found'
    });
  }

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const query = { 
    brand: { $regex: new RegExp(`^${brand.name}$`, 'i') },
    isActive: true 
  };

  const total = await Product.countDocuments(query);
  const products = await Product.find(query)
    .populate('categories', 'name slug')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  res.json({
    success: true,
    brand: brand.toJSON(),
    products,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit
    }
  });
}));

// @route   POST /brands/:id/products
// @desc    Map products to a brand
// @access  Private/Admin
router.post("/:id/products", protect, admin, validateBrandProductMap, asyncHandler(async (req, res) => {
  const { productIds } = req.body;

  const brand = await Brand.findById(req.params.id);

  if (!brand) {
    return res.status(404).json({
      success: false,
      message: 'Brand not found'
    });
  }

  // Update products with the brand name
  const result = await Product.updateMany(
    { _id: { $in: productIds } },
    { $set: { brand: brand.name } }
  );

  invalidateCache('brands', 'products');

  res.json({
    success: true,
    message: `${result.modifiedCount} product(s) mapped to ${brand.name}`,
    modifiedCount: result.modifiedCount
  });
}));

// @route   DELETE /brands/:id/products/:productId
// @desc    Unmap a product from a brand
// @access  Private/Admin
router.delete("/:id/products/:productId", protect, admin, validateIdParam, validateRouteProductId, asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.id);

  if (!brand) {
    return res.status(404).json({
      success: false,
      message: 'Brand not found'
    });
  }

  const product = await Product.findById(req.params.productId);

  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found'
    });
  }

  // Remove brand from product
  product.brand = '';
  await product.save();

  invalidateCache('brands', 'products');

  res.json({
    success: true,
    message: `Product unmapped from ${brand.name}`
  });
}));

// @route   PATCH /brands/:id/toggle-status
// @desc    Toggle brand active status
// @access  Private/Admin
router.patch("/:id/toggle-status", protect, admin, validateIdParam, asyncHandler(async (req, res) => {
  const brand = await Brand.findById(req.params.id);

  if (!brand) {
    return res.status(404).json({
      success: false,
      message: 'Brand not found'
    });
  }

  brand.isActive = !brand.isActive;
  await brand.save();

  invalidateCache('brands');

  res.json({
    success: true,
    message: `Brand ${brand.isActive ? 'activated' : 'deactivated'} successfully`,
    brand
  });
}));

export default router;

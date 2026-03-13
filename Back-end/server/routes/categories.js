import express from "express";
import Category from "../models/Category.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { validateCategory, validateCategoryUpdate, validateIdParam, validateSlugParam } from "../middleware/validationMiddleware.js";
import { cacheResponse, invalidateCache } from "../middleware/cacheMiddleware.js";

const router = express.Router();

// TTLs — categories change rarely; 10 min is safe
const CATEGORY_LIST_TTL  = 10 * 60; // 10 min
const CATEGORY_ITEM_TTL  = 10 * 60; // 10 min

// @route   GET /categories
// @desc    Get all active categories
// @access  Public
router.get("/", cacheResponse(CATEGORY_LIST_TTL), asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true })
    .populate('parent', 'name slug')
    .sort({ order: 1, name: 1 });

  res.json({
    success: true,
    count: categories.length,
    categories
  });
}));

// @route   GET /categories/:id
// @desc    Get category by ID
// @access  Public
router.get("/:id", validateIdParam, cacheResponse(CATEGORY_ITEM_TTL), asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id)
    .populate('parent', 'name slug');

  if (!category) {
    return res.status(404).json({
      success: false,
      message: 'Category not found'
    });
  }

  res.json({
    success: true,
    category
  });
}));

// @route   GET /categories/slug/:slug
// @desc    Get category by slug (supports both hyphenated and non-hyphenated versions)
// @access  Public
router.get("/slug/:slug", validateSlugParam, cacheResponse(CATEGORY_ITEM_TTL), asyncHandler(async (req, res) => {
  let category = await Category.findOne({ slug: req.params.slug, isActive: true })
    .populate('parent', 'name slug');

  // If not found, try with hyphenated version for common cases
  if (!category) {
    // Simple transformations for known cases
    let hyphenatedSlug = req.params.slug;
    
    if (req.params.slug === 'bodykit') {
      hyphenatedSlug = 'body-kits';
    } else if (req.params.slug === 'lights') {
      hyphenatedSlug = 'lighting';
    } else if (req.params.slug === 'audio') {
      hyphenatedSlug = 'speaker';
    }
    
    // Only search if we actually transformed the slug
    if (hyphenatedSlug !== req.params.slug) {
      category = await Category.findOne({ slug: hyphenatedSlug, isActive: true })
        .populate('parent', 'name slug');
    }
  }
  
  // If still not found, try with non-hyphenated version (for hyphenated inputs like 'body-kit')
  if (!category) {
    const nonHyphenatedSlug = req.params.slug.replace(/-/g, '');
    category = await Category.findOne({ slug: nonHyphenatedSlug, isActive: true })
      .populate('parent', 'name slug');
  }

  if (!category) {
    return res.status(404).json({
      success: false,
      message: 'Category not found'
    });
  }

  res.json({
    success: true,
    category
  });
}));

// @route   POST /categories
// @desc    Create new category
// @access  Private/Admin
router.post("/", protect, admin, validateCategory, asyncHandler(async (req, res) => {
  const { name, slug, description, parent, image, order } = req.body;

  const category = await Category.create({
    name,
    slug,
    description,
    parent,
    image,
    order
  });

  invalidateCache('categories');

  res.status(201).json({
    success: true,
    message: 'Category created successfully',
    category
  });
}));

// @route   PUT /categories/:id
// @desc    Update category
// @access  Private/Admin
router.put("/:id", protect, admin, validateCategoryUpdate, asyncHandler(async (req, res) => {
  const category = await Category.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true }
  );

  if (!category) {
    return res.status(404).json({
      success: false,
      message: 'Category not found'
    });
  }

  invalidateCache('categories');

  res.json({
    success: true,
    message: 'Category updated successfully',
    category
  });
}));

// @route   DELETE /categories/:id
// @desc    Delete category (soft delete)
// @access  Private/Admin
router.delete("/:id", protect, admin, validateIdParam, asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);

  if (!category) {
    return res.status(404).json({
      success: false,
      message: 'Category not found'
    });
  }

  category.isActive = false;
  await category.save();

  invalidateCache('categories');

  res.json({
    success: true,
    message: 'Category deleted successfully'
  });
}));

export default router;

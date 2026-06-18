import express from "express";
import categoryRepository from "../repositories/categoryRepository.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { validateCategory, validateCategoryUpdate, validateIdParam, validateSlugParam } from "../middleware/validationMiddleware.js";
import { cacheResponse, invalidateCache } from "../middleware/cacheMiddleware.js";
import { cacheMiddleware } from "../middleware/cacheControl.js";
import { uploadSingle, handleMulterError, validateUploadedFiles, concurrentUploadGuard } from "../middleware/uploadMiddleware.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinaryHelpers.js";

const router = express.Router();

// TTLs — categories change rarely; 10 min is safe
const CATEGORY_LIST_TTL  = 10 * 60; // 10 min
const CATEGORY_ITEM_TTL  = 10 * 60; // 10 min

// @route   GET /categories
// @desc    Get all active categories with optional pagination
// @access  Public
router.get("/", cacheMiddleware('static-data'), cacheResponse(CATEGORY_LIST_TTL), asyncHandler(async (req, res) => {
  // Categories are a small, bounded collection (rarely > 100).
  // Still cap at 200 as a safety guard; clients that need all categories
  // for nav menus can omit page/limit and get the full list up to the cap.
  const MAX_LIMIT = 200;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit) || MAX_LIMIT));
  const skip = (page - 1) * limit;

  const filter = { isActive: true };

  const [categories, total] = await Promise.all([
    categoryRepository.find(filter)
      .populate('parent', 'name slug')
      .sort({ order: 1, name: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    categoryRepository.countDocuments(filter)
  ]);

  res.json({
    success: true,
    count: categories.length,
    categories,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit
    }
  });
}));

// @route   GET /categories/:id
// @desc    Get category by ID
// @access  Public
router.get("/:id", validateIdParam, cacheResponse(CATEGORY_ITEM_TTL), asyncHandler(async (req, res) => {
  const category = await categoryRepository.findById(req.params.id)
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
  let category = await categoryRepository.findOne({ slug: req.params.slug, isActive: true })
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
      category = await categoryRepository.findOne({ slug: hyphenatedSlug, isActive: true })
        .populate('parent', 'name slug');
    }
  }
  
  // If still not found, try with non-hyphenated version (for hyphenated inputs like 'body-kit')
  if (!category) {
    const nonHyphenatedSlug = req.params.slug.replace(/-/g, '');
    category = await categoryRepository.findOne({ slug: nonHyphenatedSlug, isActive: true })
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
// @desc    Create new category (optionally with image file upload)
// @access  Private/Admin
router.post(
  "/",
  protect,
  admin,
  concurrentUploadGuard,
  uploadSingle('image'),
  handleMulterError,
  validateUploadedFiles,
  validateCategory,
  asyncHandler(async (req, res) => {
    const { name, slug, description, parent, order } = req.body;

    let imageData = req.body.image || {};  // allow plain URL object from JSON

    // If a file was uploaded, send it to Cloudinary
    if (req.file) {
      const uploaded = await uploadToCloudinary(req.file.buffer, {
        folder: 'autobacs/categories',
      });
      imageData = {
        url:       uploaded.secure_url,
        public_id: uploaded.public_id,
        alt:       name,
      };
    }

    const category = await categoryRepository.create({
      name,
      slug,
      description,
      parent,
      image: imageData,
      order,
    });

    invalidateCache('categories');

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      category,
    });
  })
);

// @route   PUT /categories/:id
// @desc    Update category (optionally replace image via file upload)
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  admin,
  concurrentUploadGuard,
  uploadSingle('image'),
  handleMulterError,
  validateUploadedFiles,
  validateCategoryUpdate,
  asyncHandler(async (req, res) => {
    const category = await categoryRepository.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const updateData = { ...req.body };

    // If a new file was uploaded, replace old Cloudinary image
    if (req.file) {
      // Delete old image if it has a public_id
      if (category.image?.public_id) {
        await deleteFromCloudinary(category.image.public_id);
      }

      const uploaded = await uploadToCloudinary(req.file.buffer, {
        folder: 'autobacs/categories',
      });
      updateData.image = {
        url:       uploaded.secure_url,
        public_id: uploaded.public_id,
        alt:       updateData.name || category.name,
      };
    }

    const updated = await categoryRepository.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    invalidateCache('categories');

    res.json({ success: true, message: 'Category updated successfully', category: updated });
  })
);

// @route   DELETE /categories/:id
// @desc    Delete category (soft delete)
// @access  Private/Admin
router.delete("/:id", protect, admin, validateIdParam, asyncHandler(async (req, res) => {
  const category = await categoryRepository.findById(req.params.id);

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

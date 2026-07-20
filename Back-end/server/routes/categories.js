import express from "express";
import categoryRepository from "../repositories/categoryRepository.js";
import productRepository from "../repositories/productRepository.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { validateCategory, validateCategoryUpdate, validateIdParam, validateSlugParam } from "../middleware/validationMiddleware.js";
import { invalidateCache } from "../middleware/cacheMiddleware.js";
import { httpCache } from "../middleware/httpCache.js";
import { revalidateFrontendTags } from "../services/frontendRevalidator.js";
import { cacheMiddleware } from "../middleware/cacheControl.js";
import { uploadSingle, handleMulterError, validateUploadedFiles, concurrentUploadGuard } from "../middleware/uploadMiddleware.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinaryHelpers.js";
import categoryMappingService from "../services/categoryMappingService.js";
import { normalizeSeo } from "../utils/seo.js";

const router = express.Router();

// TTLs live in config/cacheProfiles.js (CATEGORY_LIST / CATEGORY_ITEM).

// @route   GET /categories
// @desc    Get all active categories with optional pagination
// @access  Public
router.get("/", httpCache('CATEGORY_LIST'), asyncHandler(async (req, res) => {
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

// @route   GET /categories/admin/all
// @desc    List ALL categories incl. inactive (admin dashboard management)
// @access  Private/Admin
// NOTE: declared before "/:id" so the literal path is matched first, and left
// uncached so admins always see the current state after create/update/delete.
router.get("/admin/all", protect, admin, asyncHandler(async (req, res) => {
  // Product counts drive the dashboard's badges, but they cost a distinct
  // aggregation over every active product. Pickers (the product create/edit
  // category multi-select, the parent-hub dropdown) only need the tree, so they
  // pass ?counts=false and skip it. Default stays true — the dashboard relies on it.
  const withProductCounts = req.query.counts !== 'false';

  const [categories, grouped] = await Promise.all([
    categoryRepository.find({})
      .populate('parent', 'name slug')
      .sort({ order: 1, name: 1 })
      .lean(),
    withProductCounts ? productRepository.distinctActiveIdsByCategory() : [],
  ]);

  if (!withProductCounts) {
    res.set('Cache-Control', 'private, no-store');
    return res.json({ success: true, count: categories.length, categories });
  }

  // Direct distinct product id sets per category (products tagged exactly here).
  const directIds = new Map(grouped.map((c) => [String(c._id), new Set(c.ids.map(String))]));

  // Roll counts up the tree so a parent's badge reflects what "View products"
  // shows (the whole subtree, since the search filter expands a category to all
  // its descendants). We UNION product id sets rather than summing counts, so a
  // product tagged with both a hub and a descendant is counted once — matching
  // the storefront facet (SearchService.getFacets) and the distinct listing
  // total. O(N) in-memory over the parent pointers we already loaded.
  const childrenOf = new Map();
  for (const c of categories) {
    const parentId = c.parent?._id ? String(c.parent._id) : (c.parent ? String(c.parent) : null);
    if (!parentId) continue;
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
    childrenOf.get(parentId).push(String(c._id));
  }

  const subtreeMemo = new Map();
  const inProgress = new Set();
  const subtreeIds = (id) => {
    if (subtreeMemo.has(id)) return subtreeMemo.get(id);
    if (inProgress.has(id)) return new Set(); // guard against any pre-existing cycle
    inProgress.add(id);
    const union = new Set(directIds.get(id) || []);
    for (const childId of (childrenOf.get(id) || [])) {
      for (const pid of subtreeIds(childId)) union.add(pid);
    }
    inProgress.delete(id);
    subtreeMemo.set(id, union);
    return union;
  };

  const withCounts = categories.map((c) => ({
    ...c,
    productCount: directIds.get(String(c._id))?.size || 0,
    totalProductCount: subtreeIds(String(c._id)).size,
  }));

  res.set('Cache-Control', 'private, no-store');
  res.json({
    success: true,
    count: withCounts.length,
    categories: withCounts
  });
}));

// @route   GET /categories/sitemap
// @desc    Lightweight slug+updatedAt list for sitemap generation
// @access  Public
// NOTE: must precede the dynamic "/:id" route so "sitemap" isn't captured as an id.
router.get("/sitemap", cacheMiddleware('static-data'), asyncHandler(async (_req, res) => {
  const categories = await categoryRepository
    .find({ isActive: true })
    .select('slug updatedAt')
    .sort({ updatedAt: -1 })
    .lean();
  res.json({ categories });
}));

// @route   GET /categories/:id
// @desc    Get category by ID
// @access  Public
router.get("/:id", validateIdParam, httpCache('CATEGORY_ITEM'), asyncHandler(async (req, res) => {
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
router.get("/slug/:slug", validateSlugParam, httpCache('CATEGORY_ITEM'), asyncHandler(async (req, res) => {
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
    const { name, slug, description, parent, order, isActive, isFeatured, imageAlt } = req.body;

    // Validate parent exists when provided — prevents dangling parent references.
    // Enforce a 2-level taxonomy (hub -> leaf): the chosen parent must itself be
    // top-level, so a new category can be at most one level deep.
    if (parent) {
      const parentDoc = await categoryRepository.findById(parent).select('parent').lean();
      if (!parentDoc) {
        return res.status(400).json({ success: false, message: 'Parent category not found.' });
      }
      if (parentDoc.parent) {
        return res.status(400).json({
          success: false,
          message: 'Categories are limited to two levels (hub → subcategory). Pick a top-level category as the parent.',
        });
      }
    }

    let imageData = req.body.image || {};  // allow plain URL object from JSON

    // If a file was uploaded, send it to Cloudinary
    if (req.file) {
      const uploaded = await uploadToCloudinary(req.file.buffer, {
        folder: 'autobacs/categories',
      });
      imageData = {
        url:       uploaded.secure_url,
        public_id: uploaded.public_id,
        alt:       (imageAlt || name || '').trim(),
      };
    }

    try {
      const category = await categoryRepository.create({
        name,
        slug,
        description,
        parent: parent || null,
        image: imageData,
        order,
        // isActive/isFeatured arrive as strings ("true"/"false") over multipart; coerce explicitly.
        ...(isActive !== undefined && { isActive: isActive === true || isActive === 'true' }),
        ...(isFeatured !== undefined && { isFeatured: isFeatured === true || isFeatured === 'true' }),
        seo: normalizeSeo(req.body.seo),
      });

      // 'products' also clears the facet/list caches — a new category can appear
      // as a filter facet and shifts the sidebar counts.
      invalidateCache('categories', 'products');
      // Refresh the storefront's Next.js Data Cache (home + nav) so a new
      // category shows up without waiting out the ISR window.
      revalidateFrontendTags(['home:categories', 'nav:categories']);
      // Drop the in-memory hierarchy cache so new categories aggregate immediately.
      categoryMappingService.refresh();

      return res.status(201).json({
        success: true,
        message: 'Category created successfully',
        category,
      });
    } catch (err) {
      if (err?.code === 11000) {
        // Avoid leaking an orphaned Cloudinary asset uploaded just above.
        if (req.file && imageData.public_id) {
          try { await deleteFromCloudinary(imageData.public_id); } catch { /* best-effort */ }
        }
        const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'value';
        return res.status(409).json({
          success: false,
          message: `Duplicate value: a category with this ${field} already exists.`,
        });
      }
      throw err;
    }
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
    delete updateData.imageAlt; // not a schema field; consumed only for image alt below

    // Normalize multipart string values (req.body fields arrive as strings).
    if (updateData.isActive !== undefined) {
      updateData.isActive = updateData.isActive === true || updateData.isActive === 'true';
    }
    if (updateData.isFeatured !== undefined) {
      updateData.isFeatured = updateData.isFeatured === true || updateData.isFeatured === 'true';
    }
    // Empty parent means "make this a top-level category".
    if (updateData.parent === '' || updateData.parent === 'null') {
      updateData.parent = null;
    }
    // SEO arrives as a JSON string over multipart — normalize to a clean subdoc
    // (or {} ) so Mongoose doesn't try to cast a raw string into the schema.
    if (updateData.seo !== undefined) {
      updateData.seo = normalizeSeo(updateData.seo);
    }

    // Parent existence + circular-hierarchy prevention.
    if (updateData.parent) {
      if (String(updateData.parent) === String(req.params.id)) {
        return res.status(400).json({ success: false, message: 'A category cannot be its own parent.' });
      }
      const proposedParent = await categoryRepository.findById(updateData.parent).select('parent').lean();
      if (!proposedParent) {
        return res.status(400).json({ success: false, message: 'Parent category not found.' });
      }
      // Enforce the 2-level taxonomy (hub -> leaf):
      // (a) the chosen parent must itself be top-level, and
      // (b) this category must not already have children (which would be pushed to depth 3).
      if (proposedParent.parent) {
        return res.status(400).json({
          success: false,
          message: 'Categories are limited to two levels (hub → subcategory). Pick a top-level category as the parent.',
        });
      }
      const hasChildren = await categoryRepository.countDocuments({ parent: req.params.id });
      if (hasChildren > 0) {
        return res.status(400).json({
          success: false,
          message: 'This category has subcategories, so it must stay top-level. Re-parent its subcategories first.',
        });
      }
      // Walk the ancestor chain from the proposed parent; if we reach this
      // category, the assignment would create a cycle. `visited` guards against
      // any pre-existing cycle in the data so the loop always terminates.
      let ancestorId = proposedParent.parent;
      const visited = new Set([String(updateData.parent)]);
      while (ancestorId) {
        const key = String(ancestorId);
        if (key === String(req.params.id)) {
          return res.status(400).json({
            success: false,
            message: 'Cannot set parent: this would create a circular category hierarchy.',
          });
        }
        if (visited.has(key)) break;
        visited.add(key);
        const ancestor = await categoryRepository.findById(ancestorId).select('parent').lean();
        if (!ancestor) break;
        ancestorId = ancestor.parent;
      }
    }

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
        alt:       (req.body.imageAlt || updateData.name || category.name || '').trim(),
      };
    }

    try {
      const updated = await categoryRepository.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true, runValidators: true }
      );

      // Parent/name/active changes alter the hierarchy AND the rolled-up facet
      // counts, so bust the product/facet caches too.
      invalidateCache('categories', 'products');
      revalidateFrontendTags(['home:categories', 'nav:categories', ...(updated?.slug ? [`category:${updated.slug}`] : [])]);
      // Parent/slug/name changes alter the hierarchy; refresh the lookup cache.
      categoryMappingService.refresh();

      return res.json({ success: true, message: 'Category updated successfully', category: updated });
    } catch (err) {
      if (err?.code === 11000) {
        if (req.file && updateData.image?.public_id) {
          try { await deleteFromCloudinary(updateData.image.public_id); } catch { /* best-effort */ }
        }
        const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'value';
        return res.status(409).json({
          success: false,
          message: `Duplicate value: a category with this ${field} already exists.`,
        });
      }
      throw err;
    }
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

  // Referential-integrity guard: refuse to orphan active subcategories or leave
  // products pointing at a (soft-)deleted category. Caller must reassign first.
  const [childCount, productCount] = await Promise.all([
    categoryRepository.countDocuments({ parent: req.params.id, isActive: true }),
    productRepository.count({ categories: req.params.id }),
  ]);

  if (childCount > 0 || productCount > 0) {
    return res.status(409).json({
      success: false,
      message: `Cannot delete "${category.name}": it has ${childCount} active subcategor${childCount === 1 ? 'y' : 'ies'} and ${productCount} linked product(s). Reassign or remove them first.`,
      details: { childCount, productCount },
    });
  }

  category.isActive = false;
  await category.save();

  // Soft-delete removes a facet and changes ancestor counts → bust products too.
  invalidateCache('categories', 'products');
  revalidateFrontendTags(['home:categories', 'nav:categories', `category:${category.slug}`]);
  // Soft-deleted category must drop out of hierarchy aggregation.
  categoryMappingService.refresh();

  res.json({
    success: true,
    message: 'Category deleted successfully'
  });
}));

// @route   PATCH /categories/:id/feature
// @desc    Toggle a category's homepage-featured flag (one-click from the admin list)
// @access  Private/Admin
router.patch("/:id/feature", protect, admin, validateIdParam, asyncHandler(async (req, res) => {
  const category = await categoryRepository.findById(req.params.id);
  if (!category) {
    return res.status(404).json({ success: false, message: 'Category not found' });
  }

  category.isFeatured = !category.isFeatured;
  await category.save();

  // Featured only affects presentation/ordering, not the hierarchy — no mapping refresh.
  invalidateCache('categories');
  revalidateFrontendTags(['home:categories', 'nav:categories']);

  res.json({
    success: true,
    message: `Category ${category.isFeatured ? 'featured' : 'unfeatured'} successfully`,
    isFeatured: category.isFeatured,
  });
}));

export default router;

/**
 * CareerCategory controller — admin CRUD for the managed section vocabulary
 * used to group roles on the /careers page.
 *
 * Postings reference a category by NAME string (not by id), so:
 *   - create/rename enforce case-insensitive uniqueness;
 *   - rename cascades the new name onto every posting that used the old one;
 *   - delete is blocked while any posting still references the category.
 *
 * Every write busts the public `careers` cache tag so the page regroups.
 * There is no public read endpoint: the section order is applied server-side in
 * jobPostingController.listOpenPostings, so the public page needs no extra call.
 */

import careerCategoryRepository from '../repositories/careerCategoryRepository.js';
import { slugify } from '../utils/slug.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';

const CACHE_TAG = 'careers';

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

// A category name may be all non-ASCII (e.g. "日本") or symbols ("!!!"), which
// slugify() collapses to ''. Fall back to a stable base so the required slug is
// never empty — uniqueSlug then de-dupes into category / category-2 / …
const slugBase = (name) => slugify(name) || 'category';

// @desc    List all categories in display order
// @route   GET /careers/admin/categories
// @access  Private/Admin
export const listCategories = async (_req, res) => {
  const categories = await careerCategoryRepository.findAllOrdered();
  res.json({ success: true, categories });
};

// @desc    Create a category
// @route   POST /careers/admin/categories
// @access  Private/Admin
export const createCategory = async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ success: false, message: 'Category name is required' });

  const existing = await careerCategoryRepository.findByName(name);
  if (existing) return res.status(409).json({ success: false, message: 'That category already exists' });

  const slug = await careerCategoryRepository.uniqueSlug(slugBase(name));
  const sortOrder = Number.isFinite(req.body?.sortOrder)
    ? req.body.sortOrder
    : (await careerCategoryRepository.maxSortOrder()) + 1;

  try {
    const category = await careerCategoryRepository.create({ name, slug, sortOrder });
    invalidateCache(CACHE_TAG);
    res.status(201).json({ success: true, category });
  } catch (err) {
    // Unique index (slug or case-insensitive name) is the real source of truth
    // under concurrent creates.
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: 'That category already exists' });
    }
    throw err;
  }
};

// @desc    Rename / reorder a category (rename cascades to postings)
// @route   PUT /careers/admin/categories/:id
// @access  Private/Admin
export const updateCategory = async (req, res) => {
  const category = await careerCategoryRepository.findById(req.params.id);
  if (!category) return res.status(404).json({ success: false, message: 'Category not found' });

  let renamedFrom = null;
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ success: false, message: 'Category name cannot be empty' });
    // Only churn the slug + cascade when the name actually changes (case-insensitively).
    if (name.toLowerCase() !== category.name.toLowerCase()) {
      const clash = await careerCategoryRepository.findByName(name, { excludeId: category._id });
      if (clash) return res.status(409).json({ success: false, message: 'Another category already has that name' });
      renamedFrom = category.name;
      category.slug = await careerCategoryRepository.uniqueSlug(slugBase(name), { excludeId: category._id });
    } else {
      // Same name, only casing changed — keep slug, still cascade the display casing.
      if (name !== category.name) renamedFrom = category.name;
    }
    category.name = name;
  }
  if (Number.isFinite(req.body?.sortOrder)) category.sortOrder = req.body.sortOrder;

  try {
    await category.save();
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: 'Another category already has that name' });
    }
    throw err;
  }

  // Cascade the rename onto every posting that still carried the old name.
  let postingsUpdated = 0;
  if (renamedFrom && renamedFrom !== category.name) {
    postingsUpdated = await careerCategoryRepository.renamePostingsCategory(renamedFrom, category.name);
  }

  invalidateCache(CACHE_TAG);
  res.json({ success: true, category, postingsUpdated });
};

// @desc    Persist a new category display order (drag-reorder)
// @route   PUT /careers/admin/categories/reorder
// @access  Private/Admin
export const reorderCategories = async (req, res) => {
  const raw = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : null;
  if (!raw) return res.status(400).json({ success: false, message: 'orderedIds must be an array' });

  // Ignore anything that isn't a well-formed id so a bad element can't throw a
  // CastError mid-bulkWrite; unknown ids simply match nothing.
  const orderedIds = raw.filter((id) => typeof id === 'string' && OBJECT_ID_RE.test(id));

  await careerCategoryRepository.bulkReorder(orderedIds);
  invalidateCache(CACHE_TAG);
  const categories = await careerCategoryRepository.findAllOrdered();
  res.json({ success: true, categories });
};

// @desc    Delete a category (blocked while any posting uses it)
// @route   DELETE /careers/admin/categories/:id
// @access  Private/Admin
export const deleteCategory = async (req, res) => {
  const category = await careerCategoryRepository.findById(req.params.id).lean();
  if (!category) return res.status(404).json({ success: false, message: 'Category not found' });

  const inUse = await careerCategoryRepository.countPostingsUsing(category.name);
  if (inUse > 0) {
    return res.status(409).json({
      success: false,
      message: `${inUse} role${inUse === 1 ? '' : 's'} still use this category. Reassign or remove them first.`,
      inUse,
    });
  }

  await careerCategoryRepository.findByIdAndDelete(category._id);
  invalidateCache(CACHE_TAG);
  res.json({ success: true, message: 'Category deleted' });
};

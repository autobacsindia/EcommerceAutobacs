/**
 * JobPosting controller — public read + admin CRUD for careers roles.
 *
 * Public:  the open-roles list that renders the /careers page and the single
 *          role lookup for its own page + Google Jobs JSON-LD.
 * Admin:   full CRUD so a role can be added/edited/withdrawn without a code
 *          change. `seo` is normalised on write (SEO contract), slugs are
 *          derived + de-duplicated, and every write busts the public cache tag.
 */

import jobPostingRepository from '../repositories/jobPostingRepository.js';
import { slugify } from '../utils/slug.js';
import { normalizeSeo } from '../utils/seo.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';

const CACHE_TAG = 'careers';

const STATUSES = ['draft', 'open', 'closed', 'filled'];
const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'INTERN', 'TEMPORARY'];

/** Coerce an incoming array-of-strings field: trim, drop blanks, cap length. */
const cleanBullets = (value, cap = 30) => {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, cap);
  return out;
};

// ── Public ──────────────────────────────────────────────────────────────────

// @desc    List open roles for the public careers page
// @route   GET /careers/postings
// @access  Public
export const listOpenPostings = async (_req, res) => {
  const postings = await jobPostingRepository.findOpen();
  res.json({ success: true, postings });
};

// @desc    Single open role (own page + JSON-LD)
// @route   GET /careers/postings/:slug
// @access  Public
export const getOpenPostingBySlug = async (req, res) => {
  const posting = await jobPostingRepository.findOpenBySlug(req.params.slug);
  if (!posting) return res.status(404).json({ success: false, message: 'Role not found' });
  res.json({ success: true, posting });
};

// ── Admin ───────────────────────────────────────────────────────────────────

// @desc    List all roles (any status) for management
// @route   GET /careers/admin/postings
// @access  Private/Admin
export const listAllPostings = async (req, res) => {
  const filter = {};
  if (typeof req.query.status === 'string' && req.query.status) {
    filter.status = req.query.status;
  }
  const postings = await jobPostingRepository.findAll(filter);
  res.json({ success: true, postings });
};

// @desc    Single role by id (admin editor hydrate)
// @route   GET /careers/admin/postings/:id
// @access  Private/Admin
export const getPostingById = async (req, res) => {
  const posting = await jobPostingRepository.findById(req.params.id).lean();
  if (!posting) return res.status(404).json({ success: false, message: 'Role not found' });
  res.json({ success: true, posting });
};

// @desc    Create a role
// @route   POST /careers/admin/postings
// @access  Private/Admin
export const createPosting = async (req, res) => {
  const b = req.body || {};
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  const department = typeof b.department === 'string' ? b.department.trim() : '';
  if (!title) return res.status(400).json({ success: false, message: 'Title is required' });
  if (!department) return res.status(400).json({ success: false, message: 'Department is required' });

  // Slug: honour an explicit one, else derive from title; de-dupe either way.
  const base = slugify(b.slug || title);
  const slug = await jobPostingRepository.uniqueSlug(base);

  const doc = {
    title,
    department,
    category: typeof b.category === 'string' ? b.category.trim() : '',
    slug,
    tagline: typeof b.tagline === 'string' ? b.tagline.trim() : '',
    experience: typeof b.experience === 'string' ? b.experience.trim() : '',
    intro: typeof b.intro === 'string' ? b.intro.trim() : '',
    responsibilities: cleanBullets(b.responsibilities) || [],
    requirements: cleanBullets(b.requirements) || [],
    closer: typeof b.closer === 'string' ? b.closer.trim() : '',
    location: typeof b.location === 'string' ? b.location.trim() : '',
    seo: normalizeSeo(b.seo),
    // New roles land at the end of the list unless a position is given.
    sortOrder: Number.isFinite(b.sortOrder) ? b.sortOrder : (await jobPostingRepository.maxSortOrder()) + 1,
  };
  if (STATUSES.includes(b.status)) doc.status = b.status;
  if (EMPLOYMENT_TYPES.includes(b.employmentType)) doc.employmentType = b.employmentType;

  try {
    const posting = await jobPostingRepository.create(doc);
    invalidateCache(CACHE_TAG);
    res.status(201).json({ success: true, posting });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: 'A role with that slug already exists' });
    }
    throw err;
  }
};

// @desc    Update a role
// @route   PUT /careers/admin/postings/:id
// @access  Private/Admin
export const updatePosting = async (req, res) => {
  const b = req.body || {};
  const posting = await jobPostingRepository.findById(req.params.id);
  if (!posting) return res.status(404).json({ success: false, message: 'Role not found' });

  if (b.title !== undefined) {
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!title) return res.status(400).json({ success: false, message: 'Title cannot be empty' });
    posting.title = title;
  }
  if (b.department !== undefined) {
    const department = typeof b.department === 'string' ? b.department.trim() : '';
    if (!department) return res.status(400).json({ success: false, message: 'Department cannot be empty' });
    posting.department = department;
  }
  // Slug is only recomputed when the admin explicitly edits it — an existing
  // slug is a stable URL and must not churn on unrelated edits.
  if (b.slug !== undefined) {
    const base = slugify(b.slug);
    if (!base) return res.status(400).json({ success: false, message: 'Slug cannot be empty' });
    posting.slug = await jobPostingRepository.uniqueSlug(base, { excludeId: posting._id });
  }
  if (b.category !== undefined) posting.category = String(b.category).trim();
  if (b.tagline !== undefined) posting.tagline = String(b.tagline).trim();
  if (b.experience !== undefined) posting.experience = String(b.experience).trim();
  if (b.intro !== undefined) posting.intro = String(b.intro).trim();
  if (b.closer !== undefined) posting.closer = String(b.closer).trim();
  if (b.location !== undefined) posting.location = String(b.location).trim();
  if (b.responsibilities !== undefined) posting.responsibilities = cleanBullets(b.responsibilities) || [];
  if (b.requirements !== undefined) posting.requirements = cleanBullets(b.requirements) || [];
  if (b.seo !== undefined) posting.seo = normalizeSeo(b.seo);
  if (Number.isFinite(b.sortOrder)) posting.sortOrder = b.sortOrder;
  if (STATUSES.includes(b.status)) posting.status = b.status;
  if (EMPLOYMENT_TYPES.includes(b.employmentType)) posting.employmentType = b.employmentType;

  try {
    await posting.save();
    invalidateCache(CACHE_TAG);
    res.json({ success: true, posting });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, message: 'A role with that slug already exists' });
    }
    throw err;
  }
};

// @desc    Delete a role
// @route   DELETE /careers/admin/postings/:id
// @access  Private/Admin
export const deletePosting = async (req, res) => {
  const posting = await jobPostingRepository.findByIdAndDelete(req.params.id);
  if (!posting) return res.status(404).json({ success: false, message: 'Role not found' });
  invalidateCache(CACHE_TAG);
  res.json({ success: true, message: 'Role deleted' });
};

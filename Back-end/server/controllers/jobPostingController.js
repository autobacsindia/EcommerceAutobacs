/**
 * JobPosting controller — public read + admin CRUD for careers roles.
 *
 * Public:  the open-roles list that renders the /careers page and the single
 *          role lookup for its own page + Google Jobs JSON-LD.
 * Admin:   full CRUD so a role can be added/edited/withdrawn without a code
 *          change. `seo` is normalised on write (SEO contract), slugs are
 *          derived + de-duplicated, and every write busts the public cache tag.
 */

import jobPostingRepository, { FIELD_CAPS } from '../repositories/jobPostingRepository.js';
import careerCategoryRepository from '../repositories/careerCategoryRepository.js';
import { slugify } from '../utils/slug.js';
import { normalizeSeo } from '../utils/seo.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { revalidateFrontendTags } from '../services/frontendRevalidator.js';
import { careersTags } from '../utils/nextTags.js';

const CACHE_TAG = 'careers';

const STATUSES = ['draft', 'open', 'closed', 'filled'];
const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'INTERN', 'TEMPORARY'];

// Field name -> the label the admin actually sees on the form, so a rejection
// points at the box to fix rather than at a schema path.
const FIELD_LABELS = {
  title: 'Title',
  department: 'Department',
  category: 'Category',
  tagline: 'Tagline',
  experience: 'Experience',
  intro: 'Intro',
  closer: 'Closer',
  location: 'Location',
  responsibilities: "What you'll own",
  requirements: 'What we need',
};

/**
 * First field that breaches its schema cap, as an operator-readable sentence —
 * or null when everything fits.
 *
 * Without this the save reaches Mongoose, whose ValidationError is whitelisted
 * by errorMiddleware down to the bare string "Validation Error": the admin sees
 * a red box naming no field and has nothing to act on. Caps come from
 * FIELD_CAPS (read off the schema), so this can never disagree with the model.
 *
 * Bullets get a per-line message because that is the real failure mode: a whole
 * paragraph pasted into the one-bullet-per-line box arrives as a single
 * over-long entry, and "line 1 is 653 characters" is the only feedback that
 * makes the fix obvious.
 */
const capBreach = (doc) => {
  for (const [field, cap] of Object.entries(FIELD_CAPS)) {
    const value = doc[field];
    const label = FIELD_LABELS[field] || field;

    if (typeof value === 'string') {
      if (value.length > cap) {
        return `${label} is ${value.length} characters — the maximum is ${cap}.`;
      }
    } else if (Array.isArray(value)) {
      const i = value.findIndex((v) => typeof v === 'string' && v.length > cap);
      if (i !== -1) {
        return (
          `${label}: line ${i + 1} is ${value[i].length} characters — the maximum is ${cap} ` +
          'per bullet. Put each bullet on its own line rather than one paragraph.'
        );
      }
    }
  }
  return null;
};

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
  // findOpen() already returns roles by their own sortOrder. Re-sort so sections
  // render in the admin-managed CATEGORY order: a category's position on the page
  // is driven by its CareerCategory.sortOrder, and roles keep their relative
  // order within each section. Uncategorised roles (and any category with no
  // managed entry) sort last. The regroup itself happens on the frontend.
  const postings = await jobPostingRepository.findOpen();

  // Skip the (small) category lookup entirely when nothing is categorised —
  // the common case — so the public path keeps its single query. Otherwise load
  // the managed order to drive section ordering.
  if (!postings.some((p) => (p.category || '').trim())) {
    return res.json({ success: true, postings });
  }
  const categories = await careerCategoryRepository.findAllOrdered();

  const LAST = Number.MAX_SAFE_INTEGER;
  const order = new Map(categories.map((c, i) => [c.name.toLowerCase(), i]));
  const rank = (p) => {
    const key = (p.category || '').trim().toLowerCase();
    return key ? order.get(key) ?? LAST : LAST;
  };
  // Stable sort: Array.prototype.sort is stable, so equal ranks preserve the
  // sortOrder,createdAt ordering findOpen() already applied.
  const sorted = postings
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
    .map((x) => x.p);

  res.json({ success: true, postings: sorted });
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
  // Ship the caps with the list so the editor's maxLength/counters come from the
  // schema instead of a second hand-copied literal that can drift out of sync
  // (the failure mode that made these errors unreadable in the first place).
  res.json({ success: true, postings, fieldCaps: FIELD_CAPS });
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
  if (!base) {
    // slugify strips everything non-alphanumeric, so a title of only symbols or
    // non-Latin script yields ''. `slug` is required, so letting that through
    // costs another opaque ValidationError.
    return res.status(400).json({
      success: false,
      message: 'Could not build a URL slug from that title — enter a slug manually.',
    });
  }
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

  const breach = capBreach(doc);
  if (breach) return res.status(400).json({ success: false, message: breach });

  try {
    const posting = await jobPostingRepository.create(doc);
    invalidateCache(CACHE_TAG);
    revalidateFrontendTags(careersTags());
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

  // Checked after every assignment but before save(), so an untouched field that
  // is already over cap is reported too — it would block the save either way.
  const breach = capBreach(posting);
  if (breach) return res.status(400).json({ success: false, message: breach });

  try {
    await posting.save();
    invalidateCache(CACHE_TAG);
    revalidateFrontendTags(careersTags());
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
  revalidateFrontendTags(careersTags());
  res.json({ success: true, message: 'Role deleted' });
};

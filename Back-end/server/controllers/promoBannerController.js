/**
 * PromoBanner controller — public read + admin CRUD for the site-wide occasion strip.
 *
 * Public:  the single live banner, shared-cacheable (nothing per-user here).
 * Admin:   full CRUD so marketing can swap Onam for Diwali without a deploy.
 *
 * Every write does three things together, and they must stay together: persist,
 * purge Redis, and revalidate the Next.js Data Cache tag. Skipping either cache
 * step leaves a finished campaign advertising itself at the edge for the rest of
 * the TTL, which is exactly the staleness class this repo keeps getting bitten by.
 */

import promoBannerRepository from '../repositories/promoBannerRepository.js';
import { resolveActiveBanner, PROMO_BANNER_CACHE_TAG } from '../services/promoBannerService.js';
import { normalizePromoLinkPath } from '../utils/promoLinkPath.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { revalidateFrontendTags } from '../services/frontendRevalidator.js';
import { promoBannerTags } from '../utils/nextTags.js';
import { deleteManyFromCloudinary } from '../utils/cloudinaryHelpers.js';
import AppError from '../utils/AppError.js';

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;

/**
 * Purge every layer that can hold a banner. Called after ALL writes, including
 * deletes and toggles — an "off" that only reaches Mongo is not off.
 *
 * Deliberately not awaited by the caller's response: invalidateCache is
 * fire-and-forget by design and revalidateFrontendTags never throws, so a slow
 * or down frontend cannot make an admin's save appear to fail. The write is
 * already durable by this point.
 */
const purgeBannerCaches = () => {
  invalidateCache(PROMO_BANNER_CACHE_TAG);
  revalidateFrontendTags(promoBannerTags());
};

/** Only fields an admin may set. Anything else in the body is ignored. */
const pickWritableFields = (body, { partial = false } = {}) => {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (has('title')) out.title = String(body.title).trim();
  if (has('alt')) out.alt = String(body.alt).trim();
  if (has('imageUrl')) out.imageUrl = String(body.imageUrl).trim();
  if (has('imagePublicId')) out.imagePublicId = body.imagePublicId ? String(body.imagePublicId).trim() : null;
  if (has('imageWidth')) out.imageWidth = Number(body.imageWidth) || null;
  if (has('imageHeight')) out.imageHeight = Number(body.imageHeight) || null;
  // Re-normalised here and not only in the validator, so a non-HTTP caller
  // (seed script, future admin tool) cannot store an unsafe href either.
  if (has('linkPath')) out.linkPath = normalizePromoLinkPath(body.linkPath);
  if (has('isActive')) out.isActive = Boolean(body.isActive);
  if (has('priority')) out.priority = Number(body.priority) || 0;
  if (has('startsAt')) out.startsAt = body.startsAt ? new Date(body.startsAt) : null;
  if (has('endsAt')) out.endsAt = body.endsAt ? new Date(body.endsAt) : null;

  if (!partial) {
    if (!out.linkPath) out.linkPath = normalizePromoLinkPath(null);
    if (out.isActive === undefined) out.isActive = false;
  }
  return out;
};

/**
 * Reject a window that can never open. Cheap to check, and a banner silently
 * never appearing is a support ticket nobody can diagnose from the admin screen.
 */
const assertValidWindow = ({ startsAt, endsAt }) => {
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    throw new AppError('The end date must be after the start date', 400);
  }
};

// ── Public ──────────────────────────────────────────────────────────────────

// @desc    The banner to render right now (null when no campaign is scheduled)
// @route   GET /promo-banners/active
// @access  Public
export const getActiveBanner = async (_req, res) => {
  const banner = await resolveActiveBanner();
  res.json({ success: true, banner });
};

// ── Admin ───────────────────────────────────────────────────────────────────

// @desc    List banners, newest first (cursor-paginated)
// @route   GET /promo-banners/admin
// @access  Private/Admin
export const listBanners = async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const before = req.query.before ? new Date(req.query.before) : null;

  // Fetch one extra to learn whether another page exists without a count query.
  const rows = await promoBannerRepository.findPage({ limit: limit + 1, before });
  const hasMore = rows.length > limit;
  const banners = hasMore ? rows.slice(0, limit) : rows;

  res.json({
    success: true,
    banners,
    // Keyset cursor: the createdAt of the last row returned.
    nextCursor: hasMore ? banners[banners.length - 1].createdAt : null,
  });
};

// @desc    Create a banner (inactive unless explicitly activated)
// @route   POST /promo-banners/admin
// @access  Private/Admin
export const createBanner = async (req, res) => {
  const data = pickWritableFields(req.body, { partial: false });
  assertValidWindow(data);

  const banner = await promoBannerRepository.create({
    ...data,
    createdBy: req.user?._id || null,
    updatedBy: req.user?._id || null,
  });

  // A banner created inactive changes nothing on the storefront, but purging
  // unconditionally keeps one rule instead of a conditional nobody maintains.
  purgeBannerCaches();
  res.status(201).json({ success: true, banner });
};

// @desc    Update a banner
// @route   PUT /promo-banners/admin/:id
// @access  Private/Admin
export const updateBanner = async (req, res) => {
  const existing = await promoBannerRepository.findById(req.params.id);
  if (!existing) throw new AppError('Banner not found', 404);

  const data = pickWritableFields(req.body, { partial: true });
  assertValidWindow({
    startsAt: 'startsAt' in data ? data.startsAt : existing.startsAt,
    endsAt: 'endsAt' in data ? data.endsAt : existing.endsAt,
  });

  const banner = await promoBannerRepository.update(req.params.id, data, { runValidators: true });

  /**
   * Delete the Cloudinary assets this edit orphaned — but only after the write
   * succeeded, and only for ids that are genuinely no longer referenced.
   *
   * Derived from what actually persisted rather than from the request: the
   * product gallery deleted assets optimistically from the incoming payload and
   * left Mongo pointing at images that no longer existed. Compare stored-before
   * against stored-after and act on the difference.
   */
  const orphans = [[existing.imagePublicId, banner.imagePublicId]]
    .filter(([before, after]) => before && before !== after)
    .map(([before]) => before);
  if (orphans.length) await deleteManyFromCloudinary(orphans);

  purgeBannerCaches();
  res.json({ success: true, banner });
};

// @desc    Turn a banner on or off
// @route   PATCH /promo-banners/admin/:id/toggle
// @access  Private/Admin
export const toggleBanner = async (req, res) => {
  const banner = await promoBannerRepository.update(
    req.params.id,
    { isActive: Boolean(req.body.isActive), updatedBy: req.user?._id || null },
    { runValidators: true },
  );
  if (!banner) throw new AppError('Banner not found', 404);

  purgeBannerCaches();
  res.json({ success: true, banner });
};

// @desc    Delete a banner and its artwork
// @route   DELETE /promo-banners/admin/:id
// @access  Private/Admin
export const deleteBanner = async (req, res) => {
  const banner = await promoBannerRepository.delete(req.params.id);
  if (!banner) throw new AppError('Banner not found', 404);

  // Only after the document is gone — an asset deleted ahead of a failed delete
  // would leave a live banner pointing at a 404 image.
  await deleteManyFromCloudinary([banner.imagePublicId].filter(Boolean));

  purgeBannerCaches();
  res.json({ success: true, message: 'Banner deleted' });
};

export default {
  getActiveBanner,
  listBanners,
  createBanner,
  updateBanner,
  toggleBanner,
  deleteBanner,
};

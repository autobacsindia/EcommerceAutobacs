/**
 * Festival theme — public read + admin switch.
 *
 * Every write purges all three layers in one place (Redis, Cloudflare via
 * invalidateCache's CDN step, and the Next.js Data Cache tag). An "off" that
 * only reached Mongo would keep fireworks going for the rest of the TTL.
 */

import {
  resolvePublicFestivalTheme,
  getFestivalThemeConfig,
  updateFestivalThemeConfig,
  isFestivalThemeLive,
  FESTIVAL_THEME_CACHE_TAG,
} from '../services/festivalThemeService.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { revalidateFrontendTags } from '../services/frontendRevalidator.js';
import { festivalThemeTags } from '../utils/nextTags.js';
import AppError from '../utils/AppError.js';

const purgeFestivalThemeCaches = () => {
  invalidateCache(FESTIVAL_THEME_CACHE_TAG);
  revalidateFrontendTags(festivalThemeTags());
};

const adminShape = (doc, now = new Date()) => ({
  enabled: Boolean(doc.enabled),
  themeKey: doc.themeKey,
  startsAt: doc.startsAt ? new Date(doc.startsAt).toISOString() : null,
  endsAt: doc.endsAt ? new Date(doc.endsAt).toISOString() : null,
  live: isFestivalThemeLive(doc, now),
  updatedAt: doc.updatedAt || null,
});

// @route GET /festival-theme/active  (public, shared cache)
export const getActiveFestivalTheme = async (_req, res) => {
  const theme = await resolvePublicFestivalTheme();
  res.json({ success: true, theme });
};

// @route GET /festival-theme/admin  (admin/marketing)
export const getFestivalThemeAdmin = async (_req, res) => {
  const doc = await getFestivalThemeConfig();
  res.json({ success: true, theme: adminShape(doc) });
};

// @route PUT /festival-theme/admin  (admin/marketing)
export const updateFestivalThemeAdmin = async (req, res) => {
  const has = (k) => Object.prototype.hasOwnProperty.call(req.body, k);
  const set = { enabled: Boolean(req.body.enabled), updatedBy: req.user?._id || null };
  if (has('themeKey')) set.themeKey = req.body.themeKey;
  if (has('startsAt')) set.startsAt = req.body.startsAt ? new Date(req.body.startsAt) : null;
  if (has('endsAt')) set.endsAt = req.body.endsAt ? new Date(req.body.endsAt) : null;

  const current = await getFestivalThemeConfig();
  const startsAt = has('startsAt') ? set.startsAt : current.startsAt;
  const endsAt = has('endsAt') ? set.endsAt : current.endsAt;
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    throw new AppError('The end date must be after the start date', 400);
  }

  const doc = await updateFestivalThemeConfig(set);
  purgeFestivalThemeCaches();
  res.json({ success: true, theme: adminShape(doc) });
};

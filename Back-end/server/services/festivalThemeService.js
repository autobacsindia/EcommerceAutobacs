/**
 * Festival theme resolution — the one place that decides whether the festive
 * decoration is on.
 *
 * The public answer is cached (Redis, 60s) and shared by every visitor. It
 * carries the window itself, not just a yes/no, so the storefront can also
 * switch itself off at `endsAt` on the visitor's clock — a cached "on" from
 * 59 seconds ago, or an edge copy, can never keep Diwali running past the end
 * date. No deploy, no cron.
 */

import festivalThemeRepository from '../repositories/festivalThemeRepository.js';
import cacheService, { CACHE_VERSION } from './cacheService.js';

export const FESTIVAL_THEME_CACHE_TAG = 'public:festival-theme';
const CACHE_KEY = `${CACHE_VERSION}:${FESTIVAL_THEME_CACHE_TAG}`;
const CACHE_TTL_SECONDS = 60;

const toIso = (d) => (d ? new Date(d).toISOString() : null);

/**
 * Pure: is this config live at `now`? Start inclusive, end exclusive — the same
 * rule as promo banners, so "ends 23:59" means it is gone at 23:59.
 */
export function isFestivalThemeLive(cfg, now = new Date()) {
  if (!cfg || !cfg.enabled) return false;
  const t = now.getTime();
  if (cfg.startsAt && new Date(cfg.startsAt).getTime() > t) return false;
  if (cfg.endsAt && new Date(cfg.endsAt).getTime() <= t) return false;
  return true;
}

/**
 * Pure: what the storefront receives, or null.
 *
 * A theme that is switched on but has not STARTED yet is still returned (with
 * `live: false`) so a page cached before the start can turn itself on at the
 * start time. Off, or already ended, is null — there is nothing to wait for.
 */
export function toPublicTheme(cfg, now = new Date()) {
  if (!cfg || !cfg.enabled) return null;
  if (cfg.endsAt && new Date(cfg.endsAt).getTime() <= now.getTime()) return null;
  return {
    themeKey: cfg.themeKey,
    startsAt: toIso(cfg.startsAt),
    endsAt: toIso(cfg.endsAt),
    live: isFestivalThemeLive(cfg, now),
  };
}

/**
 * Cached public read. Stores `{ theme }` rather than a bare null because
 * cacheService.wrap() treats a falsy hit as a miss — "no festival" (most of the
 * year) must be the cheap case, not a Mongo read per page view.
 */
export async function resolvePublicFestivalTheme() {
  const { theme } = await cacheService.wrap(
    CACHE_KEY,
    async () => ({ theme: toPublicTheme(await festivalThemeRepository.getSingleton(), new Date()) }),
    { ttl: CACHE_TTL_SECONDS, tags: [FESTIVAL_THEME_CACHE_TAG] },
  );
  return theme;
}

/** Uncached admin read — an admin who just saved must see their own edit. */
export async function getFestivalThemeConfig() {
  return festivalThemeRepository.getSingleton();
}

export async function updateFestivalThemeConfig(set) {
  return festivalThemeRepository.update(set);
}

export default {
  isFestivalThemeLive,
  toPublicTheme,
  resolvePublicFestivalTheme,
  getFestivalThemeConfig,
  updateFestivalThemeConfig,
  FESTIVAL_THEME_CACHE_TAG,
};

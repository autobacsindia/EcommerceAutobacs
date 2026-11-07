/**
 * Festival (Diwali) price offer — public read + admin switch.
 *
 * Every write purges all three display layers in one place (Redis, Cloudflare via
 * invalidateCache's CDN step, and the Next.js Data Cache tag). Pricing does not depend
 * on any of them: pricingService reads the switch from Mongo uncached, so "off" stops
 * the discount being charged on the very next quote even if a purge is still in flight.
 */

import {
  resolvePublicFestivalOffer,
  getFestivalOfferConfig,
  updateFestivalOfferConfig,
  isFestivalOfferLive,
  FESTIVAL_OFFER_CACHE_TAG,
} from '../services/festivalOfferService.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { revalidateFrontendTags } from '../services/frontendRevalidator.js';
import { festivalOfferTags } from '../utils/nextTags.js';
import auditLogger from '../services/auditLogger.js';
import { FESTIVAL_OFFER_TIERS } from '../utils/festivalOffer.js';
import AppError from '../utils/AppError.js';

const purgeFestivalOfferCaches = () => {
  invalidateCache(FESTIVAL_OFFER_CACHE_TAG);
  revalidateFrontendTags(festivalOfferTags());
};

const adminShape = (doc, now = new Date()) => ({
  enabled: Boolean(doc.enabled),
  startsAt: doc.startsAt ? new Date(doc.startsAt).toISOString() : null,
  endsAt: doc.endsAt ? new Date(doc.endsAt).toISOString() : null,
  live: isFestivalOfferLive(doc, now),
  tiers: FESTIVAL_OFFER_TIERS.map((t) => ({ minPaise: t.minPaise, percent: t.percent })),
  updatedAt: doc.updatedAt || null,
});

// @route GET /festival-offer/active  (public, shared cache)
export const getActiveFestivalOffer = async (_req, res) => {
  const offer = await resolvePublicFestivalOffer();
  res.json({ success: true, offer });
};

// @route GET /festival-offer/admin  (admin/marketing)
export const getFestivalOfferAdmin = async (_req, res) => {
  const doc = await getFestivalOfferConfig();
  res.json({ success: true, offer: adminShape(doc) });
};

// @route PUT /festival-offer/admin  (admin/marketing)
export const updateFestivalOfferAdmin = async (req, res) => {
  const has = (k) => Object.prototype.hasOwnProperty.call(req.body, k);
  const set = { enabled: Boolean(req.body.enabled), updatedBy: req.user?._id || null };
  if (has('startsAt')) set.startsAt = req.body.startsAt ? new Date(req.body.startsAt) : null;
  if (has('endsAt')) set.endsAt = req.body.endsAt ? new Date(req.body.endsAt) : null;

  const current = await getFestivalOfferConfig();
  const startsAt = has('startsAt') ? set.startsAt : current.startsAt;
  const endsAt = has('endsAt') ? set.endsAt : current.endsAt;
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    throw new AppError('The end date must be after the start date', 400);
  }

  const doc = await updateFestivalOfferConfig(set);
  purgeFestivalOfferCaches();
  // A switch that changes what every customer is charged is an audited money action.
  await auditLogger.logAction(req, 'FESTIVAL_OFFER_UPDATE', 'FestivalOffer', doc._id, {
    enabled: doc.enabled,
    startsAt: doc.startsAt || null,
    endsAt: doc.endsAt || null,
  });
  res.json({ success: true, offer: adminShape(doc) });
};

/**
 * Spin-to-Win HTTP layer.
 *
 * Thin by design: every decision (eligibility, the draw, the publish gate) lives in
 * services/spinService.js. This file's own jobs are authorisation, shaping the response,
 * purging cache on admin writes, and audit logging.
 */

import mongoose from 'mongoose';

import AppError from '../utils/AppError.js';
import auditLogger from '../services/auditLogger.js';
import cacheService from '../services/cacheService.js';
import spinService, { INELIGIBLE } from '../services/spinService.js';
import spinCampaignRepository from '../repositories/spinCampaignRepository.js';
import spinPrizeRepository from '../repositories/spinPrizeRepository.js';
import spinResultRepository from '../repositories/spinResultRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import { SPIN_STATUS } from '../config/spin.js';

const CACHE_PATTERN = 'public:spin:*';

/**
 * Purge the cached campaign/prize view after any admin write.
 *
 * TTL alone is not acceptable: an operator hitting the kill switch expects the wheel to
 * stop NOW, and a stale prize list would keep offering a goodie that was just retired.
 */
const purgeSpinCache = async () => {
  try {
    await cacheService.invalidatePattern(CACHE_PATTERN);
  } catch (err) {
    console.error('[Spin] cache purge failed:', err?.message);
  }
};

/**
 * The order must belong to the caller (or the caller must be an admin).
 *
 * Without this, order ids are enumerable and anyone could spin — and consume the stock
 * of — someone else's order.
 */
const assertOwnsOrder = async (orderId, req) => {
  if (!mongoose.isValidObjectId(orderId)) throw new AppError('Order not found.', 404);
  const order = await orderRepository.findOwnerRef(orderId);
  if (!order) throw new AppError('Order not found.', 404);
  if (req.user?.role === 'admin') return order;
  if (!order.user || String(order.user) !== String(req.user?._id)) {
    // 404 rather than 403 — a 403 confirms the order exists to someone who should not
    // know that.
    throw new AppError('Order not found.', 404);
  }
  return order;
};

const publicPrize = (p) => ({
  id: p._id,
  name: p.name,
  shortLabel: p.shortLabel || p.name,
  imageUrl: p.imageUrl || null,
  kind: p.kind,
  isFloorPrize: Boolean(p.isFloorPrize),
});

// ───────────────────────────────────────────────────────────────────────────────
// Customer
// ───────────────────────────────────────────────────────────────────────────────

/**
 * GET /spin/orders/:orderId — is a spin on offer, and what does the wheel look like?
 *
 * Safe to poll: the storefront calls this while waiting for the payment webhook to land.
 * It returns a PREVIEW set of slice labels and deliberately never computes or reveals an
 * outcome — the outcome only exists after POST.
 */
export const getSpinStatus = async (req, res) => {
  const { orderId } = req.params;
  await assertOwnsOrder(orderId, req);

  const check = await spinService.checkEligibility(orderId, { userId: req.user?._id });

  if (check.alreadySpun) {
    const r = check.result;
    return res.json({
      success: true,
      eligible: false,
      alreadySpun: true,
      result: {
        prize: r.prizeSnapshot,
        segmentIndex: r.segmentIndex,
        segmentLabels: r.segmentLabels,
        status: r.status,
        spunAt: r.spunAt,
      },
      reviewCta: null,
    });
  }

  if (!check.eligible) {
    return res.json({
      success: true,
      eligible: false,
      alreadySpun: false,
      // The storefront distinguishes "payment still confirming" (keep polling) from a
      // terminal no.
      reason: check.reason,
      pending: check.reason === INELIGIBLE.NOT_PAID,
    });
  }

  const { campaign, floorPrize, orderValuePaise } = check;
  const pool = await spinPrizeRepository.findEligiblePool(campaign._id, orderValuePaise);
  const preview = spinService.buildSegments({
    pool,
    floorPrize,
    winner: null,
    segmentCount: campaign.segmentCount,
  });

  return res.json({
    success: true,
    eligible: true,
    alreadySpun: false,
    campaign: {
      slug: campaign.slug,
      name: campaign.name,
      segmentCount: campaign.segmentCount,
      terms: campaign.terms || null,
    },
    // Preview only — the authoritative slice set comes back from POST alongside the
    // outcome, and the client re-renders labels before the wheel decelerates.
    segments: preview.slices.map(publicPrize),
  });
};

/**
 * POST /spin/orders/:orderId — the spin.
 *
 * Idempotent: a refresh, a double-click or two tabs all yield the same prize. The
 * service returns `alreadySpun` for a repeat, and this still answers 200 with the
 * result, because from the customer's point of view nothing went wrong.
 */
export const postSpin = async (req, res) => {
  const { orderId } = req.params;
  await assertOwnsOrder(orderId, req);

  const { result, alreadySpun } = await spinService.spin(orderId, {
    userId: req.user?._id,
    // Behind Cloudflare, req.ip is the edge. cf-connecting-ip is the real client.
    ip: req.headers['cf-connecting-ip'] || req.ip,
  });

  const campaign = await spinCampaignRepository.findById(result.campaign);

  return res.json({
    success: true,
    alreadySpun,
    result: {
      prize: result.prizeSnapshot,
      segmentIndex: result.segmentIndex,
      segmentLabels: result.segmentLabels,
      status: result.status,
      spunAt: result.spunAt,
    },
    // Shown AFTER the prize is already granted and persisted. Dismissing it changes
    // nothing about what was won — see SpinCampaign.reviewCta for why that matters.
    reviewCta: campaign?.reviewCta?.enabled
      ? {
        headline: campaign.reviewCta.headline,
        body: campaign.reviewCta.body,
        url: campaign.reviewCta.url,
      }
      : null,
  });
};

/** POST /spin/orders/:orderId/review-clicked — analytics only. Never gates anything. */
export const postReviewClicked = async (req, res) => {
  const { orderId } = req.params;
  await assertOwnsOrder(orderId, req);
  await spinResultRepository.markReviewClicked(orderId);
  return res.json({ success: true });
};

// ───────────────────────────────────────────────────────────────────────────────
// Admin — campaigns
// ───────────────────────────────────────────────────────────────────────────────

export const listCampaigns = async (req, res) => {
  const { limit = 50, before = null } = req.query;
  const campaigns = await spinCampaignRepository.findPage({
    limit: Math.min(Number(limit) || 50, 100),
    before: before ? new Date(before) : null,
  });
  const nextCursor = campaigns.length ? campaigns[campaigns.length - 1].createdAt : null;
  return res.json({ success: true, campaigns, nextCursor });
};

export const createCampaign = async (req, res) => {
  // A campaign is always born in `draft`. Going live is a separate, gated action, so a
  // malformed create can never immediately start offering prizes.
  const campaign = await spinCampaignRepository.createCampaign({ ...req.body, status: SPIN_STATUS.DRAFT });
  await purgeSpinCache();
  await auditLogger.logAction(req, 'SPIN_CAMPAIGN_CREATE', 'SpinCampaign', campaign._id, { slug: campaign.slug });
  return res.status(201).json({ success: true, campaign });
};

export const updateCampaign = async (req, res) => {
  // `status` is stripped deliberately: it moves only through publish/setStatus, which
  // run the safety gate. Underscore-prefixed so the linter knows the discard is intent.
  const { status: _status, ...patch } = req.body;
  const campaign = await spinCampaignRepository.updateById(req.params.id, patch);
  if (!campaign) throw new AppError('Campaign not found.', 404);
  await purgeSpinCache();
  await auditLogger.logAction(req, 'SPIN_CAMPAIGN_UPDATE', 'SpinCampaign', campaign._id, { fields: Object.keys(patch) });
  return res.json({ success: true, campaign });
};

/**
 * POST /spin/admin/campaigns/:id/publish — draft → live, behind the gate.
 *
 * Returns 422 with NAMED FIELD ERRORS when the configuration cannot honour the
 * promise the wheel makes. A bare "Validation Error" here would be unfixable from the
 * admin UI, which is exactly how a product once became un-saveable in this codebase.
 */
export const publishCampaign = async (req, res) => {
  const errors = await spinService.validateForPublish(req.params.id);
  if (errors.length > 0) {
    return res.status(422).json({
      success: false,
      message: 'This campaign cannot go live yet.',
      errors,
    });
  }
  const campaign = await spinCampaignRepository.setStatus(req.params.id, SPIN_STATUS.LIVE);
  await purgeSpinCache();
  await auditLogger.logAction(req, 'SPIN_CAMPAIGN_PUBLISH', 'SpinCampaign', campaign._id, { slug: campaign.slug });
  return res.json({ success: true, campaign });
};

/** PATCH /spin/admin/campaigns/:id/status — the kill switch (and un-publish). */
export const setCampaignStatus = async (req, res) => {
  const { status } = req.body;
  if (status === SPIN_STATUS.LIVE) {
    throw new AppError('Use the publish endpoint to go live — it runs the safety checks.', 400, { expose: true });
  }
  const campaign = await spinCampaignRepository.setStatus(req.params.id, status);
  if (!campaign) throw new AppError('Campaign not found.', 404);
  await purgeSpinCache();
  await auditLogger.logAction(req, 'SPIN_CAMPAIGN_STATUS', 'SpinCampaign', campaign._id, { status });
  return res.json({ success: true, campaign });
};

/**
 * POST /spin/admin/campaigns/:id/clone — open a NEW window from an existing campaign.
 *
 * This exists to make one specific operational mistake impossible. The per-user cap
 * counts spins scoped to a campaign `_id`, so re-running a promotion by editing
 * startsAt/endsAt on the original row does NOT reset anybody — every customer who
 * already spun stays permanently locked out, and the wheel just quietly stops appearing
 * for your most frequent buyers. There is no error to notice; it looks like the feature
 * is broken.
 *
 * Cloning produces a fresh campaign id, so the cap starts empty and last window's
 * winners can play again.
 *
 * The clone lands in `draft` and its prizes come back FULLY RESTOCKED with awarded
 * counts and daily-cap accounting cleared — a new window starts from the shelf you
 * actually have, not from last window's leftovers. Adjust the stock numbers to reality,
 * then publish (which re-runs the safety gate).
 */
export const cloneCampaign = async (req, res) => {
  const source = await spinCampaignRepository.findLeanById(req.params.id);
  if (!source) throw new AppError('Campaign not found.', 404);

  // Identity + timestamps must NOT carry over; underscore marks the discard as intent.
  const { _id, createdAt: _c, updatedAt: _u, __v: _v, slug: _slug, ...rest } = source;

  const clone = await spinCampaignRepository.createCampaign({
    ...rest,
    slug: req.body.slug,
    name: req.body.name || `${source.name} (copy)`,
    status: SPIN_STATUS.DRAFT,
    startsAt: req.body.startsAt || source.startsAt,
    endsAt: req.body.endsAt || source.endsAt,
  });

  const prizes = await spinPrizeRepository.findByCampaign(source._id);
  if (prizes.length > 0) {
    await spinPrizeRepository.createMany(prizes.map((p) => {
      const { _id: _pid, createdAt: _pc, updatedAt: _pu, __v: _pv, ...prize } = p;
      return {
        ...prize,
        campaign: clone._id,
        // Fresh window = fresh shelf. Carrying stockAwarded or a stale capDate over
        // would let last window's daily cap suppress this one's first day.
        stockRemaining: prize.stockTotal,
        stockAwarded: 0,
        capDate: null,
        capCount: 0,
      };
    }));
  }

  await purgeSpinCache();
  await auditLogger.logAction(req, 'SPIN_CAMPAIGN_CLONE', 'SpinCampaign', clone._id, {
    from: String(source._id), slug: clone.slug, prizes: prizes.length,
  });
  return res.status(201).json({ success: true, campaign: clone, prizesCloned: prizes.length });
};

/** GET /spin/admin/campaigns/:id/odds — the live probability preview. */
export const getOdds = async (req, res) => {
  const preview = await spinService.previewOdds(req.params.id, {
    paidOrdersPerDay: Number(req.query.paidOrdersPerDay) || 0,
  });
  return res.json({ success: true, ...preview });
};

// ───────────────────────────────────────────────────────────────────────────────
// Admin — prizes
// ───────────────────────────────────────────────────────────────────────────────

export const listPrizes = async (req, res) => {
  const prizes = await spinPrizeRepository.findByCampaign(req.params.id);
  return res.json({ success: true, prizes });
};

export const createPrize = async (req, res) => {
  const body = { ...req.body, campaign: req.params.id };
  // Stock starts full. Accepting a client-sent stockRemaining would let a typo award
  // more units than exist.
  if (body.stockTotal != null) body.stockRemaining = body.stockTotal;
  const prize = await spinPrizeRepository.createPrize(body);
  await purgeSpinCache();
  await auditLogger.logAction(req, 'SPIN_PRIZE_CREATE', 'SpinPrize', prize._id, { name: prize.name, stock: prize.stockTotal });
  return res.status(201).json({ success: true, prize });
};

export const updatePrize = async (req, res) => {
  const existing = await spinPrizeRepository.findDocById(req.params.prizeId);
  if (!existing) throw new AppError('Prize not found.', 404);

  const patch = { ...req.body };
  // stockAwarded is history. A total below what has already gone out would make the
  // remaining count describe inventory that does not exist.
  if (patch.stockTotal != null && patch.stockTotal < (existing.stockAwarded || 0)) {
    throw new AppError(
      `Total stock cannot be below the ${existing.stockAwarded} already awarded.`,
      422, { expose: true },
    );
  }
  // Restock semantics: raising the total raises what is left by the same amount, rather
  // than resetting it and silently discarding awarded history.
  if (patch.stockTotal != null && existing.stockTotal != null) {
    const delta = patch.stockTotal - existing.stockTotal;
    patch.stockRemaining = Math.max(0, (existing.stockRemaining || 0) + delta);
  }
  delete patch.stockAwarded;
  delete patch.campaign;

  const prize = await spinPrizeRepository.updateById(req.params.prizeId, patch);
  await purgeSpinCache();
  await auditLogger.logAction(req, 'SPIN_PRIZE_UPDATE', 'SpinPrize', prize._id, { fields: Object.keys(patch) });
  return res.json({ success: true, prize });
};

/**
 * DELETE /spin/admin/prizes/:prizeId — deactivate, never hard-delete.
 *
 * SpinResult rows reference this document, and those rows are the record of physical
 * stock that left the building. Removing it would orphan winners.
 */
export const deactivatePrize = async (req, res) => {
  const prize = await spinPrizeRepository.findDocById(req.params.prizeId);
  if (!prize) throw new AppError('Prize not found.', 404);

  // Pulling the floor prize out from under a live campaign breaks "everyone wins" for
  // every spin that follows, so it is refused while the campaign is running.
  if (prize.isFloorPrize) {
    const campaign = await spinCampaignRepository.findById(prize.campaign);
    if (campaign?.status === SPIN_STATUS.LIVE) {
      throw new AppError(
        'Cannot remove the guaranteed floor prize while the campaign is live — switch the campaign off first.',
        422, { expose: true },
      );
    }
  }

  prize.active = false;
  await spinPrizeRepository.saveDoc(prize);
  await purgeSpinCache();
  await auditLogger.logAction(req, 'SPIN_PRIZE_DEACTIVATE', 'SpinPrize', prize._id, { name: prize.name });
  return res.json({ success: true, prize });
};

// ───────────────────────────────────────────────────────────────────────────────
// Admin — the fulfilment queue
// ───────────────────────────────────────────────────────────────────────────────

/**
 * GET /spin/admin/winners — goodies that still need putting in a parcel.
 *
 * This is the layer that actually stops a reward being missed: a banner on an order can
 * be scrolled past, a queue with a count cannot empty itself silently.
 */
export const listWinners = async (req, res) => {
  const { campaignId = null, fulfilled = 'false', limit = 50, before = null } = req.query;
  const winners = await spinResultRepository.findFulfilmentQueue({
    campaignId,
    fulfilled: fulfilled === 'true',
    limit: Math.min(Number(limit) || 50, 100),
    before: before ? new Date(before) : null,
  });
  const nextCursor = winners.length ? winners[winners.length - 1].spunAt : null;
  const unfulfilledCount = await spinResultRepository.countUnfulfilled(campaignId);
  return res.json({ success: true, winners, nextCursor, unfulfilledCount });
};

/** PATCH /spin/admin/winners/:id/fulfil — a human confirms the goodie is in the box. */
export const fulfilWinner = async (req, res) => {
  // Conditional on fulfilledAt being unset, so two admins clicking at once record one
  // fulfilment by one person rather than overwriting each other.
  const result = await spinResultRepository.claimFulfilment(req.params.id, req.user._id);
  if (!result) {
    const existing = await spinResultRepository.findLeanById(req.params.id);
    if (!existing) throw new AppError('Spin result not found.', 404);
    return res.json({ success: true, result: existing, alreadyFulfilled: true });
  }

  await orderRepository.markSpinRewardFulfilled(result.order, result._id, result.fulfilledAt);
  await auditLogger.logAction(req, 'SPIN_REWARD_FULFIL', 'SpinResult', result._id, {
    prize: result.prizeSnapshot?.name,
    order: String(result.order),
  });
  return res.json({ success: true, result, alreadyFulfilled: false });
};

export default {
  getSpinStatus,
  postSpin,
  postReviewClicked,
  listCampaigns,
  createCampaign,
  updateCampaign,
  publishCampaign,
  setCampaignStatus,
  cloneCampaign,
  getOdds,
  listPrizes,
  createPrize,
  updatePrize,
  deactivatePrize,
  listWinners,
  fulfilWinner,
};

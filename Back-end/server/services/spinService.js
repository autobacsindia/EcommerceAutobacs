/**
 * Spin-to-Win engine — eligibility, the draw, clawback, and the publish gate.
 *
 * The client picks nothing. It sends "spin this order" and receives a decided outcome
 * plus the slice index to land on; the animation is theatre over a server decision that
 * has already been committed to the database. Every guarantee in this file exists
 * because a goodie is a real object with a real count:
 *
 *   • ONE spin per order, enforced by a unique index (not by a pre-check).
 *   • Stock is claimed by an ATOMIC guarded decrement, never read-then-write.
 *   • The claim and the SpinResult insert share a transaction, so neither can survive
 *     without the other.
 *   • A cancelled or refunded order gives the prize back.
 *
 * These mirror the money path's discipline deliberately — the failure modes are the
 * same shape (double-fulfilment, oversell, lost side effect), so the defences are too.
 */

import crypto from 'crypto';
import mongoose from 'mongoose';

import AppError from '../utils/AppError.js';
import { formatIsoDateIST } from '../utils/datetime.js';
import {
  SPIN_STATUS,
  SPIN_RESULT_STATUS,
  PRIZE_KIND,
  VOID_REASON,
  MAX_DRAW_ATTEMPTS,
  REVIEW_URL_ALLOWED_HOSTS,
} from '../config/spin.js';

import SpinResult from '../models/SpinResult.js';
import Order from '../models/Order.js';
import spinCampaignRepository from '../repositories/spinCampaignRepository.js';
import spinPrizeRepository from '../repositories/spinPrizeRepository.js';
import spinResultRepository from '../repositories/spinResultRepository.js';
import { getLoyaltyConfig } from './loyaltyConfigService.js';

/**
 * Why a spin was refused. Stable machine-readable strings — the storefront maps them to
 * copy, and a free-form message would drift between the two apps.
 */
export const INELIGIBLE = Object.freeze({
  NO_CAMPAIGN: 'no_campaign',
  NOT_PAID: 'not_paid',
  ORDER_NOT_FOUND: 'order_not_found',
  ORDER_CLOSED: 'order_closed',
  LEGACY_ORDER: 'legacy_order',
  PREDATES_CAMPAIGN: 'predates_campaign',
  BELOW_MIN_VALUE: 'below_min_value',
  USER_CAP_REACHED: 'user_cap_reached',
  STATE_EXCLUDED: 'state_excluded',
  MISCONFIGURED: 'misconfigured',
});

/** SHA-256, matching how Order hashes guest IPs — forensics without storing a raw IP. */
export const hashIp = (ip) =>
  (ip ? crypto.createHash('sha256').update(String(ip)).digest('hex') : null);

// ───────────────────────────────────────────────────────────────────────────────
// Odds
// ───────────────────────────────────────────────────────────────────────────────

/**
 * A single prize's relative weight in the draw.
 *
 * Stock mode is the default and the reason the feature needs no tuning: weight tracks
 * remaining stock, so 500 keychains against 5 dashcams gives the dashcam ~1% on its own,
 * and each goodie's odds fall as it depletes — the pool drains evenly rather than one
 * item vanishing on the first day.
 *
 * The floor prize is never weighted here. Its stock is unlimited, so "weight ∝ stock"
 * would be infinite; it is priced separately by floorWeight() below.
 */
export const prizeWeight = (prize) => {
  if (prize.isFloorPrize) return 0;
  if (prize.weightMode === 'manual') return Math.max(0, prize.manualWeight || 0);
  const stock = prize.stockRemaining;
  if (stock === null || stock === undefined) return 0; // unlimited + not floor = unweightable
  return Math.max(0, stock * (prize.weightFactor ?? 1));
};

/**
 * The floor prize's derived weight, from the campaign's goodieWinRatePercent.
 *
 *     P(goodie) = G / (G + F) = rate/100   ⟹   F = G × (100 − rate) / rate
 *
 * At rate = 100 this is 0: every spin wins a real goodie until stock runs out, and the
 * floor prize only surfaces once the pool is empty.
 */
export const floorWeight = (totalGoodieWeight, goodieWinRatePercent) => {
  const rate = Math.min(100, Math.max(1, goodieWinRatePercent || 20));
  if (rate >= 100) return 0;
  return (totalGoodieWeight * (100 - rate)) / rate;
};

/**
 * Weighted pick over parallel item/weight arrays. Returns null when every weight is 0.
 * `rng` is injected so tests can assert the distribution deterministically instead of
 * hoping a random sample behaves.
 */
export const weightedPick = (items, weights, rng = Math.random) => {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  let r = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1]; // float drift guard
};

/**
 * The slices the customer sees.
 *
 * Prize count and slice count are INDEPENDENT: 30 goodies do not make a 30-slice wheel,
 * and 3 goodies must not leave a wheel with 3 slices and five gaps. Slices are sampled
 * from the eligible pool using the SAME weights as the real draw, so what the customer
 * looks at is representative of their actual odds rather than decorative.
 *
 * The floor prize always occupies a slice — that is what makes "everyone wins" visibly
 * true — and the winner is guaranteed a slice so the wheel can land on what was actually
 * won. Repeats are allowed when the pool is smaller than the wheel; real prize wheels do
 * the same, and it is honest here because the outcome was already decided server-side.
 */
export const buildSegments = ({ pool, floorPrize, winner, segmentCount, rng = Math.random }) => {
  const byId = (a, b) => String(a?._id) === String(b?._id);
  const goodies = pool.filter((p) => !p.isFloorPrize);

  const slices = [];
  if (floorPrize) slices.push(floorPrize);

  // Weighted sampling WITHOUT replacement, so a wheel with room shows variety.
  const remaining = [...goodies];
  while (slices.length < segmentCount && remaining.length > 0) {
    const weights = remaining.map(prizeWeight);
    const picked = weightedPick(remaining, weights, rng) ?? remaining[0];
    slices.push(picked);
    remaining.splice(remaining.findIndex((p) => byId(p, picked)), 1);
  }

  // Pool smaller than the wheel → cycle the available prizes so no slice is empty.
  const fillers = goodies.length > 0 ? goodies : (floorPrize ? [floorPrize] : []);
  let f = 0;
  while (slices.length < segmentCount && fillers.length > 0) {
    slices.push(fillers[f % fillers.length]);
    f += 1;
  }

  // The wheel must be able to land on what was actually won.
  if (winner && !slices.some((s) => byId(s, winner))) {
    const replaceable = slices
      .map((s, i) => i)
      .filter((i) => !byId(slices[i], floorPrize));
    const target = replaceable.length > 0
      ? replaceable[Math.floor(rng() * replaceable.length)]
      : slices.length - 1;
    slices[target] = winner;
  }

  // Fisher-Yates, so the floor prize is not always slice 0 and the layout varies.
  for (let i = slices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [slices[i], slices[j]] = [slices[j], slices[i]];
  }

  const segmentIndex = winner ? slices.findIndex((s) => byId(s, winner)) : -1;
  return {
    slices,
    segmentIndex: segmentIndex >= 0 ? segmentIndex : 0,
    labels: slices.map((s) => s.shortLabel || s.name),
  };
};

// ───────────────────────────────────────────────────────────────────────────────
// Eligibility
// ───────────────────────────────────────────────────────────────────────────────

const isClosed = (status) => ['cancelled', 'returned', 'refunded'].includes(status);

/**
 * Can this order spin, and what would it see?
 *
 * Read-only and safe to call on every order-success render. It never reveals or
 * pre-computes the outcome — only whether a spin is on offer.
 */
export const checkEligibility = async (orderId, { userId = null, now = new Date() } = {}) => {
  const order = await Order.findById(orderId).lean();
  if (!order) return { eligible: false, reason: INELIGIBLE.ORDER_NOT_FOUND };

  const existing = await spinResultRepository.findByOrder(orderId);
  if (existing) return { eligible: false, reason: null, alreadySpun: true, result: existing, order };

  const campaign = await spinCampaignRepository.findLiveAt(now);
  if (!campaign) return { eligible: false, reason: INELIGIBLE.NO_CAMPAIGN, order };

  // ── The money gate. The order must ALREADY be paid, which only the signature-
  // verified Razorpay webhook (or the equally-verified callback, converging on the
  // same idempotent routine) can make true. The client saying "payment succeeded"
  // is not an input here.
  if (order.paymentStatus !== 'paid') {
    return { eligible: false, reason: INELIGIBLE.NOT_PAID, order, campaign };
  }
  if (isClosed(order.status)) {
    return { eligible: false, reason: INELIGIBLE.ORDER_CLOSED, order, campaign };
  }
  // Imported WooCommerce history is analytics, not a live fulfilment path.
  if (order.source === 'woocommerce') {
    return { eligible: false, reason: INELIGIBLE.LEGACY_ORDER, order, campaign };
  }
  // No retro-spinning orders placed before the campaign opened.
  if (new Date(order.createdAt) < new Date(campaign.startsAt)) {
    return { eligible: false, reason: INELIGIBLE.PREDATES_CAMPAIGN, order, campaign };
  }

  const orderValuePaise = Math.round((order.totalAmount || 0) * 100);
  if (orderValuePaise < (campaign.minOrderValuePaise || 0)) {
    return { eligible: false, reason: INELIGIBLE.BELOW_MIN_VALUE, order, campaign };
  }

  // Legal carve-out: prize promotions sit under state gaming law, and a few states are
  // materially stricter. Data-driven so legal can exclude one without a deploy.
  const state = (order.shippingAddress?.state || '').trim().toLowerCase();
  if (state && (campaign.excludedStates || []).some((s) => s.trim().toLowerCase() === state)) {
    return { eligible: false, reason: INELIGIBLE.STATE_EXCLUDED, order, campaign };
  }

  // Anti-farming: stops one customer splitting a big cart into many small orders.
  if (userId && campaign.maxSpinsPerUserPerCampaign) {
    const spins = await spinResultRepository.countGrantedForUser(userId, campaign._id);
    if (spins >= campaign.maxSpinsPerUserPerCampaign) {
      return { eligible: false, reason: INELIGIBLE.USER_CAP_REACHED, order, campaign };
    }
  }

  // A live campaign with no floor prize cannot honour "everyone wins". The publish gate
  // makes this unreachable through the admin; a direct database edit or a race could
  // still produce it, and a customer must see no wheel rather than a stack trace on
  // their order confirmation.
  const floorPrize = await spinPrizeRepository.findFloorPrize(campaign._id);
  if (!floorPrize) {
    console.error(`[Spin] CRITICAL: live campaign ${campaign.slug} has no active floor prize`);
    return { eligible: false, reason: INELIGIBLE.MISCONFIGURED, order, campaign };
  }

  return { eligible: true, reason: null, order, campaign, floorPrize, orderValuePaise };
};

// ───────────────────────────────────────────────────────────────────────────────
// The draw
// ───────────────────────────────────────────────────────────────────────────────

/** Karma prizes are unwinnable while the loyalty programme is switched off. */
const filterUnawardablePrizes = async (pool) => {
  if (!pool.some((p) => p.kind === PRIZE_KIND.KARMA)) return pool;
  let karmaEnabled = false;
  try {
    karmaEnabled = Boolean((await getLoyaltyConfig())?.enabled);
  } catch {
    karmaEnabled = false; // fail closed: never award points the programme cannot honour
  }
  return karmaEnabled ? pool : pool.filter((p) => p.kind !== PRIZE_KIND.KARMA);
};

const snapshotOf = (prize) => ({
  name: prize.name,
  sku: prize.sku || null,
  kind: prize.kind,
  imageUrl: prize.imageUrl || null,
  isFloorPrize: Boolean(prize.isFloorPrize),
});

/**
 * Spin an order. Idempotent: calling it twice returns the same prize, always.
 *
 * @returns {{ result: object, alreadySpun: boolean }}
 */
export const spin = async (orderId, { userId = null, ip = null, rng = Math.random, now = new Date() } = {}) => {
  // Fast path — a refresh or a second tab. Cheap, and keeps the common duplicate out
  // of a transaction entirely. It is NOT the correctness guarantee; the unique index is.
  const already = await spinResultRepository.findByOrder(orderId);
  if (already) return { result: already, alreadySpun: true };

  const pre = await checkEligibility(orderId, { userId, now });
  if (pre.alreadySpun) return { result: pre.result, alreadySpun: true };
  if (!pre.eligible) {
    throw new AppError(`Spin unavailable for this order (${pre.reason}).`, 400, { expose: true });
  }

  const session = await mongoose.startSession();
  try {
    let created = null;

    await session.withTransaction(async () => {
      // Reset per attempt: withTransaction re-runs this callback on a WriteConflict,
      // which is exactly what a lost race for the last unit looks like in-transaction.
      created = null;

      // Re-verify inside the transaction. A campaign can be switched off, or an order
      // refunded, between the render that offered the wheel and the click that spins it.
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new AppError('Order not found.', 404);
      if (order.paymentStatus !== 'paid' || isClosed(order.status)) {
        throw new AppError('Spin unavailable for this order (not_paid).', 400, { expose: true });
      }

      const campaign = await spinCampaignRepository.findLiveAt(now);
      if (!campaign || campaign.status !== SPIN_STATUS.LIVE) {
        throw new AppError('Spin unavailable for this order (no_campaign).', 400, { expose: true });
      }

      const existing = await spinResultRepository.findByOrder(orderId, session);
      if (existing) { created = existing; return; }

      const orderValuePaise = Math.round((order.totalAmount || 0) * 100);
      const rawPool = await spinPrizeRepository.findEligiblePool(campaign._id, orderValuePaise);
      const pool = await filterUnawardablePrizes(rawPool);

      const floorPrize = pool.find((p) => p.isFloorPrize)
        ?? await spinPrizeRepository.findFloorPrize(campaign._id, session);
      if (!floorPrize) throw new AppError('Spin unavailable for this order (misconfigured).', 409);

      const goodies = pool.filter((p) => !p.isFloorPrize);

      // ── Draw → claim → re-draw on a lost race ────────────────────────────────
      // A null claim means a concurrent spin took the last unit, the daily cap closed,
      // or the prize was deactivated mid-flight. All three mean the same thing: this
      // prize is gone, drop it and draw again. Bounded, because the floor prize can
      // never fail and is the honest answer once contention wins.
      let winner = null;
      let candidates = [...goodies];

      for (let attempt = 0; attempt < MAX_DRAW_ATTEMPTS && !winner; attempt += 1) {
        const weights = candidates.map(prizeWeight);
        const totalGoodieWeight = weights.reduce((a, b) => a + b, 0);
        const fw = floorWeight(totalGoodieWeight, campaign.goodieWinRatePercent);

        const picked = weightedPick([...candidates, floorPrize], [...weights, fw], rng);
        if (!picked || picked.isFloorPrize) break; // floor prize drawn — settle below

        const claimed = await spinPrizeRepository.claimUnit(picked._id, session, now);
        if (claimed) { winner = claimed; break; }

        candidates = candidates.filter((p) => String(p._id) !== String(picked._id));
        if (candidates.length === 0) break;
      }

      if (!winner) {
        // The floor prize has unlimited stock, so this claim cannot fail on stock —
        // but it is still routed through claimUnit so awarded counts stay accurate and
        // an `active: false` floor prize is caught rather than silently awarded.
        const claimedFloor = await spinPrizeRepository.claimUnit(floorPrize._id, session, now);
        if (!claimedFloor) throw new AppError('Spin unavailable for this order (misconfigured).', 409);
        winner = claimedFloor;
      }

      const { segmentIndex, labels } = buildSegments({
        pool,
        floorPrize,
        winner,
        segmentCount: campaign.segmentCount,
        rng,
      });

      const [doc] = await SpinResult.create([{
        order: orderId,
        user: userId || order.user || null,
        campaign: campaign._id,
        prize: winner._id,
        prizeSnapshot: snapshotOf(winner),
        segmentIndex,
        segmentLabels: labels,
        status: SPIN_RESULT_STATUS.GRANTED,
        spunAt: now,
        ipHash: hashIp(ip),
      }], { session });

      // Denormalise onto the order in the SAME transaction, so the packing team can
      // never see a reward the ledger does not have (or miss one it does).
      order.spinReward = {
        result: doc._id,
        prize: winner._id,
        name: winner.name,
        sku: winner.sku || null,
        kind: winner.kind,
        imageUrl: winner.imageUrl || null,
        wonAt: now,
        fulfilledAt: null,
        voidedAt: null,
      };
      await order.save({ session });

      created = doc.toObject();
    });

    return { result: created, alreadySpun: false };
  } catch (error) {
    // Two concurrent first-spins: the unique index on `order` rejects the loser. The
    // end state is correct — one spin, one prize — so re-read and report it as the
    // idempotent success it is, rather than surfacing a database error to a customer
    // who is looking at a confirmation page.
    const isDuplicate =
      error?.code === 11000 || /duplicate key|writeconflict/i.test(error?.message || '');
    if (isDuplicate) {
      const existing = await spinResultRepository.findByOrder(orderId);
      if (existing) return { result: existing, alreadySpun: true };
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

// ───────────────────────────────────────────────────────────────────────────────
// Clawback
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Withdraw an order's prize when the money goes back.
 *
 * Without this, "buy → spin → win the dashcam → cancel the order → repeat" is a free
 * warehouse. Idempotent: a second call on an already-void result is a no-op, so a
 * retried status transition cannot return the same unit to stock twice.
 *
 * Stock is returned ONLY if the goodie has not already been packed and shipped. Once it
 * is physically gone, incrementing the counter would invent inventory that does not
 * exist. That asymmetry is deliberate.
 */
export const voidForOrder = async (orderId, reason = VOID_REASON.ORDER_CANCELLED) => {
  const session = await mongoose.startSession();
  try {
    let outcome = { voided: false, stockReturned: false };

    await session.withTransaction(async () => {
      outcome = { voided: false, stockReturned: false };

      // Atomic status flip IS the idempotency guard: only the caller that transitions
      // granted → void proceeds to touch stock.
      const result = await SpinResult.findOneAndUpdate(
        { order: orderId, status: SPIN_RESULT_STATUS.GRANTED },
        { $set: { status: SPIN_RESULT_STATUS.VOID, voidReason: reason, voidedAt: new Date() } },
        { new: true, session },
      );
      if (!result) return; // no spin, or already void

      const alreadyShipped = Boolean(result.fulfilledAt);
      if (!alreadyShipped) {
        await spinPrizeRepository.releaseUnit(result.prize, session);
        result.stockReturned = true;
        await result.save({ session });
      }

      await Order.updateOne(
        { _id: orderId, 'spinReward.result': result._id },
        { $set: { 'spinReward.voidedAt': new Date() } },
        { session },
      );

      outcome = { voided: true, stockReturned: !alreadyShipped };
    });

    return outcome;
  } finally {
    await session.endSession();
  }
};

// ───────────────────────────────────────────────────────────────────────────────
// Publish gate
// ───────────────────────────────────────────────────────────────────────────────

const isAllowedReviewUrl = (raw) => {
  // Parsed, never substring-matched. `https://evil.com/?q=google.com` defeats a
  // "contains" check and `//evil.com` defeats a "starts with /" check — this repo has
  // already shipped that bug once on promo-banner links.
  try {
    const u = new URL(String(raw));
    return u.protocol === 'https:' && REVIEW_URL_ALLOWED_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
};

/**
 * Everything that must be true before a campaign may go live.
 *
 * Returns NAMED FIELD ERRORS, never a bare "Validation Error". An opaque validation
 * failure that does not say which field is wrong is unfixable from the admin UI — that
 * is precisely what made a product un-saveable here for an entire afternoon.
 *
 * @returns {Promise<Array<{field: string, message: string, value?: any}>>} empty = OK
 */
export const validateForPublish = async (campaignId) => {
  const errors = [];
  const campaign = await spinCampaignRepository.findById(campaignId);
  if (!campaign) return [{ field: 'campaign', message: 'Campaign not found.' }];

  if (!(campaign.endsAt > campaign.startsAt)) {
    errors.push({ field: 'endsAt', message: 'End date must be after the start date.', value: campaign.endsAt });
  }
  if (campaign.endsAt <= new Date()) {
    errors.push({ field: 'endsAt', message: 'End date is already in the past.', value: campaign.endsAt });
  }

  if (campaign.reviewCta?.enabled && !isAllowedReviewUrl(campaign.reviewCta?.url)) {
    errors.push({
      field: 'reviewCta.url',
      message: `Must be an https:// URL on one of: ${REVIEW_URL_ALLOWED_HOSTS.join(', ')}.`,
      value: campaign.reviewCta?.url ?? null,
    });
  }

  const prizes = await spinPrizeRepository.findByCampaign(campaignId, { activeOnly: true });
  const floors = prizes.filter((p) => p.isFloorPrize);

  // THE critical guard. Without exactly one unlimited floor prize, "everyone wins"
  // becomes a lie the moment the last goodie is claimed and the draw has nothing to
  // fall back to.
  if (floors.length === 0) {
    errors.push({
      field: 'prizes.isFloorPrize',
      message: 'Add one guaranteed floor prize (unlimited stock) — every spin must be able to win something.',
    });
  } else if (floors.length > 1) {
    errors.push({
      field: 'prizes.isFloorPrize',
      message: `Exactly one floor prize is allowed; found ${floors.length}.`,
      value: floors.map((p) => p.name),
    });
  } else {
    const floor = floors[0];
    if (floor.stockRemaining !== null && floor.stockRemaining !== undefined) {
      errors.push({
        field: 'prizes.stockRemaining',
        message: `Floor prize "${floor.name}" must have unlimited stock (leave stock empty).`,
        value: floor.stockRemaining,
      });
    }
    if ((floor.minOrderValuePaise || 0) > 0) {
      errors.push({
        field: 'prizes.minOrderValuePaise',
        message: `Floor prize "${floor.name}" must have no minimum order value, or low-value orders can win nothing.`,
        value: floor.minOrderValuePaise,
      });
    }
  }

  if (prizes.filter((p) => !p.isFloorPrize).length === 0) {
    errors.push({
      field: 'prizes',
      message: 'Add at least one real prize — a wheel with only the floor prize has one outcome.',
    });
  }

  for (const p of prizes) {
    if (p.isFloorPrize) continue;
    if (p.stockRemaining === null || p.stockRemaining === undefined) {
      errors.push({ field: `prizes.${p._id}.stockRemaining`, message: `"${p.name}": only the floor prize may have unlimited stock.` });
    } else if (p.stockTotal !== null && p.stockRemaining > p.stockTotal) {
      errors.push({
        field: `prizes.${p._id}.stockRemaining`,
        message: `"${p.name}": remaining (${p.stockRemaining}) exceeds total (${p.stockTotal}).`,
      });
    }
    if (p.kind === PRIZE_KIND.GOODIE && !p.sku) {
      errors.push({ field: `prizes.${p._id}.sku`, message: `"${p.name}": a SKU is required so the packing team can find it.` });
    }
    if (p.kind === PRIZE_KIND.COUPON && !p.couponCode) {
      errors.push({ field: `prizes.${p._id}.couponCode`, message: `"${p.name}": a coupon prize needs a coupon code.` });
    }
    if (p.kind === PRIZE_KIND.KARMA && !(p.karmaPoints > 0)) {
      errors.push({ field: `prizes.${p._id}.karmaPoints`, message: `"${p.name}": a karma prize needs a positive point value.` });
    }
  }

  return errors;
};

/**
 * Live odds + projected exhaustion, for the admin preview panel.
 *
 * This is how an operator sanity-checks the economy: enter the goodies, read the real
 * probabilities back. `paidOrdersPerDay` comes from the caller's own analytics window —
 * the service does not guess a rate it cannot measure.
 */
export const previewOdds = async (campaignId, { paidOrdersPerDay = 0 } = {}) => {
  const campaign = await spinCampaignRepository.findById(campaignId);
  if (!campaign) throw new AppError('Campaign not found.', 404);

  const prizes = await spinPrizeRepository.findByCampaign(campaignId, { activeOnly: true });
  const goodies = prizes.filter((p) => !p.isFloorPrize);
  const floor = prizes.find((p) => p.isFloorPrize) || null;

  const weights = goodies.map(prizeWeight);
  const totalGoodieWeight = weights.reduce((a, b) => a + b, 0);
  const fw = floorWeight(totalGoodieWeight, campaign.goodieWinRatePercent);
  const grand = totalGoodieWeight + fw;

  const rows = goodies.map((p, i) => {
    const probability = grand > 0 ? weights[i] / grand : 0;
    const perDay = probability * paidOrdersPerDay;
    return {
      prizeId: p._id,
      name: p.name,
      stockRemaining: p.stockRemaining,
      probability,
      expectedWinsPerDay: perDay,
      daysToExhaustion: perDay > 0 && p.stockRemaining != null ? p.stockRemaining / perDay : null,
      cappedPerDay: p.maxWinsPerDay ?? null,
    };
  });

  if (floor) {
    rows.push({
      prizeId: floor._id,
      name: floor.name,
      stockRemaining: null,
      probability: grand > 0 ? fw / grand : 1,
      expectedWinsPerDay: (grand > 0 ? fw / grand : 1) * paidOrdersPerDay,
      daysToExhaustion: null,
      cappedPerDay: null,
      isFloorPrize: true,
    });
  }

  return {
    campaign: { slug: campaign.slug, goodieWinRatePercent: campaign.goodieWinRatePercent },
    generatedForIstDate: formatIsoDateIST(new Date()),
    paidOrdersPerDay,
    rows,
  };
};

export default {
  INELIGIBLE,
  checkEligibility,
  spin,
  voidForOrder,
  validateForPublish,
  previewOdds,
  prizeWeight,
  floorWeight,
  weightedPick,
  buildSegments,
  hashIp,
};

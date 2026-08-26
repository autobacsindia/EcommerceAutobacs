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
  SPIN_LIVE_CAMPAIGN_CACHE_KEY,
  SPIN_RESULT_STATUS,
  PRIZE_KIND,
  VOID_REASON,
  MAX_DRAW_ATTEMPTS,
  REVIEW_URL_ALLOWED_HOSTS,
} from '../config/spin.js';

import orderRepository from '../repositories/orderRepository.js';
import couponRepository from '../repositories/couponRepository.js';
import spinCampaignRepository from '../repositories/spinCampaignRepository.js';
import spinPrizeRepository from '../repositories/spinPrizeRepository.js';
import spinResultRepository from '../repositories/spinResultRepository.js';
import cacheService from './cacheService.js';
import { TTL } from './cache/index.js';
import { getLoyaltyConfig } from './loyaltyConfigService.js';
import { getNotificationsQueue } from '../queue/queues.js';

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
 * The live campaign, cache-aside.
 *
 * The key is deliberately global, not per-order: "which campaign is running" is the
 * same answer for every customer on the site, so one entry serves all of them and the
 * DB read rate becomes O(1) in traffic rather than O(orders x polls). It sits under
 * `public:spin:` so the model's write hook and the admin controller's purge both cover
 * it with a single pattern invalidation.
 *
 * ⚠️ RENDER PATH ONLY. The draw re-reads the campaign straight from Mongo inside its
 * transaction and must keep doing so: awarding real stock off a cached row could hand
 * out prizes from a campaign an operator had already switched off.
 *
 * Two traps this has to dodge, both of which would otherwise be silent:
 *
 *  1. The query is TIME-DEPENDENT (`startsAt <= now < endsAt`), and nothing writes to
 *     the campaign when it expires — so a cached row would outlive its own window and
 *     keep the wheel spinning after the promotion closed. The window is therefore
 *     re-checked against `now` on every read, and a cached-but-expired row is treated
 *     as a miss rather than trusted.
 *  2. "No live campaign" is the common answer when the feature is off, and it is a
 *     falsy one. cacheService.get returns null for a miss too, so a bare null could
 *     never be distinguished from a miss and would never actually cache. The value is
 *     wrapped in an envelope so the absence itself is cacheable.
 *
 * Fails open: any Redis problem degrades to a direct Mongo read. A cache outage must
 * not take the reward wheel down with it.
 */
export const getLiveCampaignCached = async (now = new Date()) => {
  try {
    const cached = await cacheService.get(SPIN_LIVE_CAMPAIGN_CACHE_KEY);
    if (cached && typeof cached === 'object' && 'campaign' in cached) {
      const c = cached.campaign;
      if (!c) return null;
      // Trap 1: honour the window the cached row was selected under, not just its TTL.
      if (c.status === SPIN_STATUS.LIVE
        && new Date(c.startsAt) <= now
        && new Date(c.endsAt) > now) {
        return c;
      }
    }
  } catch (err) {
    // cacheService.get swallows Redis errors itself, so reaching here means something
    // less expected. Either way the answer is the same: go to the source.
    console.warn('[Spin] live-campaign cache read failed, falling back to Mongo:', err?.message);
  }

  const fresh = await spinCampaignRepository.findLiveAt(now);
  try {
    // Trap 2: envelope, so `null` survives the round trip as a real cached answer.
    await cacheService.set(SPIN_LIVE_CAMPAIGN_CACHE_KEY, { campaign: fresh || null }, TTL.SPIN_CAMPAIGN);
  } catch (err) {
    // A write we could not cache is a slow path, not a wrong one.
    console.warn('[Spin] live-campaign cache write failed:', err?.message);
  }
  return fresh;
};

/**
 * Can this order spin, and what would it see?
 *
 * Read-only and safe to call on every order-success render. It never reveals or
 * pre-computes the outcome — only whether a spin is on offer.
 */
export const checkEligibility = async (orderId, { userId = null, now = new Date(), order: prefetchedOrder = null } = {}) => {
  // `prefetchedOrder` lets the HTTP layer reuse the document it already loaded to
  // authorise the request instead of reading the same order twice per poll. It must
  // carry every field read below — see orderRepository.findForSpinEligibility.
  const order = prefetchedOrder || await orderRepository.findForSpinEligibility(orderId);
  if (!order) return { eligible: false, reason: INELIGIBLE.ORDER_NOT_FOUND };

  const existing = await spinResultRepository.findByOrder(orderId);
  if (existing) return { eligible: false, reason: null, alreadySpun: true, result: existing, order };

  const campaign = await getLiveCampaignCached(now);
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

/**
 * Mint the winner's OWN single-use coupon, inside the draw's transaction.
 *
 * WHY ONE CODE PER WINNER rather than a shared code: `Coupon.usageLimitPerUser` is not
 * enforced in production — the unique index behind it was never built — so a shared code
 * posted publicly could be redeemed without limit. `usageLimit` (the GLOBAL cap) *is*
 * enforced by an atomic counter, so a per-winner coupon with `usageLimit: 1` bounds a
 * leaked code to exactly one redemption using the guarantee that actually holds today.
 *
 * Minted IN-TRANSACTION deliberately: a prize the customer can see but cannot redeem is
 * worse than no prize, so the coupon and the win must commit together or not at all.
 *
 * The coupon is NOT bound to a user id, because the Coupon model has no such field —
 * which is precisely why uniqueness-per-winner plus a global limit of 1 is the mechanism
 * doing the work here, rather than ownership.
 *
 * Collisions are astronomically unlikely but not impossible, and `Coupon.code` is
 * uniquely indexed — so a duplicate is retried rather than surfaced to a customer who is
 * looking at a confirmation page.
 */
const mintCouponFor = async (prize, { now, session }) => {
  const prefix = (prize.couponPrefix || 'SPIN').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const validDays = prize.couponValidDays ?? 30;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    // 5 bytes → 8 base32-ish chars. Ambiguous characters are avoided because this code
    // gets read off a screen and typed by hand.
    const suffix = crypto.randomBytes(5).toString('hex').toUpperCase().replace(/[01IO]/g, '9').slice(0, 8);
    const code = `${prefix}-${suffix}`;
    try {
      const coupon = await couponRepository.createInSession({
        code,
        description: `Spin to Win — ${prize.name}`,
        type: prize.couponType || 'fixed',
        value: prize.couponValue || 0,
        maxDiscountAmount: prize.couponMaxDiscount ?? null,
        minCartValue: prize.couponMinCartValue || 0,
        // Never listed on the storefront — it belongs to one winner.
        visibility: 'hidden',
        startsAt: now,
        expiresAt: new Date(now.getTime() + validDays * 86400000),
        // THE guard. Global cap of 1: even if the code is shared, it dies after one use.
        usageLimit: 1,
        usageLimitPerUser: 1,
        isActive: true,
      }, session);
      return coupon;
    } catch (err) {
      const duplicate = err?.code === 11000 || /duplicate key/i.test(err?.message || '');
      if (!duplicate) throw err;
      // else: regenerate and try again
    }
  }
  throw new AppError('Could not issue your coupon. Please contact support.', 500);
};

const snapshotOf = (prize, couponCode = null) => ({
  name: prize.name,
  sku: prize.sku || null,
  kind: prize.kind,
  imageUrl: prize.imageUrl || null,
  isFloorPrize: Boolean(prize.isFloorPrize),
  // Present only for kind='coupon'. Snapshotted so the reveal, the email and order
  // history all show the same code even if the Coupon doc is later edited.
  couponCode,
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
      const order = await orderRepository.findById(orderId, [], session);
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

      // Non-physical prizes must actually hand something over. A coupon prize mints a
      // real, redeemable Coupon here; without this the customer is congratulated and
      // given nothing, which is the failure mode this whole branch exists to prevent.
      let awardedCoupon = null;
      if (winner.kind === PRIZE_KIND.COUPON) {
        awardedCoupon = await mintCouponFor(winner, { now, session });
      }

      const { segmentIndex, labels } = buildSegments({
        pool,
        floorPrize,
        winner,
        segmentCount: campaign.segmentCount,
        rng,
      });

      const doc = await spinResultRepository.createInSession({
        order: orderId,
        user: userId || order.user || null,
        campaign: campaign._id,
        prize: winner._id,
        prizeSnapshot: snapshotOf(winner, awardedCoupon?.code ?? null),
        segmentIndex,
        segmentLabels: labels,
        status: SPIN_RESULT_STATUS.GRANTED,
        awardedCoupon: awardedCoupon?._id ?? null,
        spunAt: now,
        ipHash: hashIp(ip),
      }, session);

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
      await orderRepository.save(order, session);

      created = doc.toObject();
    });

    // ── Prize email (best-effort, POST-COMMIT) ───────────────────────────────
    // Enqueued only after the transaction commits, so a rolled-back spin can never
    // email a prize that was not awarded — the same discipline the invoice email uses.
    // A Redis/queue outage must not fail a spin the customer has already seen resolve;
    // the email is idempotent and can be re-driven.
    if (created && process.env.REDIS_URL) {
      getNotificationsQueue()
        .add('send-spin-prize-email', { orderId })
        .catch((err) => console.error(`[Spin] Failed to enqueue prize email for ${orderId}:`, err.message));
    }

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
      const result = await spinResultRepository.markVoid(orderId, reason, session);
      if (!result) return; // no spin, or already void

      const alreadyShipped = Boolean(result.fulfilledAt);
      if (!alreadyShipped) {
        await spinPrizeRepository.releaseUnit(result.prize, session);
        result.stockReturned = true;
        await spinResultRepository.save(result, session);
      }

      await orderRepository.markSpinRewardVoided(orderId, result._id, session);

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
    // ── Payload checks run for EVERY active prize, floor prize included ──────
    // The floor prize is the one most likely to be a coupon (it is the guaranteed win),
    // so skipping it here would leave the single highest-volume prize unvalidated — the
    // exact hole that let a 0-value coupon reach customers.
    if (p.kind === PRIZE_KIND.COUPON && p.couponType !== 'free_shipping' && !(p.couponValue > 0)) {
      errors.push({
        field: `prizes.${p._id}.couponValue`,
        message: `"${p.name}": set how much the coupon takes off (a 0-value coupon gives the winner nothing).`,
      });
    }
    if (p.kind === PRIZE_KIND.COUPON && p.couponType === 'percentage' && p.couponValue > 100) {
      errors.push({
        field: `prizes.${p._id}.couponValue`,
        message: `"${p.name}": a percentage coupon cannot exceed 100%.`,
      });
    }
    if (p.kind === PRIZE_KIND.KARMA && !(p.karmaPoints > 0)) {
      errors.push({ field: `prizes.${p._id}.karmaPoints`, message: `"${p.name}": a karma prize needs a positive point value.` });
    }

    // ── Stock / SKU checks apply only to real goodies ───────────────────────
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
  getLiveCampaignCached,
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

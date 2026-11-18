/**
 * Shoppable reels — business logic behind routes/reels.js and routes/adminReels.js.
 * The API contract is in the side-session notes (`reels-plan.md`); this file owns it.
 *
 * ── INVARIANTS ───────────────────────────────────────────────────────────────────
 *  1. Only APPROVED reels whose product is ACTIVE (and not deleted) are ever public.
 *     The product's visibility is read live, never copied onto the reel, so it cannot
 *     drift: a product turned off hides its reels on the very next read.
 *  2. The product block (price, MRP, rating, availability) is built LIVE and is
 *     display-only. Nothing here is ever read by checkout; pricingService recomputes.
 *  3. Like / report are idempotent (unique rows; counters move only on insert/delete).
 *  4. Views are a Redis counter, deduplicated per client IP — never a Mongo write.
 *  5. Attribution credits a creator only if they are an ACTIVE affiliate and not the
 *     buyer, and it works exactly like clicking their affiliate link (see attribute()).
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import reelRepository from '../repositories/reelRepository.js';
import productRepository from '../repositories/productRepository.js';
import userRepository from '../repositories/userRepository.js';
import affiliateRepository from '../repositories/affiliateRepository.js';
import { resolveBuyerIdentity, isSelfReferral } from './affiliateAttributionService.js';
import { resolvePublicFestivalOffer } from './festivalOfferService.js';
import { verifyUploadedVideo, reelFolderFor } from './reelMediaService.js';
import { getRedisClient as getCounterRedis } from '../middleware/rate-limit/redisClient.js';
import { AFFILIATE_STATUS } from '../config/affiliate.js';
import {
  REEL_STATUS,
  REEL_STATUSES,
  REEL_TRANSITIONS,
  REEL_PAGE_DEFAULT,
  REEL_PAGE_MAX,
  REEL_ADMIN_PAGE_MAX,
  REEL_FEED_OVERFETCH,
  REEL_FEED_MAX_PASSES,
  REEL_CAPTION_MAX,
  REEL_REJECT_REASON_MAX,
  REEL_REPORT_REASON_MAX,
  REEL_VIEW_DEDUPE_SEC,
  reelViewKey,
  reelViewSeenKey,
} from '../config/reels.js';
import { encodeCursor, decodeCursor, afterClause } from '../utils/listQuery.js';
import { reelMediaUrls } from '../utils/reelMedia.js';
import { effectivePrice } from '../utils/productPrice.js';
import { applyFestivalOffer, resolveFestivalSetting } from '../utils/festivalOffer.js';
import { storefrontOrigin } from '../utils/storefrontUrl.js';
import { STOCK_STATUS } from '../utils/stockStatus.js';
import companyConfig from '../config/company.js';
import AppError from '../utils/AppError.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

// ── Paging ────────────────────────────────────────────────────────────────────

const FEED_SORT = Object.freeze({ field: 'approvedAt', dir: -1, type: 'date' });
const CREATED_SORT = Object.freeze({ field: 'createdAt', dir: -1, type: 'date' });

/** Clamp a client limit into [1, max]; junk becomes the default. */
export const clampLimit = (raw, max = REEL_PAGE_MAX, fallback = REEL_PAGE_DEFAULT) => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return Math.min(fallback, max);
  return Math.min(n, max);
};

/** Decode a cursor for `sortName`; an unreadable cursor is a 400, never "page one". */
const readCursor = (sortName, sort, cursor) => {
  if (cursor == null || cursor === '') return null;
  const after = decodeCursor(sortName, sort, cursor);
  if (!after) throw fail('Invalid cursor', 400);
  return afterClause(sort, after);
};

const toObjectId = (id) => (mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(String(id)) : null);

// ── Shaping ───────────────────────────────────────────────────────────────────

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * The live product block. Display only — never read by checkout.
 *
 *  price            what one unit sells for now (honours an expired sale: effectivePrice)
 *  mrp              the slashed "was" price when the product is on sale, else = price
 *  discountPercent  whole % off MRP, 0 when not on sale
 *  festivalPrice    the Diwali/festival offer price when that offer is live, else null
 *                   (same maths checkout applies; checkout still recomputes it)
 *  hasVariants      true for a variable product — `price` is then the cheapest model and
 *                   the shopper must pick one, so "Buy now" should open the product page
 *  availability     the coarse stock enum ('in' | 'low' | 'out' | 'backorder')
 */
export function toProductBlock(p, { festivalLive = false, now = new Date() } = {}) {
  if (!p) return null;
  const price = effectivePrice(p, now);
  const onSale = typeof p.originalPrice === 'number' && p.originalPrice > price;
  const mrp = onSale ? p.originalPrice : price;
  const discountPercent = onSale && mrp > 0 ? Math.floor(((mrp - price) / mrp) * 100) : 0;
  const offer = festivalLive ? applyFestivalOffer({ unitPrice: price, setting: resolveFestivalSetting(p) }) : null;
  return {
    id: String(p._id),
    slug: p.slug,
    title: p.name,
    image: p.images?.[0]?.url || null,
    price,
    mrp,
    discountPercent,
    festivalPrice: offer ? offer.finalPrice : null,
    hasVariants: p.productType === 'variable',
    averageRating: round1(Number(p.averageRating) || 0),
    ratingCount: Number(p.totalReviews) || 0,
    availability: p.stock || STOCK_STATUS.IN,
  };
}

const storeCreator = () => ({ id: null, name: companyConfig?.name || 'Autobacs India', avatarUrl: null });

const toCreatorBlock = (user) => (user
  ? { id: String(user._id), name: user.name || 'Customer', avatarUrl: user.avatar?.url || null }
  : storeCreator());

/**
 * Public shape of a reel (the contract's `Reel`). `withModeration` adds the fields only
 * the creator and staff may see.
 */
function toReel(reel, { product, creator, liked, withModeration = false }) {
  const urls = reelMediaUrls(reel.media) || { hlsUrl: null, mp4Url: null, posterUrl: null };
  const origin = storefrontOrigin();
  const out = {
    id: String(reel._id),
    status: reel.status,
    ...urls,
    durationSec: reel.media?.durationSec ?? null,
    caption: reel.caption || '',
    createdAt: reel.createdAt,
    creator,
    product,
    likeCount: reel.likeCount || 0,
    viewerLiked: Boolean(liked),
    // The product page for now — there is no standalone /reels web page yet.
    shareUrl: origin && product?.slug ? `${origin}/products/${product.slug}` : null,
  };
  if (withModeration) {
    out.rejectReason = reel.status === REEL_STATUS.REJECTED ? (reel.rejectReason || null) : null;
  }
  return out;
}

/** Festival offer state for display. A failed read must never break the feed. */
async function festivalLiveForDisplay() {
  try {
    return Boolean((await resolvePublicFestivalOffer())?.live);
  } catch {
    return false;
  }
}

/**
 * Turn a page of reel rows into contract Reels with ONE read each for products,
 * creators and likes — never a query per reel.
 *
 * @param {object[]} rows
 * @param {object}   opts
 * @param {*}        [opts.viewerId]
 * @param {boolean}  [opts.publicOnly]  drop reels whose product is not live (feed)
 * @param {boolean}  [opts.withModeration]
 */
async function hydrate(rows, { viewerId = null, publicOnly = true, withModeration = false } = {}) {
  if (!rows.length) return [];
  const productIds = [...new Set(rows.map((r) => String(r.product)))];
  const creatorIds = [...new Set(rows.map((r) => r.creator).filter(Boolean).map(String))];

  const [products, creators, liked, festivalLive] = await Promise.all([
    productRepository.findReelCardsByIds(productIds),
    userRepository.findDisplayByIds(creatorIds),
    reelRepository.likedReelIds(viewerId, rows.map((r) => r._id)),
    festivalLiveForDisplay(),
  ]);
  const creatorById = new Map(creators.map((u) => [String(u._id), u]));
  const now = new Date();

  const out = [];
  for (const r of rows) {
    const p = products.get(String(r.product));
    if (publicOnly && !p) continue; // invariant 1: inactive/draft/deleted product → hidden
    out.push(toReel(r, {
      product: toProductBlock(p, { festivalLive, now }),
      creator: toCreatorBlock(r.creator ? creatorById.get(String(r.creator)) : null),
      liked: liked.has(String(r._id)),
      withModeration,
    }));
  }
  return out;
}

// ── Public reads ──────────────────────────────────────────────────────────────

/**
 * The public feed: approved reels, newest approval first, product live.
 *
 * Reels whose product is hidden are filtered after the read, so a page may come back
 * short; to keep that rare it over-reads, and to keep it bounded it stops after
 * REEL_FEED_MAX_PASSES reads. The cursor is the last row READ (not the last returned),
 * so hidden reels are skipped for good rather than re-read on every page.
 */
export async function listFeed({ cursor = null, limit, viewerId = null } = {}) {
  const want = clampLimit(limit);
  let after = readCursor('feed', FEED_SORT, cursor);
  const reels = [];
  let lastRow = null;
  let exhausted = false;

  for (let pass = 0; pass < REEL_FEED_MAX_PASSES && reels.length < want; pass += 1) {
    const batch = Math.min((want - reels.length) * REEL_FEED_OVERFETCH, REEL_PAGE_MAX * REEL_FEED_OVERFETCH);
    const rows = await reelRepository.findPageByStatus({ status: REEL_STATUS.APPROVED, sortField: 'approvedAt', after, limit: batch });
    if (!rows.length) { exhausted = true; break; }

    const visible = await hydrate(rows, { viewerId });
    // Take rows in order until the page is full; the cursor stops at the last row taken
    // or skipped, so nothing is lost between pages.
    const visibleById = new Map(visible.map((v) => [v.id, v]));
    for (const row of rows) {
      if (reels.length >= want) break;
      lastRow = row;
      const v = visibleById.get(String(row._id));
      if (v) reels.push(v);
    }
    if (rows.length < batch && lastRow === rows[rows.length - 1]) { exhausted = true; break; }
    after = afterClause(FEED_SORT, { value: lastRow.approvedAt, id: lastRow._id });
  }

  const nextCursor = !exhausted && lastRow ? encodeCursor('feed', FEED_SORT, lastRow) : null;
  return { reels, nextCursor };
}

/** One public reel; 404 unless approved with a live product (same rule as the feed). */
export async function getPublicReel(id, { viewerId = null } = {}) {
  const reel = await reelRepository.findById(id);
  if (!reel || reel.status !== REEL_STATUS.APPROVED) throw fail('Reel not found', 404);
  const [shaped] = await hydrate([reel], { viewerId });
  if (!shaped) throw fail('Reel not found', 404);
  return shaped;
}

/** The caller's own reels, any status, with the reject reason. */
export async function listMine({ userId, cursor = null, limit }) {
  const want = clampLimit(limit);
  const after = readCursor('mine', CREATED_SORT, cursor);
  const rows = await reelRepository.findPageByCreator({ creator: userId, after, limit: want });
  const reels = await hydrate(rows, { viewerId: userId, publicOnly: false, withModeration: true });
  const nextCursor = rows.length === want ? encodeCursor('mine', CREATED_SORT, rows[rows.length - 1]) : null;
  return { reels, nextCursor };
}

// ── Create ────────────────────────────────────────────────────────────────────

const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

async function requireLiveProduct(productId) {
  const pid = toObjectId(productId);
  if (!pid) throw fail('Please choose a product for this reel', 400);
  const cards = await productRepository.findReelCardsByIds([pid]);
  if (!cards.has(String(pid))) throw fail('That product is not available', 400);
  return pid;
}

/**
 * Accept an uploaded video as a reel.
 *
 * Idempotent on the asset: the unique `media.publicId` index means a retried or
 * double-tapped submit returns the reel already created for that upload instead of
 * making a second one. Someone else's asset is refused (folder check + this lookup).
 *
 * @param {object} args
 * @param {*}      args.uploaderId  who is calling
 * @param {*}      [args.creatorId] who gets credit (defaults to the uploader; null for an unnamed team upload)
 * @param {boolean} [args.team]     staff upload: team folder, approved immediately
 */
export async function createReel({ uploaderId, creatorId = uploaderId, team = false, publicId, productId, caption }) {
  const product = await requireLiveProduct(productId);
  const folder = reelFolderFor({ userId: uploaderId, team });

  const existing = typeof publicId === 'string' ? await reelRepository.findByPublicId(publicId.trim()) : null;
  if (existing) {
    // Same uploader retrying → their reel. Anyone else → refused, and told nothing about it.
    if (String(existing.uploadedBy) !== String(uploaderId)) {
      throw fail('That upload does not belong to you. Please upload the video again.', 403);
    }
    return { reel: await shapeOwn(existing, uploaderId), created: false };
  }

  const media = await verifyUploadedVideo(publicId, { folder });
  const now = new Date();
  const doc = {
    creator: creatorId ? toObjectId(creatorId) : null,
    uploadedBy: uploaderId,
    source: team ? 'team' : 'customer',
    product,
    media,
    caption: cleanText(caption, REEL_CAPTION_MAX),
    status: team ? REEL_STATUS.APPROVED : REEL_STATUS.PENDING,
    ...(team ? { approvedAt: now, moderatedAt: now, moderatedBy: uploaderId } : {}),
  };

  try {
    const reel = await reelRepository.create(doc);
    return { reel: await shapeOwn(reel, uploaderId), created: true };
  } catch (err) {
    // A concurrent submit of the same upload won the unique index — return its reel.
    if (err?.code === 11000) {
      const winner = await reelRepository.findByPublicId(media.publicId);
      if (winner && String(winner.uploadedBy) === String(uploaderId)) {
        return { reel: await shapeOwn(winner, uploaderId), created: false };
      }
    }
    throw err;
  }
}

async function shapeOwn(reel, viewerId) {
  const [shaped] = await hydrate([reel], { viewerId, publicOnly: false, withModeration: true });
  return shaped;
}

// ── Likes, views, reports ─────────────────────────────────────────────────────

async function requireApproved(id) {
  const reel = await reelRepository.findById(id);
  if (!reel || reel.status !== REEL_STATUS.APPROVED) throw fail('Reel not found', 404);
  return reel;
}

export async function likeReel(id, userId) {
  const reel = await requireApproved(id);
  await reelRepository.like(reel._id, userId);
  return { liked: true, likeCount: await reelRepository.likeCount(reel._id) };
}

export async function unlikeReel(id, userId) {
  const reel = await requireApproved(id);
  await reelRepository.unlike(reel._id, userId);
  return { liked: false, likeCount: await reelRepository.likeCount(reel._id) };
}

export async function reportReel(id, userId, reason) {
  const text = cleanText(reason, REEL_REPORT_REASON_MAX);
  if (!text) throw fail('Please tell us what is wrong with this reel', 400);
  const reel = await reelRepository.findById(id);
  if (!reel || reel.status === REEL_STATUS.REMOVED) throw fail('Reel not found', 404);
  await reelRepository.report(reel._id, userId, text);
  return { reported: true };
}

const hashIp = (ip) => crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 16);

/**
 * Count a view. One per (reel, client IP) per hour. The reel is looked up only when
 * the dedupe key was newly set, so repeat views cost one Redis command and no Mongo read.
 * Redis down → the view is simply not counted; it is never a user-facing error.
 */
export async function recordView(id, ip, { redis = getCounterRedis() } = {}) {
  const reelId = toObjectId(id);
  if (!reelId) throw fail('Reel not found', 404);
  if (!redis) return { counted: false };
  try {
    const fresh = await redis.set(reelViewSeenKey(reelId, hashIp(ip)), '1', 'EX', REEL_VIEW_DEDUPE_SEC, 'NX');
    if (fresh !== 'OK') return { counted: false };
    const reel = await reelRepository.findById(reelId);
    if (!reel || reel.status !== REEL_STATUS.APPROVED) return { counted: false };
    await redis.incr(reelViewKey(reelId));
    return { counted: true };
  } catch (err) {
    console.error('[reels] view counter failed:', err?.message);
    return { counted: false };
  }
}

/** View counts for admin lists. Missing/failed → 0. */
async function viewCounts(ids, redis = getCounterRedis()) {
  if (!redis || !ids.length) return new Map();
  try {
    const vals = await redis.mget(...ids.map((id) => reelViewKey(id)));
    return new Map(ids.map((id, i) => [String(id), Number(vals[i]) || 0]));
  } catch {
    return new Map();
  }
}

// ── Attribution ───────────────────────────────────────────────────────────────

/**
 * A shopper tapped "Add to cart" / "Buy now" on a reel. Who, if anyone, should that
 * credit? Returns the creator's affiliate code to set as the `ab_ref` referral cookie,
 * or null to change nothing.
 *
 * DESIGN DECISION — a reel tap IS an affiliate link click (no new attribution source).
 * The route sets the same `ab_ref` cookie, with the same lifetime, that the storefront
 * sets on `?ref=CODE`. Everything downstream is then the existing, tested path:
 *   - resolveAttribution (order time) runs its full precedence: an affiliate coupon or
 *     a typed affiliate code always beats the cookie — so a typed code beats a reel;
 *   - it re-checks ACTIVE and self-referral against the buyer's resolved identity, so
 *     a guest who later signs in as the creator still credits nobody;
 *   - the cookie never prices a cart — the quote only *suggests* the affiliate's coupon,
 *     exactly as after a link click; what the buyer pays is unchanged unless they apply it.
 * No change to orderService, pricingService, the Order enum or the commission ledger.
 * Trade-off: reports show these sales as source 'link', not 'reel'. Splitting them out
 * later is a reporting change (new ATTRIBUTION_SOURCE + Order enum), not a money change.
 *
 * Checked HERE as well (not only at order time) so we never overwrite a shopper's
 * existing referral cookie with one that would credit nobody.
 */
export async function attributionCodeFor(id, { viewerId = null } = {}) {
  const reel = await reelRepository.findById(id);
  if (!reel || reel.status !== REEL_STATUS.APPROVED || !reel.creator) return null;

  const affiliate = await affiliateRepository.findByUser(reel.creator);
  if (!affiliate || affiliate.status !== AFFILIATE_STATUS.ACTIVE || !affiliate.code) return null;

  if (viewerId) {
    const identity = await resolveBuyerIdentity({ userId: viewerId });
    if (isSelfReferral(affiliate, identity)) return null;
  }
  return affiliate.code;
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export async function adminList({ status, cursor = null, limit }) {
  if (!REEL_STATUSES.includes(status)) throw fail('Unknown status', 400);
  const want = clampLimit(limit, REEL_ADMIN_PAGE_MAX, 20);
  const after = readCursor(`admin:${status}`, CREATED_SORT, cursor);
  const rows = await reelRepository.findPageByStatus({ status, sortField: 'createdAt', after, limit: want });
  const [reels, views] = await Promise.all([
    hydrate(rows, { publicOnly: false, withModeration: true }),
    viewCounts(rows.map((r) => r._id)),
  ]);
  const byId = new Map(rows.map((r) => [String(r._id), r]));
  const withAdminFields = reels.map((r) => {
    const row = byId.get(r.id);
    return {
      ...r,
      rejectReason: row.rejectReason || null,
      reportCount: row.reportCount || 0,
      viewCount: views.get(r.id) || 0,
      source: row.source,
      moderatedAt: row.moderatedAt || null,
      productLive: r.product !== null,
    };
  });
  const nextCursor = rows.length === want ? encodeCursor(`admin:${status}`, CREATED_SORT, rows[rows.length - 1]) : null;
  return { reels: withAdminFields, nextCursor };
}

async function moderate(id, action, set) {
  const updated = await reelRepository.transition(id, REEL_TRANSITIONS[action], set);
  if (updated) return shapeOwn(updated, null);
  const current = await reelRepository.findById(id);
  if (!current) throw fail('Reel not found', 404);
  const verb = { approve: 'approved', reject: 'rejected', remove: 'removed' }[action];
  throw fail(`This reel is ${current.status} and cannot be ${verb}`, 409);
}

export async function approveReel(id, staffId) {
  const now = new Date();
  return moderate(id, 'approve', {
    status: REEL_STATUS.APPROVED, approvedAt: now, moderatedAt: now, moderatedBy: staffId, rejectReason: null,
  });
}

export async function rejectReel(id, staffId, reason) {
  const text = cleanText(reason, REEL_REJECT_REASON_MAX);
  if (!text) throw fail('Please give a reason so the creator knows what to fix', 400);
  return moderate(id, 'reject', {
    status: REEL_STATUS.REJECTED, rejectReason: text, moderatedAt: new Date(), moderatedBy: staffId,
  });
}

export async function removeReel(id, staffId) {
  return moderate(id, 'remove', {
    status: REEL_STATUS.REMOVED, moderatedAt: new Date(), moderatedBy: staffId,
  });
}

/** Team upload: approved immediately, optionally credited to a named customer. */
export async function teamUpload({ staffId, creatorUserId = null, publicId, productId, caption }) {
  let creatorId = null;
  if (creatorUserId) {
    const cid = toObjectId(creatorUserId);
    const [user] = cid ? await userRepository.findDisplayByIds([cid]) : [];
    if (!user) throw fail('That creator account was not found', 400);
    creatorId = cid;
  }
  return createReel({ uploaderId: staffId, creatorId, team: true, publicId, productId, caption });
}

export default {
  listFeed, getPublicReel, listMine, createReel, likeReel, unlikeReel, reportReel, recordView,
  attributionCodeFor, adminList, approveReel, rejectReel, removeReel, teamUpload, toProductBlock, clampLimit,
};

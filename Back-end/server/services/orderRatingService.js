/**
 * Customer rating of the sale and service on a delivered order (1–5 stars,
 * optional comment), credited to the order's salesperson. The sales incentive
 * engine reads the OrderRating collection this writes — see models/orderRatingRepository.js.
 *
 * ── Who can rate ────────────────────────────────────────────────────────────
 * Only the customer, two ways:
 *   1. a signed link in the post-delivery review email (source 'link'), or
 *   2. their own login, on their own order (source 'account').
 * The link is an HMAC over the order id + expiry with a purpose tag, so it
 * cannot be guessed, pointed at another order, or reused as a product-review
 * link (or vice versa). It is sent to the customer's email and never shown in
 * the panel, so the salesperson being rated does not hold one.
 *
 * Staff and admin accounts can never write: the account path rejects them, the
 * link path rejects them when they are signed in, and there is no staff route.
 *
 * ── One rating per order, editable for 7 days ───────────────────────────────
 * The unique index on `order` is the single-use guarantee (holds under two taps
 * at once). A re-submit within EDIT_WINDOW_DAYS of the first rating updates the
 * same record; the update is conditional on the window still being open, so the
 * lock holds even against a request racing the deadline.
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import { ORDER_RATING_COMMENT_MAX } from '../config/orderRatingLimits.js';
import orderRatingRepository from '../repositories/orderRatingRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import userRepository from '../repositories/userRepository.js';

export const EDIT_WINDOW_DAYS = 7;
export const RATING_LINK_TTL_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** Bound on the per-salesperson month summary (one row per salesperson). */
const SUMMARY_LIMIT = 200;

const fail = (message, status, code) => Object.assign(new Error(message), { status, code });

// ── Signed link ─────────────────────────────────────────────────────────────

/**
 * Same secret family as product review links, but a derived key with its own
 * purpose, so a token minted for one can never verify as the other.
 */
const secret = () => process.env.REVIEW_LINK_SECRET || process.env.JWT_SECRET || '';
const PURPOSE = 'order-rating:v1';

const base64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const sign = (body) =>
  base64url(crypto.createHmac('sha256', `${PURPOSE}:${secret()}`).update(body).digest());

/**
 * Keyed hash of a client IP, so a token can carry "where it was created" without
 * the readable token payload exposing the salesperson's IP address.
 */
export const networkHash = (ip) =>
  base64url(crypto.createHmac('sha256', `${PURPOSE}:net:${secret()}`).update(String(ip || '')).digest()).slice(0, 16);

/**
 * @param {string} orderId
 * @param {number} [ttlDays]
 * @param {{ sentBy?: string, net?: string }} [sender] set for a link a salesperson shares
 * @returns {{ token: string, expiresAt: Date }}
 */
export const mintRatingToken = (orderId, ttlDays = RATING_LINK_TTL_DAYS, sender = null) => {
  if (!secret()) throw new Error('[orderRating] REVIEW_LINK_SECRET / JWT_SECRET is not set');
  const expiresAt = new Date(Date.now() + ttlDays * DAY_MS);
  const payload = { k: 'r', o: String(orderId), e: Math.floor(expiresAt.getTime() / 1000) };
  if (sender?.sentBy) Object.assign(payload, { b: String(sender.sentBy), n: sender.net || '' });
  const body = base64url(JSON.stringify(payload));
  return { token: `${body}.${sign(body)}`, expiresAt };
};

/** @returns {{ ok: true, orderId: string, sentBy: string|null, net: string|null } | { ok: false, reason: string }} */
export const readRatingToken = (token) => {
  if (!secret()) return { ok: false, reason: 'unconfigured' };
  const [body, mac, extra] = String(token || '').split('.');
  if (!body || !mac || extra !== undefined) return { ok: false, reason: 'malformed' };
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(String(mac));
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'bad-signature' };
  }
  let p;
  try {
    p = JSON.parse(fromBase64url(body).toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (p?.k !== 'r' || !p.o || !p.e || !mongoose.isValidObjectId(p.o)) return { ok: false, reason: 'malformed' };
  if (p.e * 1000 <= Date.now()) return { ok: false, reason: 'expired' };
  if (p.b !== undefined && !mongoose.isValidObjectId(p.b)) return { ok: false, reason: 'malformed' };
  return { ok: true, orderId: String(p.o), sentBy: p.b ? String(p.b) : null, net: p.b ? String(p.n || '') : null };
};

export const ratingLinkUrl = (token) =>
  `${(process.env.FRONTEND_URL || '').replace(/\/+$/, '')}/rate/${token}`;

/** Mint the email link, or null when no secret is configured (the email then omits the block). */
export const ratingLinkForOrder = (orderId) => {
  try {
    return ratingLinkUrl(mintRatingToken(orderId).token);
  } catch {
    return null;
  }
};

// ── Rules ───────────────────────────────────────────────────────────────────

const isStaffAccount = (user) => user?.role === 'admin' || user?.role === 'staff';

const editableUntil = (rating) => new Date(new Date(rating.createdAt).getTime() + EDIT_WINDOW_DAYS * DAY_MS);

const orderRef = (order) => `AB-${String(order._id).slice(-8).toUpperCase()}`;

const publicView = (rating) => rating && ({
  stars: rating.stars,
  comment: rating.comment || '',
  createdAt: rating.createdAt,
  updatedAt: rating.updatedAt,
  editableUntil: editableUntil(rating),
  locked: editableUntil(rating).getTime() <= Date.now(),
});

const loadOrder = async (orderId) => {
  if (!mongoose.isValidObjectId(orderId)) throw fail('Order not found', 404, 'not-found');
  const order = await orderRepository.findForRating(orderId);
  if (!order) throw fail('Order not found', 404, 'not-found');
  return order;
};

/** Cancelled, returned and not-yet-delivered orders cannot be rated. */
const assertDelivered = (order) => {
  if (order.status !== 'delivered') {
    throw fail('You can rate your order once it has been delivered.', 409, 'not-delivered');
  }
  return order;
};

/**
 * Parse and validate the customer's input. Stars must be a whole number 1–5;
 * the comment is plain text, trimmed, with angle brackets removed (it is only
 * ever rendered as text, this is belt and braces).
 */
export const parseRatingInput = (body = {}) => {
  const raw = body.stars;
  const stars = typeof raw === 'number' ? raw : (/^\d$/.test(String(raw ?? '').trim()) ? Number(raw) : NaN);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw fail('Choose 1 to 5 stars.', 400, 'bad-stars');
  const comment = String(body.comment ?? '').replace(/[<>]/g, '').trim();
  if (comment.length > ORDER_RATING_COMMENT_MAX) {
    throw fail(`Please keep your comment under ${ORDER_RATING_COMMENT_MAX} characters.`, 400, 'comment-too-long');
  }
  return { stars, comment };
};

/** Who may rate this order through the account path. */
const assertOwnOrder = (order, user) => {
  if (isStaffAccount(user)) throw fail('Staff accounts cannot rate orders.', 403, 'staff');
  if (!order.user || String(order.user) !== String(user?._id)) throw fail('Order not found', 404, 'not-found');
};

/** What the rating page needs: order reference and any existing rating. */
const describe = async (order) => {
  const existing = await orderRatingRepository.findOne({ order: order._id }).lean();
  return { orderRef: orderRef(order), rating: publicView(existing) };
};

export async function getForLink(token, viewer = null) {
  const read = readRatingToken(token);
  if (!read.ok) {
    throw read.reason === 'expired'
      ? fail('This rating link has expired.', 410, 'expired')
      : fail('This rating link is not valid.', 400, read.reason);
  }
  if (isStaffAccount(viewer)) throw fail('Staff accounts cannot rate orders.', 403, 'staff');
  return describe(assertDelivered(await loadOrder(read.orderId)));
}

export async function getForAccount(orderId, user) {
  const order = await loadOrder(orderId);
  assertOwnOrder(order, user);
  return { rateable: order.status === 'delivered', ...(await describe(order)) };
}

/**
 * Create the order's rating, or update it inside the edit window.
 * @returns {Promise<{ created: boolean, rating: object }>}
 */
async function upsertRating(order, input, { source, customerId, sentBy = null, sameNetwork = false }) {
  const { stars, comment } = parseRatingInput(input);
  // A same-network edit sets the flag; nothing ever clears it.
  const set = sameNetwork ? { stars, comment, sameNetworkAsSender: true } : { stars, comment };
  const windowStart = new Date(Date.now() - EDIT_WINDOW_DAYS * DAY_MS);

  const tryUpdate = () => orderRatingRepository.findOneAndUpdate(
    { order: order._id, createdAt: { $gt: windowStart } },
    { $set: set, $inc: { editCount: 1 } },
    { new: true, runValidators: true }
  ).lean();

  const existing = await orderRatingRepository.exists({ order: order._id });
  if (existing) {
    const updated = await tryUpdate();
    if (!updated) throw fail('Your rating is locked — it can only be changed within 7 days.', 409, 'locked');
    return { created: false, rating: publicView(updated) };
  }

  try {
    const created = await orderRatingRepository.create({
      order: order._id,
      salesperson: order.salesUser || null,
      stars,
      comment,
      source,
      customer: customerId || null,
      ...(sentBy && { sentBy, sameNetworkAsSender: !!sameNetwork }),
    });
    return { created: true, rating: publicView(created.toObject()) };
  } catch (err) {
    // Two submits at once: the other one created it. Fall through to an edit.
    if (err?.code !== 11000) throw err;
    const updated = await tryUpdate();
    if (!updated) throw fail('Your rating is locked — it can only be changed within 7 days.', 409, 'locked');
    return { created: false, rating: publicView(updated) };
  }
}

export async function submitByLink(token, input, viewer = null, clientIp = '') {
  const read = readRatingToken(token);
  if (!read.ok) {
    throw read.reason === 'expired'
      ? fail('This rating link has expired.', 410, 'expired')
      : fail('This rating link is not valid.', 400, read.reason);
  }
  if (isStaffAccount(viewer)) throw fail('Staff accounts cannot rate orders.', 403, 'staff');
  const order = assertDelivered(await loadOrder(read.orderId));
  if (read.sentBy) {
    return upsertRating(order, input, {
      source: 'salesperson-link',
      customerId: null,
      sentBy: read.sentBy,
      sameNetwork: !!read.net && read.net === networkHash(clientIp),
    });
  }
  return upsertRating(order, input, { source: 'link', customerId: null });
}

export async function submitByAccount(orderId, input, user) {
  const order = await loadOrder(orderId);
  assertOwnOrder(order, user);
  assertDelivered(order);
  return upsertRating(order, input, { source: 'account', customerId: user._id });
}

// ── Panel (read only) ───────────────────────────────────────────────────────

const isAdmin = (u) => u?.role === 'admin';
const isActiveHead = (u) => u?.role === 'staff' && u.staff?.active === true && u.staff.isHead === true;

/**
 * Admins and the GTM (sales) head. Other teams' heads manage no salespeople,
 * so the monthly page is theirs to neither see nor reach (owner's call, 2026-11-12).
 * Anyone else gets 403.
 */
export const canViewRatings = (u) => isAdmin(u) || (isActiveHead(u) && u.staff.team === 'sales');

const assertViewer = (actor) => {
  if (!canViewRatings(actor)) throw fail('Only admins and the GTM head can see ratings.', 403, 'forbidden');
};

/** A head sees ratings for salespeople in their own team; admin sees all. */
const headTeamMemberIds = (actor) => userRepository.findTeamMemberIds(actor.staff.team);

const isActiveStaff = (u) => u?.role === 'staff' && u.staff?.active === true;

/**
 * What this panel user may do with one order's rating:
 *   see    — admin, or a head of the salesperson's team
 *   share  — admin, that head, or the order's own salesperson; offline orders only
 */
async function panelAccess(actor, order) {
  const sellerId = order.salesUser ? String(order.salesUser) : null;
  let sellerTeam = null;
  if (sellerId && isActiveHead(actor)) {
    sellerTeam = (await userRepository.findById(sellerId))?.staff?.team || null;
  }
  const headOfSeller = isActiveHead(actor) && !!sellerTeam && sellerTeam === actor.staff.team;
  const ownSeller = isActiveStaff(actor) && !!sellerId && sellerId === String(actor._id);
  const see = isAdmin(actor) || headOfSeller;
  const mayShare = (see || ownSeller) && order.source === 'offline';
  return { see, mayShare, any: see || ownSeller };
}

/**
 * The panel's view of one order: the rating (admins and heads only) and whether
 * this user can send the customer a rating link (offline, delivered, not yet rated).
 */
export async function getOrderRatingForPanel(actor, orderId) {
  const order = await loadOrder(orderId);
  const access = await panelAccess(actor, order);
  if (!access.any) throw fail('Only admins, team heads and the salesperson can see this.', 403, 'forbidden');

  const rating = await orderRatingRepository.findOne({ order: order._id })
    .populate('salesperson', 'name').populate('sentBy', 'name').lean();
  return {
    rating: access.see && rating ? {
      stars: rating.stars,
      comment: rating.comment || '',
      source: rating.source,
      createdAt: rating.createdAt,
      updatedAt: rating.updatedAt,
      editCount: rating.editCount || 0,
      salesperson: rating.salesperson ? { id: String(rating.salesperson._id), name: rating.salesperson.name || '' } : null,
      sentBy: rating.sentBy ? { id: String(rating.sentBy._id), name: rating.sentBy.name || '' } : null,
      sameNetworkAsSender: rating.sameNetworkAsSender === true,
    } : null,
    rated: !!rating,
    canShareLink: access.mayShare && order.status === 'delivered' && !rating,
  };
}

/**
 * Create a rating link for a salesperson to send the customer on WhatsApp.
 * Offline orders only (website orders get theirs by email), delivered, and not
 * already rated. The link records who created it and a hash of their network,
 * so a rating sent from that same connection is flagged in the panel.
 */
export async function createShareLink(actor, orderId, clientIp = '') {
  const order = await loadOrder(orderId);
  const access = await panelAccess(actor, order);
  if (!access.any) throw fail('Only admins, team heads and the salesperson can do this.', 403, 'forbidden');
  if (order.source !== 'offline') {
    throw fail('Website orders get their rating link by email. Links are only for offline orders.', 409, 'not-offline');
  }
  if (!access.mayShare) throw fail('Only admins, team heads and the salesperson can do this.', 403, 'forbidden');
  assertDelivered(order);
  if (await orderRatingRepository.exists({ order: order._id })) {
    throw fail('The customer has already rated this order.', 409, 'already-rated');
  }
  const { token, expiresAt } = mintRatingToken(String(order._id), RATING_LINK_TTL_DAYS, {
    sentBy: String(actor._id),
    net: networkHash(clientIp),
  });
  const url = ratingLinkUrl(token);
  const name = String(order.shippingAddress?.fullName || '').trim().split(/\s+/)[0] || 'there';
  const message = `Hi ${name}, thank you for buying from us! How was your experience with our team? `
    + `Please rate us here (takes 10 seconds): ${url}`;
  const digits = String(order.shippingAddress?.phone || '').replace(/\D/g, '');
  const phone = digits.length === 10 ? `91${digits}` : digits;
  return {
    url,
    expiresAt,
    message,
    whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
  };
}

/** India-time month bounds for 'YYYY-MM'. */
export const istMonthRange = (month) => {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month || ''));
  if (!m) throw fail('month must look like 2026-11', 400, 'bad-month');
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return {
    from: new Date(Date.UTC(y, mo, 1) - IST_OFFSET_MS),
    to: new Date(Date.UTC(y, mo + 1, 1) - IST_OFFSET_MS),
  };
};

/**
 * Per-salesperson rating count and average for one India-time month, by the
 * date the rating was first given. Orders with no salesperson are left out.
 */
export async function monthlySummary(actor, month) {
  assertViewer(actor);
  const { from, to } = istMonthRange(month);
  const match = { createdAt: { $gte: from, $lt: to }, salesperson: { $type: 'objectId' } };
  if (!isAdmin(actor)) match.salesperson = { $in: await headTeamMemberIds(actor) };

  const rows = await orderRatingRepository.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$salesperson',
        count: { $sum: 1 },
        average: { $avg: '$stars' },
        low: { $sum: { $cond: [{ $lte: ['$stars', 2] }, 1, 0] } },
        // Rated from the network the salesperson made the link on — check these.
        flagged: { $sum: { $cond: [{ $eq: ['$sameNetworkAsSender', true] }, 1, 0] } },
      },
    },
    { $sort: { average: -1, count: -1 } },
    { $limit: SUMMARY_LIMIT },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u', pipeline: [{ $project: { name: 1, 'staff.team': 1 } }] } },
  ]);

  return {
    month,
    rows: rows.map((r) => ({
      salesperson: { id: String(r._id), name: r.u?.[0]?.name || 'Unknown', team: r.u?.[0]?.staff?.team || '' },
      count: r.count,
      average: Math.round(r.average * 100) / 100,
      low: r.low,
      flagged: r.flagged,
    })),
  };
}

export default {
  mintRatingToken, readRatingToken, ratingLinkUrl, ratingLinkForOrder, parseRatingInput,
  getForLink, getForAccount, submitByLink, submitByAccount,
  canViewRatings, getOrderRatingForPanel, createShareLink, monthlySummary, istMonthRange, networkHash,
};

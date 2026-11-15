/**
 * Google review bonus — a salesperson sends a screenshot of a customer's Google
 * review; the marketing head or an admin checks it and verifies it with points
 * (credited to Roav Points) or rejects it.
 *
 * Who may do what (all checked here, never on the screen):
 *   submit   — an active GTM (sales team) member.
 *   review   — an admin, or the marketing head (active staff, team 'marketing',
 *              `staff.isHead`). Never on their own submission.
 *   see      — the submitter (their own), and the reviewers (everything).
 *
 * Money rules (same as the Roav Points engine, services/incentives/):
 *   - The ledger is append-only. Each change writes ONE row keyed
 *     `review:<submission>:v<new version>`; the unique key makes a retry a no-op.
 *   - Points changed → a row for the difference. Unverified → a row for minus
 *     everything credited. A past row is never touched.
 *   - A row lands in the credit month while that month is open, otherwise in
 *     the first open month from now (a locked month is never written to).
 *   - The submission update and the ledger row commit in ONE transaction, with
 *     a compare-and-set on `version`, so two clicks or two reviewers give one
 *     result and the two can never disagree.
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import * as reviews from '../repositories/googleReviewRepository.js';
import { insertLedgerRowInSession, reviewRowsOf } from '../repositories/incentiveRepository.js';
import orderRepository from '../repositories/orderRepository.js';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import { normalizePhone } from '../utils/identity.js';
import { checkAttachments } from './storage/attachmentCheck.js';
import { putPrivateAsset, deletePrivateAsset, readPrivateAsset, resourceTypeFor } from './storage/privateUploads.js';
import { rulesForMonth } from './incentives/ruleService.js';
import { monthStatusCache } from './incentives/ledgerService.js';
import { monthOf } from './incentives/months.js';
import { googleReviewRulesOf } from '../config/incentiveDefaults.js';
import { STAFF_TEAMS } from '../config/staff.js';

export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
export const SCREENSHOT_FOLDER = 'google-reviews'; // a PRIVATE prefix (storage/assetScope.js)
const MAX_NOTES = 1000;
const MAX_REASON = 500;
const MAX_NAME = 100;
const MAX_HISTORY = 100;
const PAGE = 20;
const MAX_PAGE = 50;
export const COMPONENT = 'review';
export const LEDGER_LABEL = 'Google review bonus';

const fail = (message, status = 400) => new AppError(message, status, { expose: true });
const idOf = (v) => (v?._id ? String(v._id) : v ? String(v) : null);

// ── Who may do what ──────────────────────────────────────────────────────────

const activeStaff = (u) => u?.role === 'staff' && u.staff?.active === true;
export const isMarketingHead = (u) => activeStaff(u) && u.staff.team === STAFF_TEAMS.MARKETING && u.staff.isHead === true;
export const mayReview = (u) => u?.role === 'admin' || isMarketingHead(u);
export const maySubmit = (u) => activeStaff(u) && u.staff.team === STAFF_TEAMS.SALES;

// ── Small parsers ────────────────────────────────────────────────────────────

const intIn = (v, min, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const oneLine = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const nameKey = (name) => oneLine(name, MAX_NAME).toLowerCase();
const orderRefOf = (o) => (o.wpId ? `#${o.wpId}` : `#${String(o._id).slice(-8).toUpperCase()}`);

/** The Google review settings for the month a change would land in now. */
export async function reviewPolicy(now = new Date()) {
  const { rules } = await rulesForMonth(monthOf(now));
  return googleReviewRulesOf(rules);
}

/** "#12345" (website order number) or a full order id → the order, or a 400. */
async function resolveOrder(ref, actor) {
  const raw = String(ref ?? '').trim();
  if (!raw) return null;
  const FIELDS = '_id wpId salesUser';
  let order = null;
  const num = /^#?(\d{1,10})$/.exec(raw);
  const Order = orderRepository.model;
  if (num) order = await Order.findOne({ wpId: Number(num[1]) }).select(FIELDS).lean();
  if (!order && /^[a-f0-9]{24}$/i.test(raw)) order = await Order.findById(raw).select(FIELDS).lean();
  // "#1A2B3C4D" — the number our own (non-WooCommerce) orders show: the id's last
  // 8 characters. Not indexable on its own, so it is looked up among this
  // salesperson's recent orders (index on salesUser).
  const tail = /^#?([a-f0-9]{8})$/i.exec(raw);
  if (!order && tail) {
    const mine = await Order.find({ salesUser: actor._id }).select(FIELDS).sort({ createdAt: -1 }).limit(1000).lean();
    order = mine.find((o) => String(o._id).slice(-8).toLowerCase() === tail[1].toLowerCase()) || null;
  }
  if (!order) throw fail('That order was not found. Type the order number, like #12345, or leave it empty.');
  // A review on an order credited to someone else is that person's to claim.
  if (order.salesUser && idOf(order.salesUser) !== idOf(actor._id)) {
    throw fail('That order is credited to another salesperson, so you cannot claim its review.');
  }
  return order;
}

const DUP_MESSAGES = {
  s: 'This screenshot was already sent.',
  p: 'A review from this customer\'s phone number was already sent.',
  o: 'A review for this order was already sent.',
  n: 'A review from a customer with this name was already sent. Add their phone number or order to tell them apart.',
};

async function duplicateMessage(dupKeys, excludeId = null) {
  const other = await reviews.findLiveDuplicate(dupKeys, excludeId);
  if (!other) return null;
  const hit = dupKeys.find((k) => other.dupKeys.includes(k));
  const base = DUP_MESSAGES[hit?.[0]] || 'This review was already sent.';
  return `${base}${other.submittedByName ? ` (sent by ${other.submittedByName})` : ''}`;
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export const screenshotPath = (id) => `/api/v1/google-reviews/${id}/screenshot`;

export function shape(doc) {
  return {
    id: String(doc._id),
    status: doc.status,
    submittedBy: { id: idOf(doc.submittedBy), name: doc.submittedByName || '' },
    customerName: doc.customerName || '',
    customerPhone: doc.customerPhone || '',
    orderId: idOf(doc.order),
    orderNumber: doc.orderNumber || '',
    claimedStars: doc.claimedStars ?? null,
    notes: doc.notes || '',
    stars: doc.stars ?? null,
    points: doc.status === 'verified' ? doc.points : 0,
    creditMonth: doc.creditMonth || null,
    reason: doc.reason || '',
    reviewedByName: doc.reviewedByName || '',
    reviewedAt: doc.reviewedAt || null,
    createdAt: doc.createdAt,
    version: doc.version,
    screenshotUrl: screenshotPath(doc._id),
    history: (doc.history || []).map((h) => ({
      action: h.action, at: h.at, byName: h.byName || '', stars: h.stars ?? null, points: h.points ?? null,
      deltaPoints: h.deltaPoints ?? null, month: h.month || null, reason: h.reason || '',
    })),
  };
}

// ── Submit ───────────────────────────────────────────────────────────────────

const removeScreenshot = (ref) => deletePrivateAsset({
  publicId: ref.publicId, provider: ref.provider, resourceType: resourceTypeFor(ref.contentType),
}).catch(() => {});

/**
 * @param {object} input { customerName, customerPhone, orderRef, claimedStars, notes, submitId }
 * @param {object} file  multer file (field `screenshot`)
 */
export async function submit(actor, input = {}, file, req) {
  if (!maySubmit(actor)) throw fail('Only the GTM team can send Google reviews.', 403);
  const submitId = String(input.submitId || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(submitId)) throw fail('Refresh the page and try again.');

  // A retry of a submit that already went through: the same answer, nothing new.
  const again = await reviews.findBySubmitId(actor._id, submitId);
  if (again) return { review: shape(again), created: false };

  const customerName = oneLine(input.customerName, MAX_NAME);
  const phoneRaw = oneLine(input.customerPhone, 30);
  const customerPhone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && (!customerPhone || customerPhone.length !== 10)) throw fail('Enter the customer\'s 10-digit mobile number, or leave it empty.');
  if (!customerPhone && customerName.length < 2) throw fail('Enter the customer\'s name or phone number.');
  const notes = String(input.notes ?? '').trim().slice(0, MAX_NOTES);
  let claimedStars = null;
  if (input.claimedStars !== undefined && input.claimedStars !== null && input.claimedStars !== '') {
    claimedStars = intIn(input.claimedStars, 1, 5);
    if (!claimedStars) throw fail('Stars must be 1 to 5.');
  }

  if (!file?.buffer?.length) throw fail('Attach a screenshot of the Google review.');
  if (file.buffer.length > SCREENSHOT_MAX_BYTES) throw fail('The screenshot is too large (5 MB maximum).');
  const [checked] = checkAttachments([file], { allowPdf: false, max: 1, noun: 'screenshot' });

  const order = await resolveOrder(input.orderRef, actor);
  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const dupKeys = [`s:${sha256}`];
  if (customerPhone) dupKeys.push(`p:${customerPhone}`);
  if (order) dupKeys.push(`o:${order._id}`);
  if (!customerPhone && !order) dupKeys.push(`n:${nameKey(customerName)}`);

  // Checked again by the unique index on insert; this saves storing a file that would be removed.
  const dup = await duplicateMessage(dupKeys);
  if (dup) throw fail(dup, 409);

  const ref = await putPrivateAsset({
    buffer: file.buffer,
    folder: SCREENSHOT_FOLDER,
    basename: `review-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${checked.ext}`,
    contentType: checked.contentType,
    cloudinaryPrivate: true,
  });
  const screenshot = { publicId: ref.publicId, provider: ref.provider, url: ref.url || '', contentType: checked.contentType, bytes: ref.bytes, sha256 };
  const now = new Date();
  let doc;
  try {
    doc = await reviews.create({
      submittedBy: actor._id, submittedByName: actor.name || '', submitId,
      customerName, customerPhone: customerPhone || '', order: order?._id || null, orderNumber: order ? orderRefOf(order) : '',
      claimedStars, notes, screenshot, status: 'pending', active: true, dupKeys,
      history: [{ action: 'submitted', at: now, by: actor._id, byName: actor.name || '', stars: claimedStars }],
    });
  } catch (err) {
    await removeScreenshot(screenshot);
    if (err?.code !== 11000) throw err;
    // Lost to our own double-click (same submitId) or to a duplicate sent at the same moment.
    const mine = await reviews.findBySubmitId(actor._id, submitId);
    if (mine) return { review: shape(mine), created: false };
    throw fail((await duplicateMessage(dupKeys)) || 'This review was already sent.', 409);
  }

  auditLogger.logAction(req, 'CREATE', 'GoogleReviewSubmission', String(doc._id), {
    customerPhone: customerPhone ? `…${customerPhone.slice(-4)}` : undefined, order: order ? orderRefOf(order) : undefined, claimedStars,
  });
  return { review: shape(doc.toObject()), created: true };
}

// ── Review (verify / change points / reject / unverify) ──────────────────────

/**
 * Run one change as a transaction: read, decide, compare-and-set the submission
 * on `version`, write the ledger row. `decide(doc)` returns null for "nothing to
 * do" (the same change already happened) or { set, history, deltaCenti }.
 */
async function change(actor, id, expectedVersion, decide, now) {
  if (!mongoose.isValidObjectId(id)) throw fail('Review not found.', 404);
  const expected = intIn(expectedVersion, 0, 1e9);
  if (expected === null) throw fail('Refresh the page and try again.');

  const months = monthStatusCache();
  let result = null;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      result = null;
      const doc = await reviews.findById(id, '', session);
      if (!doc) throw fail('Review not found.', 404);
      if (idOf(doc.submittedBy) === idOf(actor._id)) throw fail('You cannot check your own review. Ask the marketing head or an admin.', 403);

      const plan = await decide(doc);
      if (!plan) { result = { doc, changed: false }; return; }
      if (doc.version !== expected) throw fail('Someone else just changed this review. Refresh to see the latest.', 409);

      const version = doc.version + 1;
      let month = null;
      if (plan.deltaCenti !== 0) {
        // The first credit belongs to the month the review was sent in; later
        // changes to the month of that first credit — each only while open.
        const home = doc.creditMonth || monthOf(doc.createdAt);
        month = await months.landing(home, now);
        const { version: rulesVersion } = await rulesForMonth(month);
        await insertLedgerRowInSession({
          key: `review:${doc._id}:v${version}`,
          type: plan.deltaCenti > 0 ? 'earn' : 'reverse',
          month,
          earnerKey: `u:${doc.submittedBy}`, earnerUser: doc.submittedBy, earnerName: doc.submittedByName || '', share: 1,
          order: null, review: doc._id, orderNumber: doc.orderNumber || '', rev: version, lineId: null, component: COMPONENT,
          centi: plan.deltaCenti, flatCenti: plan.deltaCenti, rulesVersion,
          inputs: { label: LEDGER_LABEL, stars: plan.set.stars ?? doc.stars, points: plan.set.points ?? 0, customerName: doc.customerName || '', review: String(doc._id), earnMonth: home },
          eventAt: now,
          reverses: plan.deltaCenti < 0 ? `review:${doc._id}` : null,
          reason: plan.reason,
        }, session);
      }
      const set = {
        ...plan.set, version, reviewedBy: actor._id, reviewedByName: actor.name || '', reviewedAt: now,
        ...(month && !doc.creditMonth ? { creditMonth: month } : {}),
      };
      const entry = { ...plan.history, at: now, by: actor._id, byName: actor.name || '', month };
      const updated = await reviews.updateIfVersion(
        doc._id, doc.version,
        { $set: set, $push: { history: { $each: [entry], $slice: -MAX_HISTORY } } },
        session,
      );
      if (!updated) throw fail('Someone else just changed this review. Refresh to see the latest.', 409);
      result = { doc: updated, changed: true, action: plan.history.action, deltaCenti: plan.deltaCenti, month };
    });
  } catch (err) {
    if (err?.code === 11000 && /google_review_dup_active|dupKeys/.test(String(err.message))) {
      const doc = await reviews.findById(id, 'dupKeys');
      throw fail(`${(doc && await duplicateMessage(doc.dupKeys, doc._id)) || 'Another live submission is for the same review.'} Reject that one first.`, 409);
    }
    // The ledger key already taken: another change got in first.
    if (err?.code === 11000) throw fail('Someone else just changed this review. Refresh to see the latest.', 409);
    throw err;
  } finally {
    await session.endSession();
  }
  return result;
}

/** Verify (from pending or rejected) or change the points of a verified review. */
export async function verify(actor, id, { stars, points, expectedVersion } = {}, req, now = new Date()) {
  if (!mayReview(actor)) throw fail('Only the marketing head or an admin can verify Google reviews.', 403);
  const policy = await reviewPolicy(now);
  const s = intIn(stars, 1, 5);
  if (!s) throw fail('Count the stars on the screenshot: 1 to 5.');
  const p = intIn(points, 1, policy.maxPoints);
  if (!p) throw fail(`Points must be a whole number from 1 to ${policy.maxPoints}. To give none, reject the review instead.`);

  const res = await change(actor, id, expectedVersion, (doc) => {
    if (doc.status === 'verified' && doc.points === p && doc.stars === s) return null; // already so
    const deltaCenti = p * 100 - (doc.creditedCenti || 0);
    const action = doc.status === 'verified' ? 'points_changed' : 'verified';
    return {
      set: { status: 'verified', active: true, stars: s, points: p, creditedCenti: p * 100, reason: '' },
      history: { action, stars: s, points: p, deltaPoints: deltaCenti / 100 },
      deltaCenti,
      reason: action === 'points_changed' ? 'review_adjust' : null,
    };
  }, now);

  if (res.changed) {
    auditLogger.logAction(req, 'UPDATE', 'GoogleReviewSubmission', id, {
      change: res.action, stars: s, points: p, deltaPoints: res.deltaCenti / 100, month: res.month,
    });
  }
  return { review: shape(res.doc), changed: res.changed };
}

/** Reject a pending review, or unverify a verified one (its points are reversed). */
export async function reject(actor, id, { reason, expectedVersion } = {}, req, now = new Date()) {
  if (!mayReview(actor)) throw fail('Only the marketing head or an admin can reject Google reviews.', 403);
  const why = oneLine(reason, MAX_REASON);
  if (why.length < 3) throw fail('Write the reason, so the salesperson knows what was wrong.');

  const res = await change(actor, id, expectedVersion, (doc) => {
    if (doc.status === 'rejected') return null; // already so
    const deltaCenti = -(doc.creditedCenti || 0);
    const action = doc.status === 'verified' ? 'unverified' : 'rejected';
    return {
      set: { status: 'rejected', active: false, points: 0, creditedCenti: 0, reason: why },
      history: { action, reason: why, points: 0, deltaPoints: deltaCenti ? deltaCenti / 100 : null },
      deltaCenti,
      reason: 'review_unverified',
    };
  }, now);

  if (res.changed) {
    auditLogger.logAction(req, 'UPDATE', 'GoogleReviewSubmission', id, {
      change: res.action, reason: why, deltaPoints: res.deltaCenti / 100, month: res.month,
    });
  }
  return { review: shape(res.doc), changed: res.changed };
}

// ── Reads ────────────────────────────────────────────────────────────────────

const STATUSES = ['pending', 'verified', 'rejected'];

async function page(filter, { cursor, limit }) {
  const size = Math.min(Math.max(Number(limit) || PAGE, 1), MAX_PAGE);
  const q = { ...filter };
  if (cursor) {
    if (!mongoose.isValidObjectId(cursor)) throw fail('Invalid cursor');
    q._id = { $lt: new mongoose.Types.ObjectId(String(cursor)) };
  }
  const rows = await reviews.page(q, size + 1);
  const more = rows.length > size;
  const items = more ? rows.slice(0, size) : rows;
  return { reviews: items.map(shape), nextCursor: more ? String(items[items.length - 1]._id) : null };
}

const statusFilter = (status) => {
  if (!status || status === 'all') return {};
  if (!STATUSES.includes(status)) throw fail('Unknown status');
  return { status };
};

/** My own submissions, newest first. */
export async function listMine(actor, query = {}) {
  if (!maySubmit(actor)) throw fail('Only the GTM team sends Google reviews.', 403);
  return page({ submittedBy: actor._id, ...statusFilter(query.status) }, query); // google_review_by_person
}

/** Every submission (reviewers), newest first, with the pending count for the tab badge. */
export async function listAll(actor, query = {}) {
  if (!mayReview(actor)) throw fail('Only the marketing head or an admin can see all Google reviews.', 403);
  const filter = statusFilter(query.status); // google_review_status, or _id for "all"
  if (query.person) {
    if (!mongoose.isValidObjectId(query.person)) throw fail('Invalid person');
    filter.submittedBy = new mongoose.Types.ObjectId(String(query.person));
  }
  const [result, pendingCount] = await Promise.all([
    page(filter, query),
    reviews.countPending(),
  ]);
  return { ...result, pendingCount };
}

async function loadVisible(actor, id, select = '') {
  if (!mongoose.isValidObjectId(id)) throw fail('Review not found.', 404);
  const doc = await reviews.findById(id, select);
  if (!doc) throw fail('Review not found.', 404);
  if (!mayReview(actor) && idOf(doc.submittedBy) !== idOf(actor._id)) throw fail('Review not found.', 404);
  return doc;
}

export async function getOne(actor, id) {
  return shape(await loadVisible(actor, id, '-dupKeys -submitId'));
}

/** The screenshot bytes, streamed through us — never a public link. */
export async function getScreenshot(actor, id) {
  const doc = await loadVisible(actor, id, 'submittedBy screenshot');
  const f = doc.screenshot;
  const buffer = await readPrivateAsset(f, async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Screenshot fetch failed: ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  });
  return { buffer, contentType: f.contentType };
}

/** My month's Google review bonus rows (for the Roav Points statement). */
export async function myReviewRows(month, earnerKey, limit = 200) {
  const rows = await reviewRowsOf(month, earnerKey, limit);
  return rows.map((r) => ({
    id: String(r._id), review: idOf(r.review), type: r.type, points: r.centi / 100, reason: r.reason || null,
    at: r.eventAt, stars: r.inputs?.stars ?? null, customerName: r.inputs?.customerName || '',
    orderNumber: r.orderNumber || '', earnMonth: r.inputs?.earnMonth || null,
  }));
}

export default { submit, verify, reject, listMine, listAll, getOne, getScreenshot, reviewPolicy, myReviewRows, mayReview, maySubmit, isMarketingHead };

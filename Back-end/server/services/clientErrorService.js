import mongoose from 'mongoose';
import ClientError from '../repositories/clientErrorRepository.js';
import {
  CLIENT_ERROR_FEATURE_VALUES,
  CLIENT_ERROR_LIMITS as L,
  CLIENT_ERROR_STATUSES,
  CLIENT_ERROR_STATUS_VALUES,
  MARKETING_CLIENT_ERROR_FEATURES,
} from '../config/clientErrors.js';
import { and, istRange, keysetPage, plainQuery, searchClauses, searchWords } from '../utils/listQuery.js';

/**
 * Customer-facing website errors: the write path (best-effort, bounded) and the
 * panel reads.
 *
 * Why the database cannot blow up:
 *   1. one document per DIFFERENT error (unique `signature`); repeats are a $inc;
 *   2. each document keeps the last few samples ($push … $slice), so it has a fixed size;
 *   3. past `maxRecords` different errors, new ones are not created — known ones still count;
 *   4. writes per error per minute are capped in this process: extra hits are added to
 *      the NEXT write's $inc instead of being written one by one;
 *   5. every record expires `retentionDays` after it last happened (TTL on expireAt).
 * Worst case ≈ maxRecords × (3 samples × ~5 KB) ≈ 30 MB.
 *
 * The per-minute caps are per app instance (in memory, no Redis round-trip on the hot
 * path). With N instances the ceiling is N× — still bounded, and the per-IP rate limit
 * on the route sits in front of all of it.
 */

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const WINDOW_MAP_CAP = 5000;
const RECORD_COUNT_TTL = MINUTE;

// signature → { start, writes, pending }
const windows = new Map();
let globalWindow = { start: 0, writes: 0 };
let recordCount = { at: 0, value: 0 };

/** Test seam: forget the in-memory throttles. */
export function resetClientErrorThrottle() {
  windows.clear();
  globalWindow = { start: 0, writes: 0 };
  recordCount = { at: 0, value: 0 };
}

/**
 * How many occurrences this write should count, or 0 to skip the write (counted
 * into a later one). Pure bookkeeping, no I/O.
 */
export function claimWrite(signature, now = Date.now()) {
  if (now - globalWindow.start >= MINUTE) globalWindow = { start: now, writes: 0 };

  let w = windows.get(signature);
  if (!w || now - w.start >= MINUTE) {
    if (!w && windows.size >= WINDOW_MAP_CAP) {
      for (const [k, v] of windows) if (now - v.start >= MINUTE) windows.delete(k);
      if (windows.size >= WINDOW_MAP_CAP) windows.clear();
    }
    w = { start: now, writes: 0, pending: w?.pending || 0 };
    windows.set(signature, w);
  }
  if (w.writes >= L.writesPerSignaturePerMinute || globalWindow.writes >= L.writesPerMinute) {
    w.pending += 1;
    return 0;
  }
  w.writes += 1;
  globalWindow.writes += 1;
  const inc = 1 + w.pending;
  w.pending = 0;
  return inc;
}

async function atRecordCeiling(now) {
  if (now - recordCount.at > RECORD_COUNT_TTL) {
    recordCount = { at: now, value: await ClientError.estimatedDocumentCount() };
  }
  return recordCount.value >= L.maxRecords;
}

/**
 * Stores one cleaned report (utils/clientErrorScrub.js `cleanReport`). Never throws:
 * a failure to record an error must not become a second error.
 *
 * @returns {Promise<'stored'|'batched'|'dropped'|'failed'>}
 */
export async function recordClientError(report, { userId = null, now = new Date() } = {}) {
  try {
    const inc = claimWrite(report.signature, now.getTime());
    if (!inc) return 'batched';

    const sample = {
      at: now,
      url: report.path,
      message: report.message,
      stack: report.stack,
      browser: report.browser,
      os: report.os,
      device: report.device,
      release: report.release,
      user: userId,
      orderId: report.orderId,
      ...(report.context ? { context: report.context } : {}),
    };
    const update = {
      $setOnInsert: {
        feature: report.feature,
        step: report.step,
        level: report.level,
        name: report.name,
        message: report.message,
        path: report.path,
        firstSeenAt: now,
        status: CLIENT_ERROR_STATUSES.OPEN,
      },
      $inc: { count: inc },
      $set: {
        lastSeenAt: now,
        expireAt: new Date(now.getTime() + L.retentionDays * DAY),
        ...(report.release ? { lastRelease: report.release } : {}),
      },
      $push: { samples: { $each: [sample], $slice: -L.samples } },
    };

    const upsert = !(await atRecordCeiling(now.getTime()));
    let res;
    try {
      res = await ClientError.updateOne({ signature: report.signature }, update, { upsert });
    } catch (err) {
      // Two first reports of a new error raced on the unique index: the other one
      // created it, so this one is an ordinary update.
      if (err?.code !== 11000) throw err;
      res = await ClientError.updateOne({ signature: report.signature }, update);
    }
    if (!res.matchedCount && !res.upsertedCount) return 'dropped';
    if (res.upsertedCount) recordCount.value += 1;

    // A resolved error that happens again was not fixed: reopen it. Matches nothing
    // (and writes nothing) for an open error.
    await ClientError.updateOne(
      { signature: report.signature, status: CLIENT_ERROR_STATUSES.RESOLVED, resolvedAt: { $lt: now } },
      { $set: { status: CLIENT_ERROR_STATUSES.OPEN, reopenedAt: now } },
    );
    return 'stored';
  } catch (err) {
    console.error(`[client-errors] could not record ${report?.feature}/${report?.step}: ${err?.message}`);
    return 'failed';
  }
}

// ── Panel reads ───────────────────────────────────────────────────────────────

export const CLIENT_ERROR_SORTS = Object.freeze({
  recent: { field: 'lastSeenAt', dir: -1, type: 'date' },
});
const PAGE_SIZE = 25;
const SEARCH_FIELDS = ['message', 'path', 'step', 'name'];

/**
 * Which features this person may read, and whether they may change status.
 * Admin and the developer (DevOps) team: everything, and resolve. Marketing:
 * payments, checkout and careers, read only. Anyone else: nothing.
 */
export function clientErrorAccess(user) {
  if (user?.role === 'admin') return { features: CLIENT_ERROR_FEATURE_VALUES, canResolve: true };
  if (user?.role === 'staff' && user.staff?.active === true) {
    if (user.staff.team === 'developer') return { features: CLIENT_ERROR_FEATURE_VALUES, canResolve: true };
    if (user.staff.team === 'marketing') return { features: MARKETING_CLIENT_ERROR_FEATURES, canResolve: false };
  }
  return null;
}

const LIST_PROJECTION = {
  signature: 0, samples: 0, expireAt: 0, __v: 0,
};

export async function listClientErrors(rawQuery, access) {
  const f = plainQuery(rawQuery);
  const features = f.feature && access.features.includes(f.feature) ? [f.feature] : access.features;
  const status = CLIENT_ERROR_STATUS_VALUES.includes(f.status) ? f.status : null;
  const seen = istRange(f.from, f.to);
  const query = and(
    features.length === CLIENT_ERROR_FEATURE_VALUES.length ? {} : { feature: { $in: features } },
    status ? { status } : {},
    seen ? { lastSeenAt: seen } : {},
    searchClauses(searchWords(f.q), SEARCH_FIELDS),
  );
  const page = await keysetPage({
    query,
    sorts: CLIENT_ERROR_SORTS,
    sortName: 'recent',
    cursor: f.cursor,
    pageSize: PAGE_SIZE,
    find: (q, { sort, limit }) => ClientError.find(q, LIST_PROJECTION).sort(sort).limit(limit).lean(),
  });
  return { errors: page.items, nextCursor: page.nextCursor };
}

const toId = (id) => (mongoose.isValidObjectId(id) && /^[0-9a-f]{24}$/i.test(String(id)) ? id : null);

export async function getClientError(id, access) {
  if (!toId(id)) return null;
  return ClientError.findOne({ _id: id, feature: { $in: access.features } }, { signature: 0, __v: 0 })
    .populate('samples.user', 'name email')
    .populate('resolvedBy', 'name')
    .lean();
}

/** Marks one error resolved (with an optional note) or open again. Returns the updated record or null. */
export async function setClientErrorStatus(id, { status, note }, user) {
  if (!toId(id) || !CLIENT_ERROR_STATUS_VALUES.includes(status)) return null;
  const resolved = status === CLIENT_ERROR_STATUSES.RESOLVED;
  return ClientError.findOneAndUpdate(
    { _id: id },
    {
      $set: {
        status,
        resolvedAt: resolved ? new Date() : null,
        resolvedBy: resolved ? user._id : null,
        resolvedNote: resolved ? String(note || '').trim().slice(0, 500) : '',
        ...(resolved ? {} : { reopenedAt: null }),
      },
    },
    { new: true, projection: { signature: 0, samples: 0, __v: 0 } },
  ).lean();
}

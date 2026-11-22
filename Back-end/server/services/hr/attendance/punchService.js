/**
 * Clock in / out / break punches (docs/ADR-hr-system.md §4 "Punch").
 *
 * Order of checks — cheapest first, the face model last, so a punch that is
 * going to be refused for its location never spends a model run or burns the
 * single-use liveness challenge:
 *
 *   1. replay: { employee, clientPunchId } already stored → 200 with that punch
 *   2. who: exited / manual-attendance employees can't punch from the app
 *   3. time: online punches take the SERVER's time; offline ones keep the phone's
 *      time, sanity-checked against `receivedAt` (future → refused; older than
 *      offlineMaxHours → HR review)
 *   4. phone binding (devices.js)
 *   5. location: mocked → refused + audit flag; poor accuracy → refused;
 *      outside every allowed site → refused; impossible jump → HR review
 *   6. sequence (no break without in, no double in…) — pre-checked here, then
 *      re-checked INSIDE the transaction
 *   7. face: liveness evidence + match against the enrolled template
 *
 * A refused punch is answered (422 + reason code) and NOT stored. Accepted and
 * review punches are written in ONE transaction with the phone binding and the
 * recomputed AttendanceDay; the day row is touched first so two different
 * concurrent punches of one employee serialise (write conflict → retry → the
 * second sees the first and fails the sequence rule).
 */
import mongoose from 'mongoose';
import attendancePunchRepository from '../../../repositories/hr/attendancePunchRepository.js';
import attendanceDayRepository from '../../../repositories/hr/attendanceDayRepository.js';
import attendanceSetupRepository from '../../../repositories/hr/attendanceSetupRepository.js';
import faceRepository from '../../../repositories/hr/faceRepository.js';
import { PUNCH_TYPES, DATE_RE } from '../../../config/hr.js';
import { getHrSettings } from '../settings.js';
import { recordHrAudit } from '../audit.js';
import { verifyForPunch, checkReviewFrame } from '../face/faceService.js';
import { photoStoreAvailable, putPhoto, deletePhotoObject, photoKey } from '../face/reviewPhotos.js';
import * as ephemeral from './ephemeral.js';
import { refuse, fail, AttendanceRefusal } from './errors.js';
import { withTx, isDuplicateKey } from './tx.js';
import { checkDevice, cleanDevice } from './devices.js';
import { fenceVerdict, isImpossibleJump } from './geo.js';
import { isValidSequence, stateAfter, NEXT_TYPES } from './dayRules.js';
import { recomputeDay, shapeDay, shiftFor } from './dayService.js';
import { calendarFacts } from './calendar.js';
import {
  istDate, addDays, DAY_MS, MINUTE_MS, monthOf,
} from './time.js';

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const FUTURE_SKEW_MS = 5 * MINUTE_MS;
const OFFLINE_HARD_LIMIT_MS = 7 * DAY_MS;
const REVIEW_STASH_SECONDS = 30 * 60;
const TYPE_LABEL = {
  in: 'clock in', out: 'clock out', break_start: 'start a break', break_end: 'end the break',
};

// ── Shapes ───────────────────────────────────────────────────────────────────
export function shapePunch(p, { withLocation = false } = {}) {
  if (!p) return null;
  return {
    id: String(p._id),
    employee: String(p.employee),
    clientPunchId: p.clientPunchId,
    type: p.type,
    at: p.at,
    receivedAt: p.receivedAt,
    date: p.date,
    source: p.source,
    offline: !!p.offline,
    status: p.status,
    site: p.site ? String(p.site) : null,
    geo: {
      verdict: p.geo?.verdict || 'none',
      distanceM: p.geo?.distanceM ?? null,
      accuracyM: p.geo?.accuracyM ?? null,
      ...(withLocation ? { lat: p.geo?.lat ?? null, lng: p.geo?.lng ?? null } : {}),
    },
    face: {
      verdict: p.face?.verdict || 'skipped',
      score: p.face?.score ?? null,
      livenessPassed: !!p.face?.livenessPassed,
    },
    reviewNote: p.reviewNote || '',
    reviewedAt: p.reviewedAt || null,
  };
}

// ── Input ────────────────────────────────────────────────────────────────────
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const bool = (v) => v === true || v === 'true';

export function cleanPunchInput(body = {}) {
  const clientPunchId = String(body.clientPunchId ?? '');
  if (!CLIENT_ID_RE.test(clientPunchId)) throw fail('clientPunchId must be 8–64 letters, digits, - or _', 400);
  if (!PUNCH_TYPES.includes(body.type)) throw fail('type must be in, out, break_start or break_end', 400);
  const lat = num(body.lat);
  const lng = num(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw fail('A location (lat, lng) is required', 400);
  }
  const accuracyM = num(body.accuracyM);
  const offline = bool(body.offline);
  let at = null;
  if (offline) {
    at = new Date(body.at);
    if (!body.at || Number.isNaN(at.getTime())) throw fail('An offline punch needs the time it happened (at)', 400);
  }
  return {
    clientPunchId,
    type: body.type,
    at,
    offline,
    lat,
    lng,
    accuracyM: Number.isFinite(accuracyM) && accuracyM >= 0 ? accuracyM : null,
    mocked: bool(body.mocked),
    challengeId: body.challengeId ? String(body.challengeId) : '',
    mirrored: bool(body.mirrored),
    device: cleanDevice(body),
  };
}

// ── Sequence ─────────────────────────────────────────────────────────────────
const byTime = (a, b) => new Date(a.at) - new Date(b.at) || String(a._id || '').localeCompare(String(b._id || ''));
const isOpen = (s) => s === 'in' || s === 'break';

/**
 * Which workday a punch belongs to: an 'in' starts the IST day it happens on;
 * any other type continues an OPEN day — today's, or yesterday's for an
 * overnight shift.
 */
export function workdayFor(type, at, punchesByDate) {
  const today = istDate(at);
  if (type === 'in') return today;
  const before = (d) => (punchesByDate[d] || []).filter((p) => new Date(p.at) <= at).sort(byTime);
  if (isOpen(stateAfter(before(today)))) return today;
  const yesterday = addDays(today, -1);
  if (isOpen(stateAfter(before(yesterday)))) return yesterday;
  return today;
}

function assertSequence(dayPunches, type, at) {
  const next = [...dayPunches, { type, at, _id: 'zzzz' }].sort(byTime);
  if (isValidSequence(next)) return;
  const state = stateAfter(dayPunches.filter((p) => new Date(p.at) <= at).sort(byTime));
  const allowed = NEXT_TYPES[state].map((t) => TYPE_LABEL[t]).join(' or ');
  throw refuse('sequence', `You can't ${TYPE_LABEL[type]} now. Next you can ${allowed}.`, { allowedTypes: NEXT_TYPES[state] });
}

async function loadDays(employeeId, at, session = null) {
  const today = istDate(at);
  const rows = await attendancePunchRepository.listForDays(employeeId, [addDays(today, -1), today], session);
  const byDate = {};
  for (const p of rows) (byDate[p.date] ||= []).push(p);
  return byDate;
}

// ── Punch ────────────────────────────────────────────────────────────────────
const stashKey = (employeeId, clientPunchId) => `rv:${employeeId}:${clientPunchId}`;
const attemptsKey = (employeeId, clientPunchId) => `fa:${employeeId}:${clientPunchId}`;

async function replayOf(employee, clientPunchId) {
  const existing = await attendancePunchRepository.findByClientId(employee._id, clientPunchId);
  if (!existing) return null;
  return { punch: shapePunch(existing), day: shapeDay(await attendanceDayRepository.find(employee._id, existing.date)), replay: true };
}

/**
 * Write a punch (accepted or pending_review) + its day + the phone binding in
 * one transaction. Returns { punch, day, replay }.
 */
export async function storePunch(employee, doc, { deviceCommit = null, afterInsert = null, actor = null } = {}) {
  // Outside the transaction and in parallel: rarely-changing inputs of the recompute.
  const [shift, facts] = await Promise.all([
    shiftFor(employee),
    calendarFacts(employee._id, doc.date, doc.date, employee.workSites || []),
  ]);
  try {
    return await withTx(async (session) => {
      // Serialise this employee's punches for this day (see the header).
      const existing = await attendanceDayRepository.touch(employee._id, doc.date, monthOf(doc.date), session);
      const dayPunches = await attendancePunchRepository.listForDay(employee._id, doc.date, session);
      if (doc.source === 'app') assertSequence(dayPunches, doc.type, doc.at);
      const punch = await attendancePunchRepository.create(doc, session);
      if (deviceCommit) await deviceCommit(session, actor);
      if (afterInsert) await afterInsert(punch, session);
      // The day's punches are the ones just read plus the one just written — no re-read.
      const punches = [...dayPunches, punch].sort(byTime);
      const day = await recomputeDay(employee, doc.date, {
        session, shift, punches, existing, facts,
      });
      return { punch: shapePunch(punch), day: shapeDay(day), replay: false };
    });
  } catch (err) {
    if (isDuplicateKey(err) && err.keyPattern?.clientPunchId) {
      const again = await replayOf(employee, doc.clientPunchId);
      if (again) return again;
    }
    throw err;
  }
}

/**
 * The app's punch. `frames` are the liveness photos (Buffers). Returns
 * { punch, day, replay } or throws an AttendanceRefusal (422) / AppError.
 */
export async function punch(employee, body, frames = [], { actor = null, req = null, now = new Date() } = {}) {
  const input = cleanPunchInput(body);
  const replay = await replayOf(employee, input.clientPunchId);
  if (replay) return replay;

  if (employee.status === 'exited') throw fail('Your employment has ended; punches are closed.', 403);
  if (employee.manualAttendance) throw refuse('manual_attendance', 'HR records your attendance. Please tell HR when you arrive and leave.');

  // Time first: the parallel reads below need the punch's instant.
  let at = now;
  if (input.offline) {
    at = input.at;
    if (at - now > FUTURE_SKEW_MS) throw refuse('bad_time', "Your phone's clock is ahead. Set the time automatically and try again.");
    if (now - at > OFFLINE_HARD_LIMIT_MS) throw refuse('bad_time', 'This offline punch is too old. Ask HR for a correction instead.');
  }
  // Independent reads, in parallel (one round-trip of latency instead of four).
  const [settings, sites, prev, byDate] = await Promise.all([
    getHrSettings(),
    (employee.workSites || []).length ? attendanceSetupRepository.findActiveSitesByIds(employee.workSites) : [],
    attendancePunchRepository.findLastWithGeo(employee._id, at),
    loadDays(employee._id, at),
  ]);
  const reviewReasons = [];
  if (input.offline && now - at > settings.offlineMaxHours * 3600000) reviewReasons.push('offline_late');

  // Phone.
  const device = await checkDevice(employee, input.device, settings, now);

  // Location.
  if (input.mocked) {
    await recordHrAudit({
      action: 'punch.mocked_location', entity: 'AttendancePunch', subject: employee._id, actor, req,
      changes: [{ field: 'deviceId', from: null, to: input.device.deviceId }],
    });
    throw refuse('mocked_location', 'A fake-location app is on. Turn it off to punch.');
  }
  if (input.accuracyM === null || input.accuracyM > settings.gpsMaxAccuracyM) {
    throw refuse('low_accuracy', 'Your location is not precise enough. Step outside or near a window and try again.', {
      accuracyM: input.accuracyM, maxAccuracyM: settings.gpsMaxAccuracyM,
    });
  }
  const fence = fenceVerdict(input, sites, { anywhereAllowed: !!employee.anywhereAllowed });
  if (fence.verdict === 'outside') {
    throw refuse('outside_fence', sites.length
      ? 'You are not at your work site. Punch when you reach it.'
      : 'No work site is set for you yet. Please ask HR.', { distanceM: fence.distanceM });
  }
  if (prev && isImpossibleJump({ lat: prev.geo.lat, lng: prev.geo.lng, at: prev.at }, { lat: input.lat, lng: input.lng, at })) {
    reviewReasons.push('impossible_jump');
  }

  // Sequence pre-check (authoritative re-check inside the transaction).
  const date = workdayFor(input.type, at, byDate);
  assertSequence(byDate[date] || [], input.type, at);

  const doc = {
    _id: new mongoose.Types.ObjectId(),
    employee: employee._id,
    user: employee.user || null,
    clientPunchId: input.clientPunchId,
    type: input.type,
    at,
    receivedAt: now,
    date,
    source: 'app',
    offline: input.offline,
    site: fence.site,
    geo: {
      lat: input.lat, lng: input.lng, accuracyM: input.accuracyM, mocked: false, distanceM: fence.distanceM, verdict: fence.verdict,
    },
    deviceId: input.device.deviceId,
  };

  // Face — last, so nothing above burns the challenge.
  const attempts = Number(await ephemeral.peek(attemptsKey(employee._id, input.clientPunchId)) || 0);
  if (attempts >= settings.maxFaceAttempts) {
    throw refuse('face_no_match', 'Face check failed too many times. You can ask HR to review this punch.', {
      attemptsLeft: 0, canRequestReview: true,
    });
  }
  const failFace = async (code, message, face) => {
    const n = await ephemeral.incr(attemptsKey(employee._id, input.clientPunchId), REVIEW_STASH_SECONDS);
    // Everything except the face passed: keep the verified punch for a "please review" tap.
    await ephemeral.put(stashKey(employee._id, input.clientPunchId), {
      doc: { ...doc, _id: String(doc._id), employee: String(doc.employee), user: doc.user ? String(doc.user) : null, site: doc.site ? String(doc.site) : null },
      face,
      reviewReasons,
      device: input.device,
    }, REVIEW_STASH_SECONDS);
    throw refuse(code, message, { attemptsLeft: Math.max(0, settings.maxFaceAttempts - n), canRequestReview: true });
  };

  let verification;
  try {
    verification = await verifyForPunch(employee, { challengeId: input.challengeId, frames, mirrored: input.mirrored }, settings, { offline: input.offline });
  } catch (err) {
    if (err instanceof AttendanceRefusal && err.code === 'liveness_failed') {
      return failFace('liveness_failed', err.message, { verdict: 'liveness_failed', score: null, livenessPassed: false, modelVersion: '' });
    }
    throw err;
  }
  const face = {
    verdict: verification.verdict, score: verification.score, livenessPassed: verification.livenessPassed, modelVersion: verification.modelVersion,
  };
  if (verification.verdict !== 'match') {
    return failFace('face_no_match', "Your face didn't match. Try again in good light, or ask HR to review.", face);
  }

  const result = await storePunch(employee, {
    ...doc, face, status: reviewReasons.length ? 'pending_review' : 'accepted', reviewNote: reviewReasons.join(','),
  }, { deviceCommit: device.commit, actor });
  await verification.commit();
  await ephemeral.del(attemptsKey(employee._id, input.clientPunchId));
  await ephemeral.del(stashKey(employee._id, input.clientPunchId));
  return result;
}

/**
 * "Please review": the employee's face check failed; store the punch as
 * pending_review with ONE photo for HR (the only stored face image).
 */
export async function requestReview(employee, clientPunchId, frame, { actor = null, req = null } = {}) {
  if (!CLIENT_ID_RE.test(String(clientPunchId))) throw fail('Unknown punch', 404);
  const replay = await replayOf(employee, clientPunchId);
  if (replay) return replay;
  if (!photoStoreAvailable()) throw fail('Photo review is not available yet. Please tell HR directly.', 503);

  const stash = await ephemeral.peek(stashKey(employee._id, clientPunchId));
  if (!stash) throw fail('Nothing to review for this punch. Please punch again.', 404);
  await checkReviewFrame(frame);

  const settings = await getHrSettings();
  const device = await checkDevice(employee, stash.device, settings);
  const doc = {
    ...stash.doc,
    _id: new mongoose.Types.ObjectId(stash.doc._id),
    employee: employee._id,
    at: new Date(stash.doc.at),
    receivedAt: new Date(stash.doc.receivedAt),
    face: stash.face,
    status: 'pending_review',
    reviewNote: ['face', ...(stash.reviewReasons || [])].join(','),
  };
  const key = photoKey(employee._id, doc._id);
  await putPhoto(key, frame);
  let result;
  try {
    result = await storePunch(employee, doc, {
      deviceCommit: device.kind === 'known' ? null : device.commit,
      actor,
      afterInsert: async (punchRow, session) => {
        await faceRepository.createPhoto({
          employee: employee._id, punch: punchRow._id, storageKey: key, expiresAt: new Date(Date.now() + settings.faceReviewPhotoDays * DAY_MS),
        }, session);
        await recordHrAudit({
          action: 'punch.review_requested', entity: 'AttendancePunch', entityId: punchRow._id, subject: employee._id, actor, req, session,
          changes: [{ field: 'status', from: null, to: 'pending_review' }],
        });
      },
    });
  } catch (err) {
    await deletePhotoObject(key);
    throw err;
  }
  if (result.replay) await deletePhotoObject(key); // another tap won the race; its photo is the one kept
  await ephemeral.del(stashKey(employee._id, clientPunchId));
  return result;
}

/** HR: a manual punch (manual-attendance staff, a missed day). Accepted, audit-logged. */
export async function hrManualPunch(actor, employee, body = {}, req = null) {
  const clientPunchId = String(body.clientPunchId ?? '');
  if (!CLIENT_ID_RE.test(clientPunchId)) throw fail('clientPunchId must be 8–64 letters, digits, - or _', 400);
  if (!PUNCH_TYPES.includes(body.type)) throw fail('type must be in, out, break_start or break_end', 400);
  const at = new Date(body.at);
  if (!body.at || Number.isNaN(at.getTime()) || at - Date.now() > FUTURE_SKEW_MS) throw fail('A valid time (not in the future) is required', 400);
  const replay = await replayOf(employee, clientPunchId);
  if (replay) return replay;
  const byDate = await loadDays(employee._id, at);
  const date = body.date && DATE_RE.test(body.date) ? body.date : workdayFor(body.type, at, byDate);
  const all = await attendancePunchRepository.listForDay(employee._id, date);
  const next = [...all, { type: body.type, at }].sort(byTime);
  if (!isValidSequence(next)) throw fail("That punch doesn't fit the day's other punches.", 409);
  return storePunch(employee, {
    employee: employee._id,
    user: employee.user || null,
    clientPunchId,
    type: body.type,
    at,
    receivedAt: new Date(),
    date,
    source: 'hr_manual',
    status: 'accepted',
    reviewNote: String(body.note || '').slice(0, 500),
    createdBy: actor._id,
  }, {
    actor,
    afterInsert: (p, session) => recordHrAudit({
      action: 'punch.manual', entity: 'AttendancePunch', entityId: p._id, subject: employee._id, actor, req, session,
      reason: String(body.note || ''), changes: [{ field: body.type, from: null, to: at.toISOString() }],
    }),
  });
}

export { workdayFor as _workdayFor };

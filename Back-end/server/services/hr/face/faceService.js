/**
 * Face attendance (docs/ADR-hr-system.md "Face matching"): consent, enrolment,
 * per-punch verification, withdrawal, HR "allow re-enrol", erasure on exit.
 *
 *   - Matching runs on OUR server through services/hr/face/engine.js. No outside
 *     face API is ever called.
 *   - The template is the embedding only (cannot be turned back into a photo),
 *     encrypted with utils/fieldEncryption.js, `select: false`.
 *   - Frames are analysed in memory and dropped. The only stored image is a
 *     FaceReviewPhoto, when the employee asks HR to review a failed match.
 *   - Liveness: the SERVER issues a random, short-lived, single-use challenge and
 *     checks the evidence frames (liveness.js). Accepted frame hashes are
 *     remembered for 48 h so the same pictures can't be replayed.
 */
import crypto from 'crypto';
import faceRepository from '../../../repositories/hr/faceRepository.js';
import { encryptField, decryptField } from '../../../utils/fieldEncryption.js';
import { recordHrAudit } from '../audit.js';
import { getHrSettings } from '../settings.js';
import * as ephemeral from '../attendance/ephemeral.js';
import { refuse, fail } from '../attendance/errors.js';
import { getFaceEngine } from './engine.js';
import {
  FACE_CONSENT_VERSION, CHALLENGE_ACTIONS, CHALLENGE_PURPOSES, CHALLENGE_TTL_SECONDS,
  MIN_FRAMES, MAX_FRAMES, MAX_FRAME_BYTES, SCORE_ANCHOR, CONSISTENCY_MARGIN, FRAME_REPLAY_TTL_SECONDS,
} from './constants.js';
import {
  motionMatches, cosine, scoreOf, yawOf, FRONTAL_MAX_YAW,
} from './liveness.js';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** JPEG or PNG by magic bytes (the declared MIME type is not trusted). */
export const isImage = (buf) => Buffer.isBuffer(buf) && buf.length > 8
  && ((buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    || (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47));

// ── Template codec ───────────────────────────────────────────────────────────
export function encodeTemplate(embedding, modelVersion) {
  const f32 = Float32Array.from(embedding);
  return encryptField(JSON.stringify({ v: modelVersion, e: Buffer.from(f32.buffer).toString('base64') }));
}

export function decodeTemplate(templateEnc) {
  const { v, e } = JSON.parse(decryptField(templateEnc));
  const buf = Buffer.from(e, 'base64');
  return { modelVersion: v, embedding: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) };
}

// ── Status ───────────────────────────────────────────────────────────────────
/** What HR and the employee see. Never the template. */
export function shapeFaceProfile(p) {
  if (!p) return { status: 'none', consentVersion: null, consentCurrent: false, enrolledAt: null, currentConsentVersion: FACE_CONSENT_VERSION };
  return {
    status: p.status,
    consentVersion: p.consent?.version || null,
    consentCurrent: p.consent?.version === FACE_CONSENT_VERSION,
    currentConsentVersion: FACE_CONSENT_VERSION,
    consentAt: p.consent?.acceptedAt || null,
    enrolledAt: p.enrolledAt || null,
    withdrawnAt: p.withdrawnAt || null,
    deletedAt: p.deletedAt || null,
    modelVersion: p.modelVersion || '',
  };
}

export async function faceStatus(employeeId) {
  return shapeFaceProfile(await faceRepository.findProfile(employeeId));
}

// ── Challenges ───────────────────────────────────────────────────────────────
/**
 * A random liveness challenge for this employee. `purpose` 'offline' lives as
 * long as an offline punch may be (the phone fetches one ahead while online).
 */
export async function issueChallenge(employee, purpose = 'punch') {
  if (!CHALLENGE_PURPOSES.includes(purpose)) throw fail('Unknown challenge purpose', 400);
  const settings = purpose === 'offline' ? await getHrSettings() : null;
  const ttl = purpose === 'offline' ? settings.offlineMaxHours * 3600 : CHALLENGE_TTL_SECONDS;
  const challengeId = crypto.randomUUID();
  const action = CHALLENGE_ACTIONS[crypto.randomInt(CHALLENGE_ACTIONS.length)];
  const expiresAt = new Date(Date.now() + ttl * 1000);
  await ephemeral.put(`ch:${challengeId}`, { employee: String(employee._id), purpose, action }, ttl);
  return { challengeId, action, purpose, expiresAt };
}

function checkFrames(frames) {
  if (!Array.isArray(frames) || frames.length < MIN_FRAMES || frames.length > MAX_FRAMES) {
    throw fail(`Send ${MIN_FRAMES}–${MAX_FRAMES} photos from the face check`, 400);
  }
  for (const f of frames) {
    if (!isImage(f) || f.length > MAX_FRAME_BYTES) throw fail('Face photos must be JPG or PNG, at most 1.5 MB each', 400);
  }
}

/**
 * Consume the challenge and check the liveness evidence. Throws a refusal
 * (liveness_failed) or returns { engine, analyses, hashes, primary }.
 */
async function checkEvidence(employee, { challengeId, frames, mirrored = false }, purposes, settings) {
  checkFrames(frames);
  const challenge = challengeId ? await ephemeral.take(`ch:${String(challengeId).slice(0, 64)}`) : null;
  if (!challenge || challenge.employee !== String(employee._id) || !purposes.includes(challenge.purpose)) {
    throw refuse('liveness_failed', 'The face check expired or was already used. Please start it again.');
  }
  const hashes = frames.map(sha256);
  if (new Set(hashes).size !== hashes.length) {
    throw refuse('liveness_failed', 'The face check needs you to move as asked. Please try again.');
  }
  for (const h of hashes) {
    if (await ephemeral.peek(`fr:${employee._id}:${h}`)) {
      throw refuse('liveness_failed', 'These photos were already used. Please do the face check again.');
    }
  }

  const engine = await getFaceEngine();
  const analyses = [];
  for (const f of frames) analyses.push(await engine.analyze(f)); // CPU-bound: one at a time
  if (analyses.some((a) => a.faceCount === 0)) throw refuse('liveness_failed', 'We could not see your face. Face the camera in good light.');
  if (analyses.some((a) => a.faceCount > 1)) throw refuse('liveness_failed', 'Only you should be in the picture.');

  const first = analyses[0].face;
  const last = analyses[analyses.length - 1].face;
  if (Math.abs(yawOf(first.landmarks)) > FRONTAL_MAX_YAW) {
    throw refuse('liveness_failed', 'Look straight at the camera at the start of the face check.');
  }
  if (!motionMatches(challenge.action, first, last, { mirrored: mirrored === true })) {
    throw refuse('liveness_failed', 'The face check needs you to move as asked. Please try again.');
  }
  const minConsistency = Math.max(0, settings.faceMatchThreshold - CONSISTENCY_MARGIN);
  for (let i = 1; i < analyses.length; i += 1) {
    const s = scoreOf(cosine(first.embedding, analyses[i].face.embedding), engine.cosineThreshold, SCORE_ANCHOR);
    if (s < minConsistency) throw refuse('liveness_failed', 'Keep your face in view for the whole check.');
  }
  return { engine, analyses, hashes, primary: frames[0] };
}

const rememberFrames = (employeeId, hashes) => Promise.all(
  hashes.map((h) => ephemeral.put(`fr:${employeeId}:${h}`, 1, FRAME_REPLAY_TTL_SECONDS)),
);

// ── Consent / enrol / withdraw ───────────────────────────────────────────────
export async function giveConsent(employee, { version, deviceId = '', ip = '' } = {}, actor, req = null) {
  if (version !== FACE_CONSENT_VERSION) {
    throw fail('The consent text has changed. Please update the app and read it again.', 400);
  }
  const before = await faceRepository.findProfile(employee._id);
  if (before?.status === 'enrolled' && before.consent?.version === FACE_CONSENT_VERSION) return shapeFaceProfile(before);
  const consent = {
    version, acceptedAt: new Date(), deviceId: String(deviceId || '').slice(0, 100), ip: String(ip || '').slice(0, 64),
  };
  // Enrolled under an older consent text: re-consenting keeps the template. Otherwise enrolment opens.
  const status = before?.status === 'enrolled' ? 'enrolled' : 'reenrol_allowed';
  const row = await faceRepository.upsertProfile(employee._id, { consent, status, withdrawnAt: null });
  await recordHrAudit({
    action: 'face.consent', entity: 'FaceProfile', entityId: row._id, subject: employee._id, actor, req,
    changes: [{ field: 'consent.version', from: before?.consent?.version || null, to: version }],
  });
  return shapeFaceProfile(row);
}

/** May this profile enrol now? Fresh consent and either open for enrolment or a model change. */
function canEnrol(profile, engineVersion) {
  if (!profile || profile.consent?.version !== FACE_CONSENT_VERSION) return false;
  if (profile.status === 'reenrol_allowed') return true;
  return profile.status === 'enrolled' && profile.modelVersion !== engineVersion;
}

export async function enrol(employee, evidence, actor, req = null) {
  const profile = await faceRepository.findProfile(employee._id);
  if (!profile || profile.consent?.version !== FACE_CONSENT_VERSION) {
    throw fail('Please read and accept the face consent first.', 409);
  }
  const engine = await getFaceEngine();
  if (!canEnrol(profile, engine.version)) {
    throw fail('Your face is already enrolled. Ask HR to allow a new enrolment.', 409);
  }
  const settings = await getHrSettings();
  const { analyses, hashes } = await checkEvidence(employee, evidence, ['enrol'], settings);
  const embedding = analyses[0].face.embedding;
  const row = await faceRepository.updateIfRev(employee._id, profile.rev, {
    status: 'enrolled',
    templateEnc: encodeTemplate(embedding, engine.version),
    modelVersion: engine.version,
    enrolledAt: new Date(),
    deletedAt: null,
    deletedReason: '',
  }, { statuses: [profile.status] });
  if (!row) throw fail('Your face enrolment changed meanwhile. Please try again.', 409);
  await rememberFrames(employee._id, hashes);
  await recordHrAudit({
    action: 'face.enrolled', entity: 'FaceProfile', entityId: row._id, subject: employee._id, actor, req,
    changes: [{ field: 'templateEnc', from: profile.status === 'enrolled' ? 'set' : null, to: 'set' }, { field: 'modelVersion', from: profile.modelVersion || null, to: engine.version }],
  });
  return shapeFaceProfile(row);
}

/** The employee withdraws consent: template deleted, HR records their attendance by hand. */
export async function withdraw(employee, actor, req = null) {
  const profile = await faceRepository.findProfile(employee._id);
  if (!profile || ['withdrawn', 'deleted'].includes(profile.status)) return shapeFaceProfile(profile);
  const row = await faceRepository.updateIfRev(employee._id, profile.rev, {
    status: 'withdrawn', withdrawnAt: new Date(), modelVersion: '',
  }, { unset: { templateEnc: 1 } });
  if (!row) throw fail('Your face settings changed meanwhile. Please try again.', 409);
  await recordHrAudit({
    action: 'face.withdrawn', entity: 'FaceProfile', entityId: row._id, subject: employee._id, actor, req,
    changes: [{ field: 'templateEnc', from: 'set', to: null }],
  });
  return shapeFaceProfile(row);
}

/** HR: let an enrolled employee enrol again (new phone camera, changed look). The old template keeps working until then. */
export async function allowReenrol(employee, actor, req = null) {
  const profile = await faceRepository.findProfile(employee._id);
  if (!profile || profile.status !== 'enrolled') throw fail('This employee has no enrolled face to replace.', 409);
  const row = await faceRepository.updateIfRev(employee._id, profile.rev, {
    status: 'reenrol_allowed', reenrolAllowedBy: actor._id,
  }, { statuses: ['enrolled'] });
  if (!row) throw fail('This face profile changed meanwhile. Reload and try again.', 409);
  await recordHrAudit({
    action: 'face.reenrol_allowed', entity: 'FaceProfile', entityId: row._id, subject: employee._id, actor, req,
    changes: [{ field: 'status', from: 'enrolled', to: 'reenrol_allowed' }],
  });
  return shapeFaceProfile(row);
}

// ── Verification on a punch ──────────────────────────────────────────────────
/**
 * Verify a punch's face evidence. Returns
 *   { verdict: 'match'|'no_match', score, livenessPassed, modelVersion, commit() }
 * or throws a refusal (not_enrolled / liveness_failed). `commit()` remembers
 * the frames as used — call it only once the punch is stored.
 */
export async function verifyForPunch(employee, evidence, settings, { offline = false } = {}) {
  // A template stays usable while re-enrolment is merely ALLOWED (status reenrol_allowed keeps templateEnc).
  const templateRow = await faceRepository.findTemplate(employee._id);
  if (!templateRow?.templateEnc) throw refuse('not_enrolled', 'Set up face attendance in the app first.');
  const template = decodeTemplate(templateRow.templateEnc);

  const purposes = offline ? ['offline', 'punch'] : ['punch'];
  const { engine, analyses, hashes } = await checkEvidence(employee, evidence, purposes, settings);
  if (template.modelVersion !== engine.version) {
    throw refuse('not_enrolled', 'Face attendance was upgraded. Please enrol your face again in the app.');
  }
  const score = scoreOf(cosine(template.embedding, analyses[0].face.embedding), engine.cosineThreshold, SCORE_ANCHOR);
  return {
    verdict: score >= settings.faceMatchThreshold ? 'match' : 'no_match',
    score,
    livenessPassed: true,
    modelVersion: engine.version,
    commit: () => rememberFrames(employee._id, hashes),
  };
}

/** One frame for a review request: a real image with exactly one face (not matched — HR looks at it). */
export async function checkReviewFrame(frame) {
  if (!isImage(frame) || frame.length > MAX_FRAME_BYTES) throw fail('The photo must be a JPG or PNG, at most 1.5 MB', 400);
  const engine = await getFaceEngine();
  const a = await engine.analyze(frame);
  if (a.faceCount !== 1) throw fail('Take a clear photo of just your face for HR.', 400);
}

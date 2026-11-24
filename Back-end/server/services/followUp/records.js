/**
 * Writing to and reading delay records outside the sweep. No routes use this yet:
 * wave 2 piece D (reason required on every stage) calls giveReason; wave 3 piece G
 * (My delays v2, scorecards) calls listDelays / excuseDelay.
 *
 *   giveReason   the owner, a head of the team / owner's team, or an admin says why
 *                (one code from config/followUp.js FOLLOWUP_REASONS, a note — needed
 *                for "other" — and optionally the next follow-up date, which pauses
 *                the ladder until then; it restarts at `due` after it). `givenLate`
 *                records whether it came after the deadline. Appended, never edited.
 *   excuseDelay  a head or admin excuses a late step with a note. Once; the record
 *                stays (it is still listed, marked excused). Never your own.
 *   listDelays   late steps, newest first, by owner / team / date range, open or
 *                resolved, keyset-paged and bounded.
 */
import mongoose from 'mongoose';
import AppError from '../../utils/AppError.js';
import followUpDelayRepository from '../../repositories/followUpDelayRepository.js';
import {
  FOLLOWUP_REASONS, FOLLOWUP_NOTE_MAX, FOLLOWUP_NEXT_MAX_DAYS, loadFollowUpConfig,
} from '../../config/followUp.js';
import { snapToOffice } from './officeClock.js';
import { canActOn, canExcuse } from './people.js';

const fail = (message, status = 400) => new AppError(message, status, { expose: true });
const MIN_MS = 60 * 1000;
const NOTE_MIN = 3;
const idOf = (v) => (v == null ? '' : String(v._id ?? v));
const clean = (raw) => (typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '');

function objectId(raw, message) {
  if (!mongoose.isValidObjectId(raw)) throw fail(message, 404);
  return new mongoose.Types.ObjectId(String(raw));
}

/** A next follow-up date from a form → a moment in office time, or a clear 400. */
export function readNextAt(raw, now, office) {
  if (raw == null || raw === '') return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw fail('That next follow-up date is not valid.');
  if (d.getTime() <= now.getTime() + MIN_MS) throw fail('The next follow-up date must be in the future.');
  if (d.getTime() > now.getTime() + FOLLOWUP_NEXT_MAX_DAYS * 24 * 60 * MIN_MS) {
    throw fail(`Pick a next follow-up date within ${FOLLOWUP_NEXT_MAX_DAYS} days.`);
  }
  return snapToOffice(d, office);
}

/** An attachment saved by the existing storage path (pieces D / I), checked for shape only. */
function readAttachment(raw, actor, now) {
  if (raw == null) return undefined;
  if (typeof raw !== 'object' || typeof raw.key !== 'string' || !raw.key) throw fail('That attachment is not valid.');
  return {
    key: raw.key.slice(0, 300),
    name: clean(raw.name).slice(0, 200),
    mime: clean(raw.mime).slice(0, 100),
    size: Number.isFinite(Number(raw.size)) ? Number(raw.size) : 0,
    uploadedAt: raw.uploadedAt ? new Date(raw.uploadedAt) : now,
    by: actor._id,
  };
}

export async function giveReason(actor, delayId, input = {}, { now = new Date(), env = process.env } = {}) {
  const row = await followUpDelayRepository.findById(objectId(delayId, 'Follow-up not found.'));
  if (!row) throw fail('Follow-up not found.', 404);
  if (!canActOn(actor, row)) throw fail('Follow-up not found.', 404);
  if (!row.open) throw fail('This step has already moved on.', 409);

  const code = clean(input.code);
  const def = FOLLOWUP_REASONS[code];
  if (!def) throw fail('Pick a reason from the list.');
  const note = clean(input.note);
  if (note.length > FOLLOWUP_NOTE_MAX) throw fail(`Keep the note under ${FOLLOWUP_NOTE_MAX} characters.`);
  if (def.noteRequired && note.length < NOTE_MIN) throw fail('Type what happened: "Other" needs a note.');
  const nextAt = readNextAt(input.nextAt, now, loadFollowUpConfig(env).office);

  const reason = {
    at: now,
    by: actor._id,
    byName: actor.name || '',
    code,
    control: def.control,
    note,
    nextAt,
    givenLate: now.getTime() > new Date(row.dueAt).getTime(),
    ...(input.attachment != null ? { attachment: readAttachment(input.attachment, actor, now) } : {}),
  };
  return followUpDelayRepository.addReason(row._id, reason);
}

export async function excuseDelay(actor, delayId, rawNote, { now = new Date() } = {}) {
  const row = await followUpDelayRepository.findById(objectId(delayId, 'Follow-up not found.'));
  if (!row?.lateAt) throw fail('Follow-up not found.', 404);
  if (!canExcuse(actor, row)) throw fail('Only a team head or an admin can excuse a delay, and never their own.', 403);
  const note = clean(rawNote);
  if (note.length < NOTE_MIN) throw fail('Type why this delay is excused.');
  if (note.length > FOLLOWUP_NOTE_MAX) throw fail(`Keep the note under ${FOLLOWUP_NOTE_MAX} characters.`);
  const done = await followUpDelayRepository.excuse(row._id, { by: actor._id, byName: actor.name || '', note, at: now });
  if (!done) throw fail('This delay was already excused.', 409);
  return done;
}

const encodeCursor = (row) => `${new Date(row.lateAt).getTime()}_${idOf(row._id)}`;
function decodeCursor(raw) {
  if (!raw) return null;
  const m = /^(\d{1,15})_([a-f0-9]{24})$/.exec(String(raw));
  if (!m) throw fail('Invalid page cursor.');
  return { lateAt: new Date(Number(m[1])), id: new mongoose.Types.ObjectId(m[2]) };
}
const readDate = (raw, what) => {
  if (raw == null || raw === '') return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw fail(`That ${what} date is not valid.`);
  return d;
};

/** The shape a list shows: no internal claim fields. */
export const delayView = (r) => ({
  id: idOf(r._id),
  order: { id: idOf(r.order), number: r.orderNumber || '' },
  stage: r.stage,
  team: r.team,
  item: { kind: r.itemKind, id: idOf(r.itemId), name: r.itemName || '' },
  enteredAt: r.enteredAt,
  dueAt: r.dueAt,
  lateAt: r.lateAt,
  owner: r.ownerAtLate ? { id: idOf(r.ownerAtLate.user) || null, name: r.ownerAtLate.name, team: r.ownerAtLate.team, source: r.ownerAtLate.source } : null,
  open: r.open,
  resolvedAt: r.resolvedAt,
  pausedUntil: r.pausedUntil,
  levelsReached: (r.levelsReached || []).map((l) => ({ level: l.level, at: l.at, mode: l.mode })),
  reasons: (r.reasons || []).map((x) => ({
    at: x.at, by: { id: idOf(x.by), name: x.byName }, code: x.code, control: x.control, note: x.note,
    nextAt: x.nextAt, givenLate: x.givenLate, attachment: x.attachment || null,
  })),
  excused: r.excused ? { by: { id: idOf(r.excused.by), name: r.excused.byName }, note: r.excused.note, at: r.excused.at } : null,
});

/**
 * Late steps, newest first. Filters: ownerId | team, from / to (on lateAt),
 * state open | resolved | all, cursor, limit (≤ 100).
 * Access control is the caller's (piece G's route) — this reads what it is asked.
 */
export async function listDelays({ ownerId, team, from, to, state = 'all', cursor, limit = 50 } = {}) {
  if (!['open', 'resolved', 'all'].includes(state)) throw fail('Invalid delay filter.');
  const size = Math.min(Math.max(1, Number(limit) || 50), 100);
  const rows = await followUpDelayRepository.listLate({
    owner: ownerId ? objectId(ownerId, 'Person not found.') : null,
    team: team ? String(team) : null,
    from: readDate(from, 'from'),
    to: readDate(to, 'to'),
    state,
    before: decodeCursor(cursor),
    limit: size + 1,
  });
  const more = rows.length > size;
  const page = more ? rows.slice(0, size) : rows;
  return { items: page.map(delayView), nextCursor: more ? encodeCursor(page[page.length - 1]) : null };
}

/** Every follow-up row of one order (late or not), oldest first. */
export const delaysForOrder = async (orderId) => (await followUpDelayRepository.forOrder(objectId(orderId, 'Order not found.'))).map(delayView);

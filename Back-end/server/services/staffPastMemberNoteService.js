/**
 * Notes on a past team member: what the team head or an admin wants the next
 * person to know ("Ravi Motors trusted Nevin; call them first").
 *
 *   read     everyone who may open the profile (services/staffPastMemberService.js)
 *   write    an admin, or the active head of the member's team
 *   edit     the author, while they may still write
 *   delete   the author while they may still write, or any admin
 * Someone who may not open the profile gets 404, as there.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import repo from '../repositories/staffPastMemberNoteRepository.js';
import { loadMember } from './staffPastMemberService.js';
import { cleanRichTextWithin, richTextToPlain } from '../utils/richText.js';

export const NOTE_MAX = 5000;
export const NOTES_PAGE = 20;

const fail = (message, status) => new AppError(message, status, { expose: true });
const same = (a, b) => !!a && !!b && String(a) === String(b);
const isAdmin = (u) => u?.role === 'admin';
const isHeadOf = (u, member) => u?.role === 'staff' && u.staff?.active === true && u.staff.isHead === true && u.staff.team === member.staff.team;

export const canWriteNote = (u, member) => isAdmin(u) || isHeadOf(u, member);
const canEdit = (u, member, n) => same(u._id, n.author) && canWriteNote(u, member);
const canDelete = (u, member, n) => isAdmin(u) || canEdit(u, member, n);

function cleanBody(raw) {
  const { value, tooLong } = cleanRichTextWithin(raw, NOTE_MAX);
  if (tooLong) throw fail(`Keep the note under ${NOTE_MAX} characters.`, 400);
  if (!richTextToPlain(value).trim()) throw fail('Write something first.', 400);
  return value;
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  const raw = Buffer.from(String(cursor), 'base64url').toString('utf8');
  if (!mongoose.isValidObjectId(raw)) throw fail('Invalid page cursor.', 400);
  return new mongoose.Types.ObjectId(raw);
}

const shape = (n, viewer, member) => ({
  id: String(n._id),
  body: n.body,
  authorName: n.authorName,
  createdAt: n.createdAt,
  editedAt: n.editedAt || null,
  rev: n.rev,
  can: { edit: canEdit(viewer, member, n), delete: canDelete(viewer, member, n) },
});

export async function listNotes(actor, memberId, { cursor } = {}) {
  const member = await loadMember(actor, memberId);
  const rows = await repo.page(member._id, decodeCursor(cursor), NOTES_PAGE + 1);
  const more = rows.length > NOTES_PAGE;
  const page = more ? rows.slice(0, NOTES_PAGE) : rows;
  return {
    notes: page.map((n) => shape(n, actor, member)),
    canWrite: canWriteNote(actor, member),
    nextCursor: more ? Buffer.from(String(page[page.length - 1]._id)).toString('base64url') : null,
  };
}

export async function addNote(actor, memberId, input, req) {
  const member = await loadMember(actor, memberId);
  if (!canWriteNote(actor, member)) throw fail('Only the team head or an admin can add notes.', 403);
  const n = await repo.create({ member: member._id, team: member.staff.team, body: cleanBody(input.body), author: actor._id, authorName: actor.name || '' });
  auditLogger.logAction(req, 'CREATE', 'StaffPastMemberNote', n._id, { member: String(member._id) });
  return shape(n, actor, member);
}

async function loadNote(actor, memberId, noteId) {
  const member = await loadMember(actor, memberId);
  const n = mongoose.isValidObjectId(noteId) ? await repo.findOne(member._id, noteId) : null;
  if (!n) throw fail('Note not found.', 404);
  return { member, n };
}

export async function editNote(actor, memberId, noteId, input, req) {
  const { member, n } = await loadNote(actor, memberId, noteId);
  if (!canEdit(actor, member, n)) throw fail('Only the person who wrote this note can change it.', 403);
  const updated = await repo.updateIfRev(n._id, Number(input.rev), { body: cleanBody(input.body), editedAt: new Date() });
  if (!updated) throw fail('Someone changed this note just now. Reload and try again.', 409);
  auditLogger.logAction(req, 'UPDATE', 'StaffPastMemberNote', n._id, { member: String(member._id) });
  return shape(updated, actor, member);
}

export async function deleteNote(actor, memberId, noteId, req) {
  const { member, n } = await loadNote(actor, memberId, noteId);
  if (!canDelete(actor, member, n)) throw fail('Only the person who wrote this note, or an admin, can delete it.', 403);
  await repo.remove(n._id);
  auditLogger.logAction(req, 'DELETE', 'StaffPastMemberNote', n._id, { member: String(member._id), author: String(n.author) });
  return { deleted: true };
}

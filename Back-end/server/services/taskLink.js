/**
 * Linking a payment to the staff task it was for ("T-42") — procurement claims
 * fuel per pickup. The same shape as the project link (staffProjectService
 * .projectForLink): checked here, then the number and title are snapshotted onto
 * the request. Only says which task — never changes the money.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import staffTaskRepository from '../repositories/staffTaskRepository.js';
import { canSee } from './staffTaskService.js';

const fail = (message, status) => new AppError(message, status, { expose: true });

export const taskCode = (number) => (number ? `T-${number}` : '');

/** "T-42", "t42", "42" → 42; null otherwise. */
const taskNumberIn = (raw) => {
  const m = /^\s*t?-?\s*(\d{1,9})\s*$/i.exec(String(raw));
  return m ? Number(m[1]) : null;
};

/**
 * The task `raw` names (its id, or "T-42"), if this person may link to it; null
 * for '' / null (no task). Accounts and the admin (`seesAll`) may link any task.
 */
export async function taskForLink(actor, raw, { seesAll = false } = {}) {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  const number = mongoose.isValidObjectId(s) && s.length === 24 ? null : taskNumberIn(s);
  if (!number && !(mongoose.isValidObjectId(s) && s.length === 24)) throw fail('Pick a task, or type its ID like T-42.', 400);
  const t = number ? await staffTaskRepository.findByNumber(number) : await staffTaskRepository.findById(s);
  // A personal task is its owner's alone, even for accounts and the admin.
  const visible = t && (t.personal ? canSee(actor, t) : (seesAll || canSee(actor, t)));
  if (!visible) throw fail(number ? `Task ${taskCode(number)} was not found.` : 'That task was not found.', 400);
  if (t.archivedAt) throw fail(`Task ${taskCode(t.number)} is archived — restore it first to link to it.`, 400);
  return t;
}

/** The fields a request stores for its task (or for none). */
export const taskFields = (t) => (t
  ? { task: t._id, taskNumber: t.number, taskTitle: String(t.title || '').slice(0, 200) }
  : { task: null, taskNumber: null, taskTitle: '' });

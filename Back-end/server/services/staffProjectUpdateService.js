/**
 * Updates on a staff project (models/StaffProjectUpdate.js): what happened on
 * the job, in words, photos and videos, newest first.
 *
 * ── Who does what ───────────────────────────────────────────────────────────
 *   read      anyone who sees the project (services/staffProjectService.js)
 *   post      anyone who sees it, while it is not archived
 *   delete    the person who posted it, the project's owner, or the admin
 *   files     read through GET /staff/tasks/projects/:id/files/:name, which
 *             checks the reader sees the project AND the update is still live
 *
 * Files use the task-file checks (services/taskFileService.js): allowlisted
 * types, bytes that match, 10 MB a photo or document, 40 MB a video, stored
 * only in the private bucket under `projects/<projectId>/`. A video is played
 * from a short-lived private link, not streamed through the API.
 *
 * Posting is idempotent on the browser's `clientId`, so a double-tap or a
 * retried request saves one update and stores its files once.
 */
import mongoose from 'mongoose';
import AppError from '../utils/AppError.js';
import auditLogger from './auditLogger.js';
import staffProjectUpdateRepository from '../repositories/staffProjectUpdateRepository.js';
import { loadVisibleProject, canManageProject } from './staffProjectService.js';
import {
  storeFilesIn, discardTaskFiles, removeTaskFile, readFileIn, isTaskFileName, isVideoFileName, privateVideoLink,
  basenameOf, COMMENT_FILES_MAX,
} from './taskFileService.js';
import { cleanRichText, richTextLength, RICH_TEXT_MARKUP_FACTOR } from '../utils/richText.js';
import { STAFF_LONG_TEXT_MAX, longTextTooLong } from '../config/staffTextLimits.js';

const fail = (message, status) => new AppError(message, status, { expose: true });
const idOf = (v) => String(v?._id ?? v ?? '');
const same = (a, b) => !!a && !!b && idOf(a) === idOf(b);
const isAdmin = (u) => u?.role === 'admin';

export const PROJECT_UPDATE_PAGE_SIZE = 20;
/** Files on one update — the same as a task comment. */
export const PROJECT_UPDATE_FILES_MAX = COMMENT_FILES_MAX;

export const projectFolder = (projectId) => `projects/${idOf(projectId)}`;
export const projectFileUrl = (projectId, basename) =>
  `/api/v1/staff/tasks/projects/${idOf(projectId)}/files/${encodeURIComponent(basename)}`;

// ── Input ───────────────────────────────────────────────────────────────────

/** Formatted or plain text, cleaned to the allow-list; the cap counts words, not markup. */
export function cleanUpdateText(raw) {
  const s = String(raw ?? '');
  const tooLong = longTextTooLong('This update');
  // An absurd payload is refused before anything parses it.
  if (s.length > STAFF_LONG_TEXT_MAX * RICH_TEXT_MARKUP_FACTOR) throw fail(tooLong, 400);
  const text = cleanRichText(s);
  if (richTextLength(text) > STAFF_LONG_TEXT_MAX) throw fail(tooLong, 400);
  return text;
}

const cleanClientId = (raw) => (typeof raw === 'string' && /^[\w-]{8,64}$/.test(raw) ? raw : undefined);

// ── Output ──────────────────────────────────────────────────────────────────

const canDelete = (viewer, project, u) => same(u.by, viewer?._id) || isAdmin(viewer) || canManageProject(viewer, project);

/** One update as `viewer` sees it. A deleted one keeps its place with nothing in it. */
export function shapeUpdate(u, viewer, project) {
  const deleted = !!u.deletedAt;
  return {
    id: idOf(u._id),
    by: u.byName || '',
    byId: idOf(u.by),
    mine: same(u.by, viewer?._id),
    at: u.createdAt || null,
    deleted,
    text: deleted ? '' : u.text || '',
    files: deleted ? [] : (u.attachments || []).map((f) => ({
      url: projectFileUrl(project._id, basenameOf(f.publicId)),
      name: f.name, mime: f.mime, size: f.size || 0, kind: f.kind,
    })),
    canDelete: !deleted && !project.archivedAt && canDelete(viewer, project, u),
  };
}

// ── Read ────────────────────────────────────────────────────────────────────

/** A page of updates, newest first. `before` is the last id of the previous page. */
export async function listProjectUpdates(actor, projectId, { before } = {}) {
  const p = await loadVisibleProject(actor, projectId);
  if (before && !mongoose.isValidObjectId(before)) throw fail('Invalid page cursor.', 400);
  const rows = await staffProjectUpdateRepository.page(p._id, { before: before || null, limit: PROJECT_UPDATE_PAGE_SIZE + 1 });
  const more = rows.length > PROJECT_UPDATE_PAGE_SIZE;
  const page = more ? rows.slice(0, PROJECT_UPDATE_PAGE_SIZE) : rows;
  return {
    updates: page.map((u) => shapeUpdate(u, actor, p)),
    nextBefore: more ? idOf(page[page.length - 1]._id) : null,
  };
}

/**
 * A file on one of the project's live updates, for someone who sees the
 * project: `{ buffer, mime, inline, name }`, or `{ redirect }` for a video.
 * A file whose update was deleted is 404.
 */
export async function readProjectFile(actor, projectId, name, { download = false } = {}) {
  const p = await loadVisibleProject(actor, projectId);
  if (!isTaskFileName(name)) throw fail('File not found.', 404);
  const folder = projectFolder(p._id);
  const publicId = `${folder}/${name}`;
  const own = await staffProjectUpdateRepository.liveFile(p._id, publicId);
  if (!own) throw fail('File not found.', 404);
  if (isVideoFileName(name)) {
    return { redirect: await privateVideoLink(folder, name, { downloadAs: download ? own.name : undefined }) };
  }
  const file = await readFileIn(folder, name);
  return { ...file, name: own.name || null };
}

// ── Write ───────────────────────────────────────────────────────────────────

/**
 * Post an update: words, files, or both. Files are stored first and removed
 * again if the update is not saved, so nothing is left in storage unreferenced.
 * @returns {Promise<{ update: object, duplicate: boolean }>}
 */
export async function addProjectUpdate(actor, projectId, { text, clientId: rawClientId, files = [] } = {}) {
  const p = await loadVisibleProject(actor, projectId);
  if (p.archivedAt) throw fail('This project is archived. Restore it first.', 409);
  const clientId = cleanClientId(rawClientId);
  if (clientId) {
    const seen = await staffProjectUpdateRepository.findByClientId(actor._id, clientId);
    if (seen) return { update: shapeUpdate(seen, actor, p), duplicate: true };
  }
  const body = cleanUpdateText(text);
  if (!body && !files.length) throw fail('Write an update or add a photo or video first.', 400);
  if (files.length > PROJECT_UPDATE_FILES_MAX) throw fail(`Attach at most ${PROJECT_UPDATE_FILES_MAX} files to one update.`, 400);

  const stored = await storeFilesIn(files, projectFolder(p._id));
  const at = new Date();
  const refs = stored.map((f) => ({ ...f, by: actor._id, byName: actor.name || '', at }));
  let u;
  try {
    u = await staffProjectUpdateRepository.create({
      project: p._id, by: actor._id, byName: actor.name || '', text: body, clientId,
      ...(refs.length ? { attachments: refs } : {}),
    });
  } catch (err) {
    await discardTaskFiles(stored);
    // Two requests with the same clientId raced: the other one saved it.
    if (err?.code === 11000 && clientId) {
      const seen = await staffProjectUpdateRepository.findByClientId(actor._id, clientId);
      if (seen) return { update: shapeUpdate(seen, actor, p), duplicate: true };
    }
    throw err;
  }
  return { update: shapeUpdate(u, actor, p), duplicate: false };
}

/**
 * Delete an update: its words stay in the record (never shown), its files are
 * removed from storage. Already deleted is the same result, not an error.
 */
export async function deleteProjectUpdate(actor, projectId, updateId, req = null) {
  const p = await loadVisibleProject(actor, projectId);
  if (!mongoose.isValidObjectId(updateId)) throw fail('Update not found.', 404);
  const u = await staffProjectUpdateRepository.findInProject(p._id, updateId);
  if (!u) throw fail('Update not found.', 404);
  if (u.deletedAt) return shapeUpdate(u, actor, p);
  if (p.archivedAt) throw fail('This project is archived. Restore it first.', 409);
  if (!canDelete(actor, p, u)) {
    throw fail('Only the person who posted this update, the project owner or the admin can delete it.', 403);
  }
  // Conditional on still being live, so two deletes at once remove the files once.
  const done = await staffProjectUpdateRepository.softDelete(u._id, actor._id);
  if (done) {
    await Promise.all((u.attachments || []).map(removeTaskFile));
    if (req) auditLogger.logAction(req, 'DELETE', 'StaffProjectUpdate', u._id, { project: idOf(p._id), files: (u.attachments || []).length });
  }
  return shapeUpdate(done || { ...u, deletedAt: new Date() }, actor, p);
}

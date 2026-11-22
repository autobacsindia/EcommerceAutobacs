/**
 * Files on staff tasks — on the task itself and on its comments.
 *
 * Same checks as team chat (services/chatAttachmentService.js): the declared type
 * must be on the allowlist and the BYTES must match it, names are cleaned, and
 * a batch is stored all or nothing.
 *
 * Stored ONLY in the private bucket (R2), under `tasks/<taskId>/`, and read back
 * through GET /staff/tasks/:id/files/:name, which checks the reader may see the
 * task. Tasks carry order and customer details, so unlike chat there is no
 * public Cloudinary fallback: without private storage, adding a file is refused
 * (503) instead of quietly publishing it.
 */
import crypto from 'crypto';
import AppError from '../utils/AppError.js';
import { putPrivateAsset, deletePrivateAsset, readPrivateAsset } from './storage/privateUploads.js';
import { storageProvider } from '../config/storage.js';
import { r2PrivateUrl } from './storage/privateAssetUrl.js';
import { storeAll } from './storage/storeAll.js';
import { assertRealFiles, assertSizes, attachmentType, safeName, CHAT_FILE_NAME, chatFileType } from './chatAttachmentService.js';

/** Files on one task, and on one comment. */
export const TASK_FILES_MAX = 30;
export const COMMENT_FILES_MAX = 10;

export const taskFolder = (taskId) => `tasks/${taskId}`;
export const taskFileUrl = (taskId, basename) => `/api/v1/staff/tasks/${taskId}/files/${encodeURIComponent(basename)}`;
/** The stored name of a file: `<13-digit ms>-<8 hex>-<cleaned original>`, or null when `name` is not one. */
export const isTaskFileName = (name) => CHAT_FILE_NAME.test(String(name));
export const basenameOf = (publicId) => String(publicId).split('/').pop();

/**
 * Check and store a batch for one task. Resolves to refs ready to save on the
 * task or a comment; if any file fails, the ones already stored are removed.
 */
export const storeTaskFiles = (files, taskId) => storeFilesIn(files, taskFolder(taskId));

/**
 * Check and store a batch under one private folder (a task's, a project's).
 * All or nothing: if any file fails, the ones already stored are removed.
 */
export async function storeFilesIn(files, folder) {
  if (!files?.length) return [];
  // Same allowlist and caps as team chat: photos and documents up to 10 MB,
  // videos (MP4, MOV, WebM) up to 40 MB (config/attachments.js).
  assertSizes(files);
  assertRealFiles(files);
  if (storageProvider() !== 'r2') {
    throw new AppError('File storage is not set up here, so files can’t be added.', 503, { expose: true });
  }
  return storeAll(files, async (file) => {
    const type = attachmentType(file.mimetype);
    const name = safeName(file.originalname, type.ext);
    const basename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${name}`;
    const stored = await putPrivateAsset({ buffer: file.buffer, folder, basename, contentType: file.mimetype });
    return { publicId: stored.publicId, provider: 'r2', kind: type.kind, name, mime: file.mimetype, size: file.size };
  }, removeTaskFile);
}

/** Remove one stored file. Never throws (deletePrivateAsset logs a miss under [CLEANUP_REQUIRED]). */
export const removeTaskFile = (ref) => deletePrivateAsset({ publicId: ref.publicId, provider: 'r2' });

/** Remove files that were stored for a write that then did not happen. */
export const discardTaskFiles = (refs) => Promise.all((refs || []).map(removeTaskFile));

/** The bytes of a stored task file, with how to serve them. 404 when it is not there. */
export const readTaskFile = (taskId, name) => readFileIn(taskFolder(taskId), name);

/** The bytes of a stored photo or document in one private folder. 404 when it is not there. */
export async function readFileIn(folder, name) {
  const type = isTaskFileName(name) ? chatFileType(name) : null;
  if (!type) throw new AppError('File not found.', 404, { expose: true });
  let buffer;
  try {
    buffer = await readPrivateAsset({ publicId: `${folder}/${name}`, provider: 'r2' });
  } catch {
    throw new AppError('File not found.', 404, { expose: true });
  }
  return { buffer, mime: type.mime, inline: type.kind === 'image' || type.mime === 'application/pdf' };
}

/** How long a video's private link works. Long enough to watch and seek a clip; never shared. */
export const VIDEO_LINK_TTL_SECONDS = 60 * 60;

/** Is this stored name a video (by its server-chosen extension)? */
export const isVideoFileName = (name) => chatFileType(name)?.kind === 'video';

/**
 * A short-lived private link to a stored video, for the browser's player.
 *
 * Videos are not streamed through the API: a player asks for the file in
 * pieces (HTTP Range — iPhone Safari will not play a video served whole), and
 * holding a 40 MB clip in server memory per viewer would starve checkout. The
 * caller has ALREADY checked the viewer may see the file; this link is the
 * proof, and it expires. R2 answers the Range requests itself.
 */
export async function privateVideoLink(folder, name, { downloadAs } = {}) {
  const type = isTaskFileName(name) ? chatFileType(name) : null;
  if (!type || type.kind !== 'video') throw new AppError('File not found.', 404, { expose: true });
  return r2PrivateUrl({ key: `${folder}/${name}`, ttlSeconds: VIDEO_LINK_TTL_SECONDS, contentType: type.mime, downloadAs });
}

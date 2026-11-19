/**
 * Chat attachments — photos and documents staff share in team chat.
 *
 * Why its own uploader rather than middleware/uploadMiddleware: that one is a
 * catalogue-image pipeline (images only, 3 MB, dimension rules for product
 * photos). Chat needs invoices and spreadsheets too, at a bigger size, and must
 * never apply image transformations to a document.
 *
 * Safety, in order:
 *   1. multer caps count and per-file size before anything is buffered;
 *   2. the declared MIME must be on the allowlist;
 *   3. the BYTES must match that type (magic numbers) — a .exe renamed to .pdf
 *      is rejected here, so nothing unexpected ever reaches Cloudinary;
 *   4. the stored filename is sanitised; the original is only ever shown as text.
 *
 * Images go to Cloudinary as `image` (so thumbnails work), videos as `video`
 * (so they play and seek); everything else as `raw`, which is served as an
 * opaque download and never executed or rendered.
 *
 * Videos (MP4, MOV, WebM) get their own, larger size cap — a phone clip is
 * bigger than a photo — which is why multer's own limit is the larger of the two
 * and the per-kind cap is checked straight after (assertSizes).
 */
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import AppError from '../utils/AppError.js';
import { uploadToCloudinary, uploadRawToCloudinary, uploadVideoToCloudinary, deleteFromCloudinary } from '../utils/cloudinaryHelpers.js';
import { putPrivateAsset, deletePrivateAsset, readPrivateAsset } from './storage/privateUploads.js';
import { storageProvider } from '../config/storage.js';
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_VIDEO_ATTACHMENT_BYTES, mb } from '../config/attachments.js';
import { detectKind, KIND } from './storage/contentSniff.js';
import { storeAll } from './storage/storeAll.js';

/** The staff-wide limits (config/attachments.js): 10 MB a file, 40 MB a video, 20 files a message. */
export const MAX_ATTACHMENT_SIZE = MAX_ATTACHMENT_BYTES;
export const MAX_VIDEO_SIZE = MAX_VIDEO_ATTACHMENT_BYTES;
export const MAX_ATTACHMENTS_PER_MESSAGE = MAX_ATTACHMENTS;

/** mime → { kind, ext, verify(buffer) }. Anything not here is refused. */
const starts = (buf, sig) => buf.length >= sig.length && buf.subarray(0, sig.length).equals(Buffer.from(sig));
const PK_ZIP = [0x50, 0x4b, 0x03, 0x04]; // docx/xlsx are zip containers
// MP4/MOV share the ISO `ftyp` box; contentSniff tells a video brand from a HEIC/AVIF photo.
const isVideo = (b) => detectKind(b) === KIND.VIDEO;
// Older QuickTime files (some cameras, screen recorders) open with a moov/mdat/
// wide/free atom instead of `ftyp`.
const QT_ATOMS = new Set(['moov', 'mdat', 'wide', 'free', 'skip']);
const isQuickTime = (b) => isVideo(b) || (b.length >= 8 && QT_ATOMS.has(b.subarray(4, 8).toString('latin1')));

const TYPES = {
  'image/jpeg': { kind: 'image', ext: 'jpg', verify: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  'image/jpg': { kind: 'image', ext: 'jpg', verify: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  'image/png': { kind: 'image', ext: 'png', verify: (b) => starts(b, [0x89, 0x50, 0x4e, 0x47]) },
  'image/webp': {
    kind: 'image',
    ext: 'webp',
    verify: (b) => b.length >= 12 && starts(b, [0x52, 0x49, 0x46, 0x46]) && b.subarray(8, 12).toString() === 'WEBP',
  },
  'image/gif': { kind: 'image', ext: 'gif', verify: (b) => starts(b, [0x47, 0x49, 0x46, 0x38]) },
  'video/mp4': { kind: 'video', ext: 'mp4', verify: isVideo },
  'video/quicktime': { kind: 'video', ext: 'mov', verify: isQuickTime }, // iPhone
  'video/x-m4v': { kind: 'video', ext: 'm4v', verify: isVideo },
  'video/webm': { kind: 'video', ext: 'webm', verify: (b) => starts(b, [0x1a, 0x45, 0xdf, 0xa3]) },
  'application/pdf': { kind: 'file', ext: 'pdf', verify: (b) => starts(b, [0x25, 0x50, 0x44, 0x46]) },
  'text/csv': { kind: 'file', ext: 'csv', verify: () => true }, // plain text: nothing to forge
  'text/plain': { kind: 'file', ext: 'txt', verify: () => true },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    kind: 'file', ext: 'xlsx', verify: (b) => starts(b, PK_ZIP),
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    kind: 'file', ext: 'docx', verify: (b) => starts(b, PK_ZIP),
  },
};

export const ALLOWED_ATTACHMENT_TYPES = Object.keys(TYPES);

/**
 * Some browsers send a video with no useful label (Windows without a codec pack,
 * some Android pickers). The file name then says what it claims to be; the BYTES
 * still decide (assertRealFiles), so a renamed .exe is refused either way.
 */
const NO_LABEL = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/unknown']);
const VIDEO_BY_EXT = { mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm' };
export function declaredType({ mimetype, originalname }) {
  const type = String(mimetype || '').toLowerCase();
  if (!NO_LABEL.has(type)) return type;
  const ext = String(originalname || '').toLowerCase().split('.').pop();
  return VIDEO_BY_EXT[ext] || type;
}

/** The size cap for one file of this kind. */
export const maxBytesFor = (kind) => (kind === 'video' ? MAX_VIDEO_SIZE : MAX_ATTACHMENT_SIZE);
const TOO_BIG_TEXT = `Videos can be up to ${mb(MAX_VIDEO_ATTACHMENT_BYTES)}; other files up to ${mb(MAX_ATTACHMENT_BYTES)}.`;

/** Refuse the batch (400) when any file is over the cap for its kind. */
export function assertSizes(files) {
  for (const file of files || []) {
    const type = TYPES[file.mimetype];
    if (type && file.size > maxBytesFor(type.kind)) {
      throw new AppError(`"${file.originalname}" is too big. ${TOO_BIG_TEXT}`, 400, { expose: true });
    }
  }
}

/** { kind, ext } for an allowed MIME type, or undefined. */
export const attachmentType = (mime) => TYPES[mime];

/** Refuse the batch (400) when any file's BYTES do not match its declared type — a renamed .exe never gets stored. */
export function assertRealFiles(files) {
  for (const file of files || []) {
    const type = TYPES[file.mimetype];
    if (!type || !type.verify(file.buffer)) {
      throw new AppError(
        `"${file.originalname}" does not look like a real ${type?.ext?.toUpperCase() || 'supported'} file, so it was not shared.`,
        400,
        { expose: true },
      );
    }
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  // The larger cap (+1 byte: busboy treats reaching the limit as going over, so
  // a file of exactly 40 MB would be refused). assertSizes then holds every
  // file to its own kind's cap, inclusive.
  limits: { fileSize: Math.max(MAX_ATTACHMENT_SIZE, MAX_VIDEO_SIZE) + 1, files: MAX_ATTACHMENTS_PER_MESSAGE },
  fileFilter: (req, file, cb) => {
    file.mimetype = declaredType(file);
    if (!TYPES[file.mimetype]) {
      return cb(new AppError(
        `"${file.originalname}" is a ${file.mimetype || 'unknown'} file. Share a photo, video (MP4, MOV, WebM), PDF, CSV, Excel or Word file.`,
        400,
        { expose: true },
      ), false);
    }
    cb(null, true);
  },
});

/** Accept up to MAX_ATTACHMENTS_PER_MESSAGE files on the `files` field. */
export const uploadChatFiles = upload.array('files', MAX_ATTACHMENTS_PER_MESSAGE);

/** Turn multer's own errors into clean, friendly 400s. */
export const handleChatUploadError = (err, req, res, next) => {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `That file is too big. ${TOO_BIG_TEXT}`
        : err.code === 'LIMIT_FILE_COUNT'
          ? `Too many files. You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} at a time.`
          : 'That upload could not be read. Please try again.';
    return res.status(400).json({ success: false, message });
  }
  return next(err);
};

/** Keep a readable name, drop anything that could confuse a path or a shell. */
export function safeName(original, ext) {
  const base = path.basename(String(original || 'file'))
    .replace(/\.[^.]*$/, '')
    .replace(/[^\w\-. ]+/g, '')
    .trim()
    .slice(0, 80) || 'file';
  return `${base}.${ext}`;
}

/**
 * Verify and upload one batch. Resolves to attachment descriptors ready to
 * store on a message. If any file fails, everything already uploaded in this
 * batch is removed so a half-finished upload never lingers (storage/storeAll.js:
 * a few at a time, all or nothing).
 */
export async function uploadChatAttachments(files, { channelId }) {
  if (!files?.length) return [];

  assertSizes(files);
  assertRealFiles(files);

  // On R2 (STORAGE_PROVIDER=r2, as the rest of the site): PRIVATE objects, read
  // back through GET /chat/channels/:id/files/:name, which checks the reader may
  // see the channel. Chat carries customer details and bank screenshots, so a
  // guessable public URL would be the wrong home. Cloudinary stays as the
  // fallback only while STORAGE_PROVIDER says so.
  if (storageProvider() === 'r2') return uploadToR2(files, channelId);

  return storeAll(files, async (file) => {
    const type = TYPES[file.mimetype];
    const folder = `autobacs/chat/${channelId}`;
    const name = safeName(file.originalname, type.ext);
    const result =
      type.kind === 'image'
        ? await uploadToCloudinary(file.buffer, { folder })
        : type.kind === 'video'
          ? await uploadVideoToCloudinary(file.buffer, { folder })
        // Raw assets keep their extension in the public id so the download URL
        // ends in .pdf/.xlsx and opens in the right app.
        : await uploadRawToCloudinary(file.buffer, {
            folder,
            publicId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${name}`,
          });
    return {
      url: result.secure_url,
      publicId: result.public_id,
      kind: type.kind,
      name,
      mime: file.mimetype,
      size: file.size,
      width: null,
      height: null,
    };
  }, (a) => deleteFromCloudinary(a.publicId, a.kind === 'image' || a.kind === 'video' ? a.kind : 'raw'));
}

/** Where a channel's files live in the private bucket. */
export const chatFolder = (channelId) => `chat/${channelId}`;
/** A stored file name: random prefix (unguessable, unique) + the cleaned original. */
export const CHAT_FILE_NAME = /^[0-9]{13}-[a-z0-9]{8}-[\w\-. ]{1,90}$/;
export const chatFileUrl = (channelId, basename) => `/api/v1/chat/channels/${channelId}/files/${encodeURIComponent(basename)}`;

/** The content type to serve a stored chat file with, from its (server-chosen) extension. */
export function chatFileType(basename) {
  const ext = String(basename).split('.').pop().toLowerCase();
  const found = Object.entries(TYPES).find(([mime, t]) => t.ext === ext && mime !== 'image/jpg');
  return found ? { mime: found[0], kind: found[1].kind } : null;
}

async function uploadToR2(files, channelId) {
  return storeAll(files, async (file) => {
    const type = TYPES[file.mimetype];
    const basename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName(file.originalname, type.ext)}`;
    const stored = await putPrivateAsset({ buffer: file.buffer, folder: chatFolder(channelId), basename, contentType: file.mimetype });
    return {
      url: chatFileUrl(channelId, basename),
      publicId: stored.publicId,
      provider: 'r2',
      kind: type.kind,
      name: safeName(file.originalname, type.ext),
      mime: file.mimetype,
      size: file.size,
      width: null,
      height: null,
    };
  }, (a) => deletePrivateAsset({ publicId: a.publicId, provider: 'r2' }));
}

/**
 * Copy a message's files into another channel, for "Forward".
 *
 * A private (R2) file is served only to people who can read ITS channel
 * (GET /chat/channels/:id/files/:name), so a forwarded message pointing at the
 * original would either 404 for its new readers or need an access rule that
 * reaches across conversations. A real copy under the new channel keeps the
 * one simple rule. Older Cloudinary files already have a public URL and are
 * reused as they are. If any copy fails, the copies made so far are removed.
 */
export async function copyChatAttachments(attachments, { channelId }) {
  const done = [];
  try {
    for (const a of attachments || []) {
      if (a.provider !== 'r2') {
        done.push({ ...a });
        continue;
      }
      const buffer = await readPrivateAsset({ publicId: a.publicId, provider: 'r2' });
      const basename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${a.name}`;
      const stored = await putPrivateAsset({ buffer, folder: chatFolder(channelId), basename, contentType: a.mime });
      done.push({
        url: chatFileUrl(channelId, basename),
        publicId: stored.publicId,
        provider: 'r2',
        kind: a.kind,
        name: a.name,
        mime: a.mime,
        size: a.size,
        width: a.width ?? null,
        height: a.height ?? null,
      });
    }
  } catch (err) {
    await Promise.all(done.filter((a) => a.provider === 'r2' && a.url.includes(`/channels/${channelId}/`))
      .map((a) => deletePrivateAsset({ publicId: a.publicId, provider: 'r2' }).catch(() => {})));
    throw err;
  }
  return done;
}

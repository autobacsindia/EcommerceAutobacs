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
 * Images go to Cloudinary as `image` (so thumbnails work); everything else as
 * `raw`, which is served as an opaque download and never executed or rendered.
 */
import multer from 'multer';
import path from 'path';
import AppError from '../utils/AppError.js';
import { uploadToCloudinary, uploadRawToCloudinary, deleteFromCloudinary } from '../utils/cloudinaryHelpers.js';

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/** mime → { kind, ext, verify(buffer) }. Anything not here is refused. */
const starts = (buf, sig) => buf.length >= sig.length && buf.subarray(0, sig.length).equals(Buffer.from(sig));
const PK_ZIP = [0x50, 0x4b, 0x03, 0x04]; // docx/xlsx are zip containers

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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_SIZE, files: MAX_ATTACHMENTS_PER_MESSAGE },
  fileFilter: (req, file, cb) => {
    if (!TYPES[file.mimetype]) {
      return cb(new AppError(
        `"${file.originalname}" is a ${file.mimetype || 'unknown'} file. Share a photo, PDF, CSV, Excel or Word file.`,
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
        ? `That file is too big. Each file must be under ${MAX_ATTACHMENT_SIZE / (1024 * 1024)} MB.`
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
 * batch is removed so a half-finished upload never lingers in Cloudinary.
 */
export async function uploadChatAttachments(files, { channelId }) {
  if (!files?.length) return [];

  for (const file of files) {
    const type = TYPES[file.mimetype];
    if (!type || !type.verify(file.buffer)) {
      throw new AppError(
        `"${file.originalname}" does not look like a real ${type?.ext?.toUpperCase() || 'supported'} file, so it was not shared.`,
        400,
        { expose: true },
      );
    }
  }

  const done = [];
  try {
    for (const file of files) {
      const type = TYPES[file.mimetype];
      const folder = `autobacs/chat/${channelId}`;
      const name = safeName(file.originalname, type.ext);
      const result =
        type.kind === 'image'
          ? await uploadToCloudinary(file.buffer, { folder })
          // Raw assets keep their extension in the public id so the download URL
          // ends in .pdf/.xlsx and opens in the right app.
          : await uploadRawToCloudinary(file.buffer, {
              folder,
              publicId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${name}`,
            });
      done.push({
        url: result.secure_url,
        publicId: result.public_id,
        kind: type.kind,
        name,
        mime: file.mimetype,
        size: file.size,
        width: null,
        height: null,
      });
    }
  } catch (err) {
    await Promise.all(
      done.map((a) => deleteFromCloudinary(a.publicId, a.kind === 'image' ? 'image' : 'raw').catch(() => {})),
    );
    throw err;
  }
  return done;
}

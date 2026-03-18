/**
 * Upload Middleware — Multer with in-memory buffer storage.
 *
 * Strategy: Use multer memoryStorage (no temp files on disk) and pipe the
 * buffer directly to Cloudinary via uploadToCloudinary(). This works cleanly
 * on Railway/serverless where the filesystem is ephemeral.
 *
 * Security hardening applied:
 *   1. File type: MIME allowlist (multer fileFilter) + magic-byte verification
 *   2. Size limit: 3 MB per file (not 5 MB)
 *   3. Count limit: 8 files per request
 *   4. Empty-file rejection: 0-byte files are rejected
 *
 * Exports:
 *   uploadSingle(fieldName)         — single file upload
 *   uploadMultiple(fieldName, max)  — multiple files (default max 8)
 *   uploadFields(fieldsConfig)      — mixed fields
 *   handleMulterError               — Express error handler for multer errors
 *   validateUploadedFiles           — post-multer server-side magic-byte check
 */
import multer from 'multer';

// ── Constants ──────────────────────────────────────────────────────────────

/** 3 MB — safe balance between usability and memory pressure */
const MAX_FILE_SIZE = 3 * 1024 * 1024;

/** Max files per request — keeps RAM predictable */
const MAX_FILES = 8;

/** Accepted MIME types */
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/**
 * Magic bytes for accepted image formats.
 * Prevents content-type spoofing (e.g. a .exe renamed to .jpg).
 *
 * Format: { mime, signatures: Buffer[] of leading bytes }
 */
const MAGIC_BYTES = [
  // JPEG: FF D8 FF
  { mime: 'image/jpeg', sigs: [Buffer.from([0xFF, 0xD8, 0xFF])] },
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  { mime: 'image/png',  sigs: [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])] },
  // WebP: RIFF????WEBP
  { mime: 'image/webp', sigs: [Buffer.from('RIFF'), Buffer.from('WEBP')] },
];

const matchesMagicBytes = (buffer, mime) => {
  const entry = MAGIC_BYTES.find((m) => m.mime === mime || (mime === 'image/jpg' && m.mime === 'image/jpeg'));
  if (!entry) return false;

  if (mime === 'image/webp') {
    // RIFF at byte 0-3, WEBP at byte 8-11
    return (
      buffer.length >= 12 &&
      buffer.slice(0, 4).equals(entry.sigs[0]) &&
      buffer.slice(8, 12).equals(entry.sigs[1])
    );
  }

  return entry.sigs.some((sig) => buffer.length >= sig.length && buffer.slice(0, sig.length).equals(sig));
};

// ── Storage ────────────────────────────────────────────────────────────────
const storage = multer.memoryStorage();

// ── File Filter (MIME type + empty-file check) ────────────────────────────
const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(
      new multer.MulterError(
        'LIMIT_UNEXPECTED_FILE',
        `Invalid file type "${file.mimetype}". Only JPG, PNG, and WebP are allowed.`
      ),
      false
    );
  }
  cb(null, true);
};

// ── Base multer instance ───────────────────────────────────────────────────
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files:    MAX_FILES,
  },
});

// ── Post-multer server-side validation middleware ──────────────────────────

/**
 * validateUploadedFiles — place AFTER multer middleware, BEFORE controller.
 *
 * Performs:
 *   1. Empty-file rejection (0 bytes)
 *   2. Magic-byte verification (prevents MIME spoofing)
 *
 * @example
 *   router.post('/', protect, admin, uploadMultiple('images'), validateUploadedFiles, asyncHandler(createProduct))
 */
export const validateUploadedFiles = (req, res, next) => {
  const files = req.files
    ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat())
    : req.file
      ? [req.file]
      : [];

  // No files is OK — controller decides whether files are required
  if (!files.length) return next();

  for (const file of files) {
    // Reject empty files
    if (!file.buffer || file.buffer.length === 0) {
      return res.status(400).json({
        success: false,
        message: `File "${file.originalname}" is empty and cannot be uploaded.`,
      });
    }

    // Magic-byte check
    if (!matchesMagicBytes(file.buffer, file.mimetype)) {
      console.warn(
        `[Upload] Magic-byte mismatch: "${file.originalname}" claims ${file.mimetype} but content doesn't match.`
      );
      return res.status(400).json({
        success: false,
        message: `File "${file.originalname}" content does not match its declared type. Only real JPG, PNG, and WebP images are accepted.`,
      });
    }

    console.log(
      `[Upload] Validated: "${file.originalname}" | ${file.mimetype} | ${(file.buffer.length / 1024).toFixed(1)} KB`
    );
  }

  next();
};

// ── Exported middleware factories ──────────────────────────────────────────

/**
 * Single image upload.
 * @param {string} [fieldName='image']
 */
export const uploadSingle = (fieldName = 'image') => upload.single(fieldName);

/**
 * Multiple images under the same field name.
 * @param {string} [fieldName='images']
 * @param {number} [maxCount=8]
 */
export const uploadMultiple = (fieldName = 'images', maxCount = MAX_FILES) =>
  upload.array(fieldName, maxCount);

/**
 * Mixed fields — thumbnail + gallery etc.
 * @param {{ name: string, maxCount: number }[]} fieldsConfig
 */
export const uploadFields = (fieldsConfig) => upload.fields(fieldsConfig);

/**
 * Multer-specific error handler.
 * Must be placed after the route handler as a 4-argument Express error handler.
 */
export const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    let message = 'File upload error.';

    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        message = `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)} MB per image.`;
        break;
      case 'LIMIT_FILE_COUNT':
        message = `Too many files. Maximum is ${MAX_FILES} images per request.`;
        break;
      case 'LIMIT_UNEXPECTED_FILE':
        message = err.field || 'Unexpected file field or invalid file type.';
        break;
      default:
        message = err.message;
    }

    return res.status(400).json({ success: false, message });
  }

  next(err);
};

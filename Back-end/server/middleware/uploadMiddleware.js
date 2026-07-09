/**
 * Upload Middleware — Multer with in-memory buffer storage.
 *
 * Strategy: Use multer memoryStorage (no temp files on disk) and pipe the
 * buffer directly to Cloudinary via uploadToCloudinary(). This works cleanly
 * on Railway/serverless where the filesystem is ephemeral.
 *
 * Security hardening applied:
 *   1. File type: MIME allowlist (multer fileFilter) + magic-byte verification
 *   2. Size limit: 3 MB per file
 *   3. Count limit: 8 files per request
 *   4. Empty-file rejection: 0-byte files are rejected
 *   5. Dimension guard: rejects images wider/taller than MAX_DIMENSION px
 *   6. Duplicate guard: rejects files whose SHA-256 hash matches another in the same request
 *   7. Concurrency guard: rejects uploads when too many requests are uploading simultaneously
 *
 * Exports:
 *   uploadSingle(fieldName)         — single file upload
 *   uploadMultiple(fieldName, max)  — multiple files (default max 8)
 *   uploadFields(fieldsConfig)      — mixed fields
 *   handleMulterError               — Express error handler for multer errors
 *   validateUploadedFiles           — post-multer server-side validation chain
 */
import multer from 'multer';
import crypto from 'crypto';

// ── Constants ──────────────────────────────────────────────────────────────

/** 3 MB — safe balance between usability and memory pressure */
const MAX_FILE_SIZE = 3 * 1024 * 1024;

/** Max files per request — keeps RAM predictable */
const MAX_FILES = 8;

/**
 * Max image dimension in pixels (width OR height).
 * A 3000×3000 JPEG can be <3 MB but still expensive to store/transform.
 * Reject anything wider/taller than this.
 */
const MAX_DIMENSION = 4000;

/**
 * Max simultaneous upload requests server-wide.
 * Prevents 10 admins × 8 × 3 MB = 240 MB RAM spikes.
 */
const MAX_CONCURRENT_UPLOADS = 5;

/** Module-level counter shared across all requests in this process */
let activeUploads = 0;

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

// ── Dimension parser (pure-buffer, no extra dependency) ──────────────────────
/**
 * Read width/height from raw image bytes without fully decoding the image.
 * Supports JPEG (SOF markers), PNG (IHDR chunk), WebP (VP8/VP8L/VP8X chunks).
 * Returns null if dimensions can’t be determined (treated as a pass).
 */
const getDimensions = (buffer, mime) => {
  try {
    const effectiveMime = mime === 'image/jpg' ? 'image/jpeg' : mime;

    if (effectiveMime === 'image/png') {
      // PNG IHDR: bytes 16-23 are width (4) + height (4) big-endian
      if (buffer.length < 24) return null;
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }

    if (effectiveMime === 'image/jpeg') {
      // Scan for SOF0/SOF1/SOF2 markers (FF C0, FF C1, FF C2)
      let i = 2;
      while (i < buffer.length - 8) {
        if (buffer[i] !== 0xFF) break;
        const marker = buffer[i + 1];
        if (marker >= 0xC0 && marker <= 0xC3) {
          // SOF: precision(1) + height(2) + width(2)
          return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
        }
        const segLen = buffer.readUInt16BE(i + 2);
        i += 2 + segLen;
      }
      return null;
    }

    if (effectiveMime === 'image/webp') {
      if (buffer.length < 30) return null;
      const chunkType = buffer.slice(12, 16).toString('ascii');
      if (chunkType === 'VP8 ' && buffer.length >= 34) {
        // Lossy: width/height at bytes 26-29 (14-bit little-endian, minus 1)
        const w = (buffer.readUInt16LE(26) & 0x3FFF) + 1;
        const h = (buffer.readUInt16LE(28) & 0x3FFF) + 1;
        return { width: w, height: h };
      }
      if (chunkType === 'VP8L' && buffer.length >= 25) {
        // Lossless
        const bits = buffer.readUInt32LE(21);
        return { width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 };
      }
      if (chunkType === 'VP8X' && buffer.length >= 34) {
        const w = buffer.readUIntLE(24, 3) + 1;
        const h = buffer.readUIntLE(27, 3) + 1;
        return { width: w, height: h };
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
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
 * concurrentUploadGuard — place BEFORE multer to block overloaded upload slots.
 *
 * Increments activeUploads on entry, decrements on res.finish.
 * Returns 429 immediately if the server is already at MAX_CONCURRENT_UPLOADS.
 *
 * @example
 *   router.post('/', protect, admin, concurrentUploadGuard, uploadMultiple('images'), ...)
 */
export const concurrentUploadGuard = (req, res, next) => {
  if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
    console.warn(
      `[Upload] Concurrent upload limit reached (${activeUploads}/${MAX_CONCURRENT_UPLOADS}). Rejecting request.`
    );
    return res.status(429).json({
      success: false,
      message: 'Server is busy processing other uploads. Please try again in a moment.',
    });
  }

  activeUploads++;
  console.log(`[Upload] Upload slot acquired. Active: ${activeUploads}/${MAX_CONCURRENT_UPLOADS}`);

  // Always release the slot when the response finishes (success or error)
  res.on('finish', () => {
    activeUploads = Math.max(0, activeUploads - 1);
    console.log(`[Upload] Upload slot released. Active: ${activeUploads}/${MAX_CONCURRENT_UPLOADS}`);
  });

  next();
};

/**
 * validateUploadedFiles — place AFTER multer middleware, BEFORE controller.
 *
 * Validation chain (in order):
 *   1. Empty-file rejection (0 bytes)
 *   2. Magic-byte verification (prevents MIME spoofing)
 *   3. Dimension guard (rejects oversized images by pixel count)
 *   4. Duplicate guard (rejects identical files in the same request via SHA-256)
 *
 * @example
 *   router.post('/', protect, admin, concurrentUploadGuard, uploadMultiple('images'), validateUploadedFiles, asyncHandler(createProduct))
 */
export const validateUploadedFiles = (req, res, next) => {
  const files = req.files
    ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat())
    : req.file
      ? [req.file]
      : [];

  // No files is OK — controller decides whether files are required
  if (!files.length) return next();

  const seenHashes = new Set();

  for (const file of files) {
    // 1. Reject empty files
    if (!file.buffer || file.buffer.length === 0) {
      return res.status(400).json({
        success: false,
        message: `File "${file.originalname}" is empty and cannot be uploaded.`,
      });
    }

    // 2. Magic-byte check (prevent MIME spoofing)
    if (!matchesMagicBytes(file.buffer, file.mimetype)) {
      console.warn(
        `[Upload] Magic-byte mismatch: "${file.originalname}" claims ${file.mimetype} but content doesn't match.`
      );
      return res.status(400).json({
        success: false,
        message: `File "${file.originalname}" content does not match its declared type. Only real JPG, PNG, and WebP images are accepted.`,
      });
    }

    // 3. Dimension guard — read pixel dimensions without decoding the full image
    const dims = getDimensions(file.buffer, file.mimetype);
    if (dims) {
      if (dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION) {
        console.warn(
          `[Upload] Dimension rejected: "${file.originalname}" is ${dims.width}×${dims.height}px (max ${MAX_DIMENSION}px)`
        );
        return res.status(400).json({
          success: false,
          message: `Image "${file.originalname}" is too large (${dims.width}×${dims.height}px). ` +
                   `Maximum allowed dimension is ${MAX_DIMENSION}×${MAX_DIMENSION}px.`,
        });
      }
    }

    // 4. Duplicate detection — SHA-256 of file content
    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
    if (seenHashes.has(hash)) {
      console.warn(`[Upload] Duplicate file detected: "${file.originalname}" (SHA-256: ${hash.slice(0, 16)}…)`);
      return res.status(400).json({
        success: false,
        message: `Duplicate file detected: "${file.originalname}" is identical to another file in this upload.`,
      });
    }
    seenHashes.add(hash);

    console.log(
      `[Upload] Validated: "${file.originalname}" | ${file.mimetype} | ` +
      `${(file.buffer.length / 1024).toFixed(1)} KB` +
      (dims ? ` | ${dims.width}×${dims.height}px` : '')
    );
  }

  next();
};

// ── PDF upload (shipping slips, documents) ─────────────────────────────────

/** 5 MB — courier slips are small; keeps memory + email attachment size sane */
const MAX_PDF_SIZE = 5 * 1024 * 1024;

/** %PDF- magic bytes: 25 50 44 46 2D */
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

const pdfFileFilter = (req, file, cb) => {
  if (file.mimetype !== 'application/pdf') {
    return cb(
      new multer.MulterError(
        'LIMIT_UNEXPECTED_FILE',
        `Invalid file type "${file.mimetype}". Only PDF files are allowed.`
      ),
      false
    );
  }
  cb(null, true);
};

const pdfUpload = multer({
  storage,
  fileFilter: pdfFileFilter,
  limits: { fileSize: MAX_PDF_SIZE, files: 1 },
});

/**
 * Single PDF upload (memory buffer). The field is OPTIONAL at the multer level —
 * a request with no file passes through untouched. Pair with validatePdfUpload.
 * @param {string} [fieldName='slip']
 */
export const uploadPdfSingle = (fieldName = 'slip') => pdfUpload.single(fieldName);

/**
 * validatePdfUpload — place AFTER uploadPdfSingle, BEFORE the controller.
 * Rejects empty files and content whose leading bytes aren't a real PDF header
 * (prevents a renamed non-PDF slipping through the MIME check). No file → pass.
 */
export const validatePdfUpload = (req, res, next) => {
  if (!req.file) return next();

  const { buffer, originalname } = req.file;
  if (!buffer || buffer.length === 0) {
    return res.status(400).json({
      success: false,
      message: `File "${originalname}" is empty and cannot be uploaded.`,
    });
  }

  if (buffer.length < PDF_MAGIC.length || !buffer.slice(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    console.warn(`[Upload] PDF magic-byte mismatch: "${originalname}" is not a valid PDF.`);
    return res.status(400).json({
      success: false,
      message: `File "${originalname}" is not a valid PDF document.`,
    });
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

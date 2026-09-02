/**
 * Mint presigned PUT targets for a careers application's files (R2 path).
 *
 * The admin equivalent lives in uploadTargets.js; careers is a separate module
 * because the two differ in every constraint that matters:
 *
 *   - it writes to the PRIVATE bucket (CVs and video answers are PII, and the
 *     private bucket has no public base URL, so no code path here can mint a
 *     permanent public link to an applicant's resume);
 *   - it is PUBLIC and unauthenticated, where the admin path is behind
 *     `protect` + `admin`, so the caps below are the only thing bounding it;
 *   - it uploads into named SLOTS (two video answers, a resume, an optional
 *     supporting document) rather than an arbitrary batch of images.
 *
 * ── The signed Content-Type is a hint, not a control ────────────────────────
 * Verified against the live bucket: R2 does not enforce the Content-Type a URL
 * was signed with — a URL signed for `image/png` accepted `text/html` and R2
 * stored and served it as `text/html`. So the allowlist here shapes the object
 * KEY (and gives the client an early, friendly rejection); it proves nothing
 * about the bytes.
 *
 * The real check is at submit, where the controller reads the first bytes back
 * out of the bucket and identifies the file by its magic number
 * (services/storage/contentSniff.js). That replaces what Cloudinary gave us for
 * free by decoding every upload, and it is why this module must never be
 * mistaken for validation.
 */
import {
  newFolder,
  buildKey,
  slotFromKey as sharedSlotFromKey,
  buildTargets,
} from './privateDirectUpload.js';

/**
 * Base folder every careers upload is constrained to.
 *
 * Re-exported from here rather than imported from utils/careersCloudinary.js so
 * the R2 path does not drag the Cloudinary SDK into its import graph — the same
 * separation that module's own header explains. The two must stay identical:
 * assetScope.js routes this prefix to the PRIVATE bucket, and the retention
 * purge, orphan cleanup and audit scripts all match on it.
 */
export const CAREERS_PREFIX = 'autobacs/careers';

/**
 * Accepted upload types per slot kind, and the extension each maps to.
 *
 * Deliberately generous on video containers: a rejected upload costs a real
 * applicant their application, and the container list is not a security
 * boundary — the magic-byte check at submit is. Document slots are pinned to
 * PDF alone, because that is the slot where arbitrary bytes would otherwise sit
 * undecoded.
 */
export const CAREERS_UPLOAD_TYPES = {
  video: {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/x-matroska': 'mkv',
    'video/x-m4v': 'm4v',
    'video/3gpp': '3gp',
    'video/mpeg': 'mpeg',
    'video/ogg': 'ogv',
    'video/avi': 'avi',
    'video/x-msvideo': 'avi',
  },
  raw: {
    'application/pdf': 'pdf',
  },
};

/** Slot key → the extension map that applies to it. */
export const extensionFor = (resourceType, contentType) =>
  CAREERS_UPLOAD_TYPES[resourceType]?.[String(contentType || '').trim().toLowerCase()] || '';

/** One application may not ask for more targets than it has slots. */
export const MAX_CAREERS_FILES = 4;

/**
 * A fresh, unguessable per-applicant folder.
 *
 * Server-chosen, never client-supplied: it is the only thing stopping one
 * applicant from writing into (or, with the key, reading) another's folder.
 */
export const newCareersFolder = () => newFolder(CAREERS_PREFIX);

/**
 * Build one object key, rejecting a content type the slot does not accept.
 *
 * @returns {string} '' when the type is not allowlisted for this slot
 */
export const buildCareersKey = ({ folder, slot, resourceType, contentType }) =>
  buildKey({ folder, slot, ext: extensionFor(resourceType, contentType) });

/**
 * The slot a key was minted for, or '' for anything we did not mint.
 *
 * Used at submit to confirm the client is attaching each object to the slot it
 * was signed for, so '' must read as a mismatch — never as a pass. See
 * privateDirectUpload.slotFromKey for why the WHOLE key shape is matched rather
 * than just its basename.
 */
export const slotFromKey = (key) => sharedSlotFromKey(CAREERS_PREFIX, key);

/**
 * Presigned PUT targets for one application's files.
 *
 * @param {object} opts
 * @param {string} opts.folder  server-generated (newCareersFolder)
 * @param {Array<{slot:string, contentType:string}>} opts.files
 * @param {Array<{key:string, resourceType:string}>} opts.slots  the slot definitions
 * @returns {Promise<Array<{slot,uploadUrl,key,contentType,expiresIn}>>}
 * @throws  AppError(400, expose) when a slot is unknown or a type is not
 *          allowlisted. `expose` matters: errorMiddleware replaces any message
 *          it does not recognise with "Something went wrong", and this endpoint
 *          is the one place an applicant learns their file was the wrong type.
 *          The messages name only server-side constants — never the client's
 *          own strings, which must not be echoed back into a response.
 *
 *          The batch is rejected WHOLE rather than dropping the offending file:
 *          a partial success would leave the applicant staring at a form that
 *          silently lost one of their answers.
 */
export const buildCareersUploadTargets = ({ folder, files = [], slots = [] }) => {
  const bySlot = new Map(slots.map((s) => [s.key, s]));
  return buildTargets({
    folder,
    files,
    maxFiles: MAX_CAREERS_FILES,
    resolveSlot: (name) => {
      const slot = bySlot.get(name);
      if (!slot) return null;
      const want = slot.resourceType === 'raw' ? 'a PDF' : 'a video (MP4/MOV/WEBM)';
      return {
        key: slot.key,
        label: slot.label,
        extFor: (contentType) => extensionFor(slot.resourceType, contentType),
        // Names the format the applicant needs. A bare "unsupported file type"
        // leaves them re-uploading the same thing.
        typeError: `${slot.label || slot.key} must be ${want}.`,
      };
    },
  });
};

export default {
  CAREERS_PREFIX,
  CAREERS_UPLOAD_TYPES,
  MAX_CAREERS_FILES,
  extensionFor,
  newCareersFolder,
  buildCareersKey,
  slotFromKey,
  buildCareersUploadTargets,
};

/**
 * Return-evidence uploads (R2 path): the customer's unboxing video, proof of
 * purchase, and up to five extra photos, each into the PRIVATE bucket.
 *
 * The careers twin of this is careersUploadTargets.js; both are thin
 * configurations over privateDirectUpload.js, which owns everything that must
 * not vary between them (server-chosen folder, minted key shape, whole-batch
 * rejection, no public URL for a private object).
 *
 * ── Where returns differs from careers ──────────────────────────────────────
 *   - the photo slots are INDEXED (`photo0`…`photo4`) rather than named, because
 *     the count varies per request. They still resolve to distinct slot keys, so
 *     the one-target-per-slot rule keeps holding;
 *   - the proof slot accepts an image OR a PDF — a customer photographs an
 *     invoice as often as they attach one.
 *
 * As always, the content-type allowlist here shapes the KEY and gives an early
 * rejection; it proves nothing about the bytes. Submit-time validation re-reads
 * each object and identifies it by magic number.
 */
import { newFolder, slotFromKey as sharedSlotFromKey, buildTargets } from './privateDirectUpload.js';
import { KIND } from './contentSniff.js';

/**
 * Base folder every return-evidence upload is constrained to.
 *
 * Must stay identical to RETURNS_FOLDER_BASE in utils/returnsCloudinary.js:
 * assetScope.js routes this prefix to the PRIVATE bucket, and the submit-time
 * folder guard matches on it.
 */
export const RETURNS_PREFIX = 'autobacs/returns';

/** Extra photos a customer may attach beyond the two required assets. */
export const MAX_RETURN_PHOTOS = 5;

/** Required video + required proof + the photo slots. */
export const MAX_RETURN_FILES = 2 + MAX_RETURN_PHOTOS;

const VIDEO_TYPES = {
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
};

const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  // Straight off an iPhone. Rejecting these would refuse the most common photo a
  // customer takes, and the sniffer identifies them by their ISO `ftyp` brand.
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/** Proof of purchase: a photographed invoice or an attached one. */
const PROOF_TYPES = { ...IMAGE_TYPES, 'application/pdf': 'pdf' };

/** The slots, in the order the form presents them. */
export const RETURN_SLOTS = [
  /*
    `kinds` is what the magic-byte check enforces at submit; `resourceType` is
    the Cloudinary-era vocabulary the stored ref still carries, kept so an asset
    written under either provider reads back the same way.
  */
  {
    key: 'video', label: 'Unboxing video', types: VIDEO_TYPES,
    resourceType: 'video', kinds: [KIND.VIDEO],
    maxBytes: 60 * 1024 * 1024, capLabel: '60MB',
    want: 'a video (MP4/MOV/WEBM)',
  },
  {
    key: 'proof', label: 'Proof of purchase', types: PROOF_TYPES,
    // A photographed invoice or an attached one — both are normal.
    resourceType: 'image', kinds: [KIND.IMAGE, KIND.PDF],
    maxBytes: 15 * 1024 * 1024, capLabel: '15MB',
    want: 'an image or a PDF',
  },
  ...Array.from({ length: MAX_RETURN_PHOTOS }, (_, i) => ({
    key: `photo${i}`, label: 'Photo', types: IMAGE_TYPES,
    resourceType: 'image', kinds: [KIND.IMAGE],
    maxBytes: 10 * 1024 * 1024, capLabel: '10MB',
    want: 'an image (JPG/PNG/WebP/HEIC)',
  })),
];

const BY_KEY = new Map(RETURN_SLOTS.map((s) => [s.key, s]));

/** A fresh, unguessable per-request folder. */
export const newReturnsFolder = () => newFolder(RETURNS_PREFIX);

/** The slot a key was minted for, or '' for anything we did not mint. */
export const slotFromKey = (key) => sharedSlotFromKey(RETURNS_PREFIX, key);

/**
 * The slot definition a minted key belongs to, or null.
 *
 * Submit-time validation needs this because the client sends a flat list of
 * assets and the KEY is what says which slot each was signed for — the payload's
 * own claim about that is not evidence.
 */
export const slotDefFromKey = (key) => BY_KEY.get(slotFromKey(key)) || null;

/** Presigned PUT targets for one return request's evidence. */
export const buildReturnUploadTargets = ({ folder, files = [] }) =>
  buildTargets({
    folder,
    files,
    maxFiles: MAX_RETURN_FILES,
    resolveSlot: (name) => {
      const slot = BY_KEY.get(name);
      if (!slot) return null;
      return {
        key: slot.key,
        label: slot.label,
        extFor: (contentType) => slot.types[String(contentType || '').trim().toLowerCase()] || '',
        typeError: `${slot.label} must be ${slot.want}.`,
      };
    },
  });

export default {
  RETURNS_PREFIX,
  MAX_RETURN_PHOTOS,
  MAX_RETURN_FILES,
  RETURN_SLOTS,
  newReturnsFolder,
  slotFromKey,
  slotDefFromKey,
  buildReturnUploadTargets,
};

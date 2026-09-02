/**
 * Identify a file from its leading bytes.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Cloudinary DECODED an upload and reported what it actually was, and the
 * careers submit handler checked that against a per-slot allowlist. R2 stores
 * bytes and tells you nothing about them — it does not even enforce the
 * Content-Type a presigned PUT was signed with (verified against the live
 * bucket). Moving careers uploads to R2 without this would silently downgrade a
 * real control into a header the client chooses.
 *
 * This is WEAKER than Cloudinary's decode and should not be mistaken for it: a
 * file can carry a valid container signature and still be corrupt or malicious
 * further in. What it does reliably is reject the substitution that matters —
 * HTML, a script, or an executable presented as a video or a CV.
 *
 * ── Fail closed ─────────────────────────────────────────────────────────────
 * Unrecognised bytes return null, and callers reject on null. The alternative
 * (accept what we cannot identify) would leave the control doing nothing for
 * exactly the inputs an attacker controls. The container lists below are
 * deliberately generous so a legitimate but unusual upload is not caught by
 * that: the cost of a false reject is a real applicant losing their submission.
 */

/** Read a 4-byte ASCII tag, or '' when the buffer is too short. */
const tag = (buf, at) =>
  (buf.length >= at + 4 ? buf.slice(at, at + 4).toString('latin1') : '');

const startsWith = (buf, bytes) =>
  buf.length >= bytes.length && buf.slice(0, bytes.length).equals(Buffer.from(bytes));

/**
 * ISO base-media brands. The `ftyp` box is shared by MP4-family VIDEO and by
 * AVIF/HEIC IMAGES, so the brand at offset 8 is what separates them — treating
 * every `ftyp` as video would file an AVIF as a video answer.
 */
const IMAGE_BRANDS = new Set(['avif', 'avis', 'heic', 'heix', 'hevc', 'mif1', 'msf1']);

/**
 * How many bytes to read back when identifying a file.
 *
 * Every signature this module looks for lives in the first 16 bytes; 512 is
 * slack. The point is that callers do a RANGED read — identifying a 30 MB video
 * answer must not download 30 MB.
 */
export const SNIFF_BYTES = 512;

export const KIND = { VIDEO: 'video', PDF: 'pdf', IMAGE: 'image' };

/**
 * @param {Buffer} buf leading bytes of a file (512 is ample)
 * @returns {'video'|'pdf'|'image'|null} null when unrecognised
 */
export const detectKind = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;

  // ── Documents ────────────────────────────────────────────────────────────
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return KIND.PDF;          // %PDF

  // ── ISO base media: video vs image decided by brand ──────────────────────
  if (tag(buf, 4) === 'ftyp') {
    const brand = tag(buf, 8).toLowerCase().trim();
    return IMAGE_BRANDS.has(brand) ? KIND.IMAGE : KIND.VIDEO;
  }

  // ── Other video containers ───────────────────────────────────────────────
  if (startsWith(buf, [0x1A, 0x45, 0xDF, 0xA3])) return KIND.VIDEO;        // Matroska / WebM
  if (tag(buf, 0) === 'OggS') return KIND.VIDEO;                           // Ogg / Theora
  if (tag(buf, 0) === 'RIFF' && tag(buf, 8) === 'AVI ') return KIND.VIDEO; // AVI
  if (startsWith(buf, [0x00, 0x00, 0x01, 0xBA])) return KIND.VIDEO;        // MPEG-PS
  if (startsWith(buf, [0x00, 0x00, 0x01, 0xB3])) return KIND.VIDEO;        // MPEG video
  if (startsWith(buf, [0x30, 0x26, 0xB2, 0x75])) return KIND.VIDEO;        // ASF / WMV

  // ── Raster images ────────────────────────────────────────────────────────
  if (startsWith(buf, [0xFF, 0xD8, 0xFF])) return KIND.IMAGE;              // JPEG
  if (startsWith(buf, [0x89, 0x50, 0x4E, 0x47])) return KIND.IMAGE;        // PNG
  if (tag(buf, 0) === 'RIFF' && tag(buf, 8) === 'WEBP') return KIND.IMAGE; // WebP
  if (tag(buf, 0).startsWith('GIF8')) return KIND.IMAGE;                   // GIF

  return null;
};

/**
 * Does this file satisfy the slot it was uploaded into?
 *
 * `resourceType` is the vocabulary the careers/returns slots already use
 * ('video' | 'raw' | 'image'), so callers need no translation. 'raw' means a
 * document slot, which in practice is PDF-only.
 */
export const matchesSlot = (buf, resourceType) => {
  const kind = detectKind(buf);
  if (!kind) return false;                                   // fail closed
  if (resourceType === 'video') return kind === KIND.VIDEO;
  if (resourceType === 'raw') return kind === KIND.PDF;
  if (resourceType === 'image') return kind === KIND.IMAGE;
  return false;                                              // unknown slot
};

/**
 * Does this file match ANY of the allowed kinds?
 *
 * Some slots legitimately accept more than one: a customer proves purchase with
 * either a photograph of the invoice or the PDF itself, and forcing one would
 * reject half of them. `matchesSlot` cannot express that, so it stays as the
 * single-kind form the careers slots use and this is the set form.
 *
 * Fails closed on unrecognised bytes, exactly as matchesSlot does — an empty or
 * missing allow-list matches nothing.
 */
export const matchesAnyKind = (buf, kinds) => {
  if (!Array.isArray(kinds) || !kinds.length) return false;
  const kind = detectKind(buf);
  return !!kind && kinds.includes(kind);
};

export default { SNIFF_BYTES, KIND, detectKind, matchesSlot, matchesAnyKind };

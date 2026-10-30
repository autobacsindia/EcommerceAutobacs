/**
 * Staff attachment limits — one set for every panel screen that takes a payment
 * screenshot, a bill, or a parcel photo (and team chat).
 *
 * ── Why there is a limit at all ─────────────────────────────────────────────
 * Uploads are held in server memory while they are checked (multer memory
 * storage), and up to MAX_CONCURRENT_UPLOADS run at once. "No limit" would let
 * a handful of large uploads exhaust the API process that also serves checkout.
 * These numbers are generous for real use — a phone screenshot is ~0.5 MB and
 * the panel shrinks photos before sending — while keeping the worst case
 * bounded: 5 uploads × 40 MB = 200 MB.
 *
 * The frontend mirrors these in src/lib/attachments.ts; change both together.
 */

/** Files in one save (one form submit / one chat message). */
export const MAX_ATTACHMENTS = 20;

/** Each file. A 10-page scanned PDF is ~3 MB; a shrunk phone photo ~0.3 MB. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** All files in one save together. */
export const MAX_ATTACHMENTS_TOTAL_BYTES = 40 * 1024 * 1024;

/** Files one record can hold over its life (an edit can add more). */
export const MAX_ATTACHMENTS_PER_RECORD = 50;

/** "10 MB" — for messages. */
export const mb = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;

export const ATTACHMENT_TYPES_TEXT = 'a photo (JPG, PNG, WebP) or a PDF';

export default {
  MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_TOTAL_BYTES, MAX_ATTACHMENTS_PER_RECORD, mb, ATTACHMENT_TYPES_TEXT,
};

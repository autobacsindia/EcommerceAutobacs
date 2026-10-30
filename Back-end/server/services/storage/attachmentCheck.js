/**
 * Check a batch of staff attachments before anything is stored.
 *
 * The route's multer limits already stop most oversize uploads, but services are
 * also called directly (tests, other services) and multer's per-file limit says
 * nothing about the batch total or what a record already holds. So the rules live
 * here too, with the words a salesman or accountant sees.
 *
 * Type comes from the BYTES (contentSniff), never the browser's label: a renamed
 * .exe or HTML page is refused. The stored contentType is derived from the bytes
 * as well, so the private file proxy can never be talked into serving a script
 * as an image.
 */
import AppError from '../../utils/AppError.js';
import { detectKind, KIND } from './contentSniff.js';
import {
  MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_TOTAL_BYTES, MAX_ATTACHMENTS_PER_RECORD, mb,
} from '../../config/attachments.js';

const fail = (message, status = 400) => new AppError(message, status, { expose: true });

const startsWith = (buf, bytes) => buf.length >= bytes.length && buf.subarray(0, bytes.length).equals(Buffer.from(bytes));

/** The stored type of an accepted file, from its bytes. Only types a browser renders safely inline. */
function typeOf(buf, kind) {
  if (kind === KIND.PDF) return { contentType: 'application/pdf', ext: 'pdf' };
  if (startsWith(buf, [0x89, 0x50, 0x4E, 0x47])) return { contentType: 'image/png', ext: 'png' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { contentType: 'image/webp', ext: 'webp' };
  }
  if (startsWith(buf, [0xFF, 0xD8, 0xFF])) return { contentType: 'image/jpeg', ext: 'jpg' };
  return null; // GIF/HEIC/AVIF: an image, but not one we accept here
}

/**
 * @param {object[]} files multer files ({ buffer, originalname, mimetype })
 * @param {object} [opts]
 * @param {boolean} [opts.allowPdf=true]  false → photos only (e.g. a QR code)
 * @param {number}  [opts.existing=0]     files the record already holds
 * @param {number}  [opts.max=MAX_ATTACHMENTS] files allowed in this save
 * @param {string}  [opts.noun='file']     'screenshot', 'photo' … for messages
 * @returns {{ file: object, contentType: string, ext: string, bytes: number, name: string }[]}
 */
export function checkAttachments(files, { allowPdf = true, existing = 0, max = MAX_ATTACHMENTS, noun = 'file' } = {}) {
  const uploads = (Array.isArray(files) ? files : [files]).filter((f) => f?.buffer?.length);
  if (uploads.length > max) throw fail(`You can attach up to ${max} ${noun}s at a time.`);
  if (existing + uploads.length > MAX_ATTACHMENTS_PER_RECORD) {
    const room = Math.max(0, MAX_ATTACHMENTS_PER_RECORD - existing);
    throw fail(room
      ? `This record can hold ${MAX_ATTACHMENTS_PER_RECORD} files in all — you can add ${room} more.`
      : `This record already has ${MAX_ATTACHMENTS_PER_RECORD} files, the most it can hold.`);
  }
  const total = uploads.reduce((sum, f) => sum + f.buffer.length, 0);
  if (total > MAX_ATTACHMENTS_TOTAL_BYTES) {
    throw fail(`These files add up to more than ${mb(MAX_ATTACHMENTS_TOTAL_BYTES)}. Send fewer at a time.`);
  }
  return uploads.map((file) => {
    const name = String(file.originalname || '').slice(0, 200);
    const label = name ? `"${name}"` : `A ${noun}`;
    if (file.buffer.length > MAX_ATTACHMENT_BYTES) throw fail(`${label} is too large (${mb(MAX_ATTACHMENT_BYTES)} maximum).`);
    const kind = detectKind(file.buffer);
    const type = (kind === KIND.IMAGE || (allowPdf && kind === KIND.PDF)) ? typeOf(file.buffer, kind) : null;
    if (!type) {
      throw fail(allowPdf
        ? `${label} is not a photo (JPG, PNG, WebP) or a PDF.`
        : `${label} is not a photo (JPG, PNG or WebP).`);
    }
    return { file, ...type, bytes: file.buffer.length, name };
  });
}

export default { checkAttachments };

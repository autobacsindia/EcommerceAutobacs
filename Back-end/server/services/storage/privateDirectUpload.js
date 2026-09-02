/**
 * Browser → private bucket, via presigned PUT. The shared machinery behind the
 * careers and returns upload flows.
 *
 * Both flows are the same problem: an unauthenticated (or barely authenticated)
 * caller needs write access to our storage for a handful of files, and every
 * decision about WHERE those bytes land has to stay on the server. What differs
 * between them is only the prefix, the slot names, and which content types each
 * slot accepts — so those are parameters, and the parts that must not vary live
 * here once.
 *
 * ── What the server decides ─────────────────────────────────────────────────
 *   - the folder: a fresh 24-hex nonce under a fixed prefix, so one caller can
 *     never write into (or guess) another's;
 *   - the basename: the slot plus a 16-hex nonce;
 *   - the extension: derived from an ALLOWLISTED content type, never from the
 *     uploaded filename, which is attacker-controlled and is how you end up
 *     serving `.html` off your own domain.
 *
 * ── What this does NOT prove ────────────────────────────────────────────────
 * Nothing about the bytes. R2 does not enforce the Content-Type a URL was signed
 * with — verified against the live bucket, where a URL signed for `image/png`
 * accepted and served `text/html`. The allowlist here shapes the key and gives
 * the client an early, friendly rejection. The real check is the magic-byte
 * sniff at submit time (services/storage/contentSniff.js), which is what
 * replaces the decode Cloudinary used to do for free.
 */
import crypto from 'crypto';
import { presignPut } from './r2Provider.js';
import AppError from '../../utils/AppError.js';

/** A fresh, unguessable per-submission folder under `prefix`. */
export const newFolder = (prefix) => `${prefix}/${crypto.randomBytes(12).toString('hex')}`;

/**
 * Build one object key: `<prefix>/<24hex>/<slot>-<16hex>.<ext>`.
 *
 * The slot is part of the key on purpose. It makes the object self-describing
 * for retention and audit scripts, and it lets submit-time validation reject a
 * slot swap without a network round trip.
 *
 * @returns {string} '' when anything required is missing
 */
export const buildKey = ({ folder, slot, ext }) => {
  if (!folder || !slot || !ext) return '';
  return `${folder}/${slot}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
};

/**
 * The slot a key was minted for, or '' for anything we did not mint.
 *
 * Matches the WHOLE key rather than just its basename. Reading the slot off the
 * last path segment alone would answer "x" for `<prefix>/a/../../products/x-<hex>.mp4`
 * — a string that passes a naive `startsWith(prefix)` check while pointing
 * somewhere else. R2 treats keys as literals and does not resolve `..`, so that
 * string reads nothing; but callers ask this function which slot a key belongs
 * to, and for a key we did not mint the only honest answer is "none". Matching
 * the exact shape gives that for free, and keeps the traversal question from
 * having to be re-answered at every call site.
 *
 * `slot` may contain digits so an indexed slot (`photo0`, `photo1`) round-trips.
 */
export const slotFromKey = (prefix, key) => {
  const re = new RegExp(`^${prefix}/[0-9a-f]{24}/([a-zA-Z][a-zA-Z0-9]*)-[0-9a-f]{16}\\.[a-z0-9]{2,5}$`);
  const m = re.exec(String(key || ''));
  return m ? m[1] : '';
};

/**
 * Presigned PUT targets for one submission.
 *
 * @param {object}   opts
 * @param {string}   opts.folder                 from newFolder()
 * @param {Array<{slot:string, contentType:string}>} opts.files   the client's request
 * @param {Function} opts.resolveSlot            (slotName) => slot | null, where slot is
 *          `{ key, label, extFor(contentType), typeError? }`. `typeError` is the
 *          sentence shown when the type is refused; flows that can say something
 *          specific ("must be a PDF") should, because "unsupported file type" on
 *          its own tells the user nothing about what to do next.
 * @param {number}   opts.maxFiles
 * @returns {Promise<Array<{slot,uploadUrl,key,contentType,expiresIn}>>}
 * @throws  AppError(400, expose) on an unknown slot, a duplicate slot, or a type
 *          the slot does not accept.
 *
 *          `expose` matters: errorMiddleware replaces any message it does not
 *          recognise with "Something went wrong", and this is the one place a
 *          user learns their file was the wrong type. The messages name only
 *          server-side constants — a client's own strings are never echoed back
 *          into a response.
 *
 *          The batch is rejected WHOLE rather than dropping the offending file,
 *          so a submission can never end up referencing something that was never
 *          uploaded.
 */
export const buildTargets = async ({ folder, files = [], resolveSlot, maxFiles }) => {
  const list = Array.isArray(files) ? files.slice(0, maxFiles) : [];
  if (!list.length) return [];

  const seen = new Set();
  const planned = [];

  for (const f of list) {
    const slot = resolveSlot(String(f?.slot || ''));
    if (!slot) {
      // The rejected value is deliberately not quoted back — it is client-supplied
      // and this message is rendered in the user's browser.
      throw new AppError('Unrecognised upload slot.', 400, { expose: true });
    }
    // One target per slot. Without this a caller could request many targets for
    // the same slot and use the endpoint as free storage.
    if (seen.has(slot.key)) {
      throw new AppError(`Duplicate upload for ${slot.label || slot.key}.`, 400, { expose: true });
    }
    seen.add(slot.key);

    const ext = slot.extFor(f?.contentType);
    if (!ext) {
      const msg = slot.typeError || `${slot.label || slot.key}: unsupported file type.`;
      throw new AppError(msg, 400, { expose: true });
    }
    planned.push({ slot, ext, contentType: String(f.contentType).trim().toLowerCase() });
  }

  return Promise.all(planned.map(async ({ slot, ext, contentType }) => {
    const key = buildKey({ folder, slot: slot.key, ext });
    const { url: uploadUrl, expiresIn } = await presignPut({ key, scope: 'private', contentType });
    // No `url` field: a private object has no permanent address, and handing one
    // back is the leak this whole module is shaped to prevent.
    return { slot: slot.key, uploadUrl, key, contentType, expiresIn };
  }));
};

export default { newFolder, buildKey, slotFromKey, buildTargets };

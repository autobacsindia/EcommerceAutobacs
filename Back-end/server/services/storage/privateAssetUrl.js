/**
 * Short-lived read URL for a PRIVATE asset, whichever provider holds it.
 *
 * Careers applications, return evidence and support attachments are all stored
 * confidentially and read through a URL minted per view. During the Cloudinary →
 * R2 migration both providers hold live assets at once, so every read path has
 * to resolve either — and it has to resolve them BEFORE any write moves, or an
 * asset written to R2 becomes unreadable the moment `STORAGE_PROVIDER` is
 * flipped back.
 *
 * ── Routing is explicit, never inferred ─────────────────────────────────────
 * The stored ref carries a `provider` field. It is not guessed from the shape of
 * the id, because a Cloudinary public_id and an R2 object key look identical
 * (`autobacs/careers/<nonce>/<name>`) and a wrong guess here either breaks an
 * admin's view of a CV or, worse, sends us looking in the wrong bucket. Rows
 * written before this field existed have no value, and `undefined` must mean
 * Cloudinary — which is what every caller's `=== 'r2'` test gives us.
 *
 * ⚠ These URLs are bearer credentials: anyone holding one can read the object
 *   until it expires. Same trade Cloudinary's `private_download_url` made, same
 *   mitigation — a short TTL and server-side minting only.
 */
import { presignGet } from './r2Provider.js';
import { r2Config } from '../../config/storage.js';

/**
 * A ref stored before the provider field existed is Cloudinary.
 *
 * Case-normalised: a stray 'R2' would otherwise fall through to Cloudinary and
 * mint a URL that 404s. That is the safe direction (a broken admin view, not a
 * leak), but it is a needless foot-gun when we control every writer.
 */
export const providerOf = (ref) =>
  (String(ref?.provider ?? '').trim().toLowerCase() === 'r2' ? 'r2' : 'cloudinary');

/**
 * Presigned GET against the PRIVATE bucket.
 *
 * `scope` is hard-coded rather than a parameter: there is no legitimate reason
 * to mint a signed URL for a public object (it already has a permanent
 * address), and making it configurable would let a future caller point this at
 * the public bucket by mistake.
 *
 * @param {object}  opts
 * @param {string}  opts.key            R2 object key
 * @param {number}  [opts.ttlSeconds]   defaults to R2_SIGNED_GET_TTL_SECONDS
 * @param {string}  [opts.downloadAs]   force a download with this filename
 * @returns {Promise<string>} '' when the key is unusable
 */
export const r2PrivateUrl = ({ key, ttlSeconds, downloadAs } = {}) => {
  if (!key) return Promise.resolve('');
  return presignGet({
    key,
    scope: 'private',
    expiresIn: ttlSeconds || r2Config().signedGetTtlSeconds,
    downloadAs,
  });
};

export default { providerOf, r2PrivateUrl };

/**
 * The unboxing-video LINK — the way in for a video too big to upload (over
 * VIDEO_MAX_MB). Pure, so it is unit-tested directly and is not swept up by the
 * tests that mock services/returnEvidence.js (the store lookups).
 *
 * https only, and only on VIDEO_LINK_HOSTS by EXACT hostname: a suffix match would
 * let `drive.google.com.evil.example` through. We cannot verify what is behind the
 * link — staff open it at review and reject the return if it does not play.
 */
import AppError from './AppError.js';
import { VIDEO_LINK_HOSTS } from '../config/returnPolicy.js';

export const VIDEO_LINK_MAX_LENGTH = 500;

const BAD_LINK = 'Video link: paste a Google Drive or YouTube link (starting with https://).';

/**
 * The normalised link, or null when none was given.
 * @param {unknown} raw
 * @returns {string|null}
 * @throws {AppError} 400 for anything that is not an allow-listed https link
 */
export const verifyVideoLink = (raw) => {
  if (raw == null) return null;
  if (typeof raw !== 'string') throw new AppError(BAD_LINK, 400, { expose: true });
  const text = raw.trim();
  if (!text) return null;
  if (text.length > VIDEO_LINK_MAX_LENGTH) throw new AppError('Video link is too long.', 400, { expose: true });
  let url;
  try { url = new URL(text); } catch { throw new AppError(BAD_LINK, 400, { expose: true }); }
  if (url.protocol !== 'https:' || url.username || url.password
    || !VIDEO_LINK_HOSTS.includes(url.hostname.toLowerCase())) {
    throw new AppError(BAD_LINK, 400, { expose: true });
  }
  return url.href;
};

export default { verifyVideoLink, VIDEO_LINK_MAX_LENGTH };

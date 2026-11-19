/**
 * Shoppable Reels — constants, single source of truth.
 *
 * A reel is a short customer/team video that tags ONE product. Anyone signed in may
 * upload; staff approve before it is public. The shared API contract lives in the
 * side-session notes (`reels-plan.md`) and is implemented by routes/reels.js and
 * routes/adminReels.js.
 *
 * ── WHAT A REEL NEVER CARRIES ────────────────────────────────────────────────────
 * Money. The product block a client sees (price, MRP, rating, availability) is built
 * LIVE from the product at read time and is display-only — checkout recomputes every
 * figure server-side exactly as it does for any other cart. A reel stores only the
 * product id, so a price edit can never leave a reel advertising a stale price.
 */

const intFromEnv = (name, fallback) => {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Lifecycle.
 *
 *   pending  — uploaded, waiting for staff. Visible only to its creator and staff.
 *   approved — public in the feed.
 *   rejected — staff declined it (reason recorded). Can still be approved later if
 *              staff change their mind; never public meanwhile.
 *   removed  — taken down after being live (or pulled before review). Terminal.
 */
export const REEL_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  REMOVED: 'removed',
});
export const REEL_STATUSES = Object.freeze(Object.values(REEL_STATUS));

/** Which states each moderation action may start from. Anything else is a 409. */
export const REEL_TRANSITIONS = Object.freeze({
  approve: Object.freeze([REEL_STATUS.PENDING, REEL_STATUS.REJECTED]),
  reject: Object.freeze([REEL_STATUS.PENDING]),
  remove: Object.freeze([REEL_STATUS.PENDING, REEL_STATUS.APPROVED, REEL_STATUS.REJECTED]),
});

/** Hard cap on clip length, seconds. A small tolerance absorbs container rounding. */
export const REEL_MAX_DURATION_SEC = 60;
export const REEL_DURATION_TOLERANCE_SEC = 0.5;

/** Hard cap on upload size, bytes. Checked again on the real asset — see reelMediaService. */
export const REEL_MAX_BYTES = intFromEnv('REEL_MAX_BYTES', 100 * 1024 * 1024);

/** Formats Cloudinary will accept on the signed upload. */
export const REEL_ALLOWED_FORMATS = Object.freeze(['mp4', 'mov', 'webm', 'm4v', '3gp']);

/**
 * Cloudinary base folder. Each uploader gets their own sub-folder (`<base>/u_<userId>`)
 * baked into the signature, which is how `POST /reels` proves the asset is theirs:
 * a public id outside the caller's folder is refused.
 */
export const REEL_FOLDER = 'autobacs/reels';
export const REEL_TEAM_FOLDER = `${REEL_FOLDER}/team`;

/** Feed / list page sizes. The contract promises limit ≤ 20. */
export const REEL_PAGE_DEFAULT = 10;
export const REEL_PAGE_MAX = 20;
export const REEL_ADMIN_PAGE_MAX = 50;

/**
 * The feed hides reels whose product is inactive/deleted by filtering AFTER reading a
 * page of reels (the product's state lives on the product, never copied onto the reel,
 * so it cannot drift). Each pass over-reads by this factor, and at most this many
 * passes run, so a run of hidden products costs a bounded amount of work and the
 * cursor still advances past them.
 */
export const REEL_FEED_OVERFETCH = 2;
export const REEL_FEED_MAX_PASSES = 3;

export const REEL_CAPTION_MAX = 300;
export const REEL_REJECT_REASON_MAX = 300;
export const REEL_REPORT_REASON_MAX = 300;

/**
 * Views: a Redis counter, never a Mongo write per view (house rule — per-request
 * telemetry in Mongo once made one collection 95% of the database).
 * One view per (reel, client IP) per this window, so a loop cannot inflate it.
 */
export const REEL_VIEW_DEDUPE_SEC = 60 * 60;
export const reelViewKey = (reelId) => `reels:views:${reelId}`;
export const reelViewSeenKey = (reelId, ipHash) => `reels:viewseen:${reelId}:${ipHash}`;

/**
 * Who may moderate reels and upload for the team: admins, and ACTIVE marketing staff.
 * Mirrors middleware/authMiddleware.js `adminOrMarketing`, which guards /admin/reels.
 */
export const canModerateReels = (user) =>
  user?.role === 'admin'
  || (user?.role === 'staff' && user.staff?.active === true && user.staff.team === 'marketing');

export default {
  REEL_STATUS,
  REEL_STATUSES,
  REEL_TRANSITIONS,
  REEL_MAX_DURATION_SEC,
  REEL_MAX_BYTES,
  REEL_ALLOWED_FORMATS,
  REEL_FOLDER,
  REEL_PAGE_DEFAULT,
  REEL_PAGE_MAX,
};

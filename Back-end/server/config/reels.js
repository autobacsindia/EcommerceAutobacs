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
 *   processing — accepted, but the file is in a format not every phone can play
 *              (HEVC, old 3GP sound…). A background job converts it to H.264/AAC
 *              (services/reelConvertService.js) and then moves it to `pending`
 *              (customer) or `approved` (team upload). Never public, never in the
 *              review queue, and it has no playback link. If the conversion cannot
 *              be done it becomes `rejected` with a plain reason.
 */
export const REEL_STATUS = Object.freeze({
  PROCESSING: 'processing',
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
  remove: Object.freeze([REEL_STATUS.PROCESSING, REEL_STATUS.PENDING, REEL_STATUS.APPROVED, REEL_STATUS.REJECTED]),
});

/** Hard cap on clip length, seconds. A small tolerance absorbs container rounding. */
export const REEL_MAX_DURATION_SEC = 60;
export const REEL_DURATION_TOLERANCE_SEC = 0.5;

/** Hard cap on upload size, bytes. Checked again on the real asset — see reelMediaService. */
export const REEL_MAX_BYTES = intFromEnv('REEL_MAX_BYTES', 100 * 1024 * 1024);

/**
 * Upload types we hand out a target for, and the extension each maps to. The
 * extension comes from this allowlist, never from the uploaded filename.
 *
 * Only ISO base media containers (MP4, MOV, M4V, 3GP, 3G2): that is what lets the
 * server read the clip's real length and codecs back out of storage
 * (services/storage/mp4Probe.js), and what every phone and browser can play once the
 * codec is H.264. The declared type is a hint — the bytes are checked at submit.
 *
 * Deliberately NOT here: WebM, MKV and AVI. iPhones cannot play WebM/MKV at all, and
 * we do not transcode, so accepting them would publish reels that are blank for half
 * the audience. The clients refuse them up front with REEL_UNSUPPORTED_FORMAT_MESSAGE.
 */
export const REEL_UPLOAD_TYPES = Object.freeze({
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/3gpp': '3gp',
  'video/3gpp2': '3g2',
});

/** One plain-English line for any video we cannot take. Clients show the same words. */
export const REEL_UNSUPPORTED_FORMAT_MESSAGE =
  "This video format isn't supported — please record in MP4 or choose a different video.";

/**
 * The type every reel is served as, whatever the uploader stored. MOV and MP4 are the
 * same ISO container, and an H.264 MOV labelled `video/mp4` plays everywhere, whereas
 * `video/quicktime` is refused by some browsers' type check. Forcing it also means a
 * stored object can never be served as anything executable.
 */
export const REEL_PLAYBACK_CONTENT_TYPE = 'video/mp4';

/**
 * Video codecs accepted. H.264 only, so every reel plays on every phone and browser
 * without transcoding. iPhone's default "High Efficiency" (HEVC) is refused with a
 * clear message; the mobile app asks the photo picker for an H.264 copy instead.
 */
export const REEL_ALLOWED_CODECS = Object.freeze(['avc1', 'avc3']);

/**
 * Sound codecs accepted: AAC. A clip with no sound is fine; a clip whose only sound
 * is something else (AMR in old Android 3GP files) is refused, because browsers and
 * iPhones refuse to play it. When a phone writes several sound tracks (e.g. AAC plus
 * a spatial-audio track) one AAC track is enough — players pick that one.
 */
export const REEL_ALLOWED_AUDIO_CODECS = Object.freeze(['mp4a']);

/**
 * ── SERVER CONVERSION (2026-11-28) ───────────────────────────────────────────────
 * A clip whose container we can read but whose codecs are not H.264/AAC is no
 * longer refused: it is converted by ffmpeg in a BullMQ job. Runs inside the
 * backend container (ffmpeg is in the Dockerfile), one clip at a time per replica
 * and on two threads, so an encode cannot starve the HTTP server beside it.
 *
 * `REEL_CONVERT=off` is the kill switch: back to refusing those clips with the
 * "switch off High Efficiency" message. Without a queue Redis (dev, tests) it is
 * off too, because nothing would ever pick the job up.
 */
export const reelConversionEnabled = () =>
  String(process.env.REEL_CONVERT || '').toLowerCase() !== 'off'
  && Boolean(process.env.REDIS_URL || process.env.QUEUE_REDIS_URL);

/** Job id for one reel's conversion. '|' not ':' — BullMQ rejects custom ids containing ':'. */
export const reelConvertJobId = (reelId, ...scope) => ['reel-convert', String(reelId), ...scope].join('|');

/** `media.convert` while a reel is not yet (or could not be) made playable. */
export const REEL_CONVERT_STATE = Object.freeze({ PENDING: 'pending', FAILED: 'failed' });

/**
 * Hard stop for one ffmpeg run. A 60s 1080p clip takes well under two minutes; a
 * 60s 4K/60fps one on two shared threads can take several, so the limit is generous.
 */
export const REEL_CONVERT_TIMEOUT_MS = intFromEnv('REEL_CONVERT_TIMEOUT_MS', 8 * 60 * 1000);
/** Longest side of the converted video, pixels. Phones record 4K; nobody needs it in a feed. */
export const REEL_CONVERT_MAX_SIDE = 1920;
export const REEL_CONVERT_THREADS = intFromEnv('REEL_CONVERT_THREADS', 2);

/** The sweep re-queues a reel stuck in `processing` this long, and gives up after the second. */
export const REEL_CONVERT_STUCK_AFTER_MS = 15 * 60 * 1000;
export const REEL_CONVERT_GIVE_UP_AFTER_MS = 3 * 60 * 60 * 1000;

/** What the uploader reads when their clip could not be converted. */
export const REEL_CONVERT_FAILED_MESSAGE =
  "We couldn't prepare this video for all phones. Please record it again in MP4, or choose a different video.";

/**
 * Where reels live in the PRIVATE R2 bucket. Each uploader gets their own prefix
 * (`<base>/u_<userId>`) and every upload a fresh nonce folder under it, so
 * `POST /reels` can prove the object is the caller's own: a key outside the caller's
 * prefix is refused. The private bucket has no public address — playback is a
 * presigned GET, which also keeps pending reels out of public reach.
 */
export const REEL_FOLDER = 'autobacs/reels';
export const REEL_TEAM_FOLDER = `${REEL_FOLDER}/team`;

/** The slot name in every reel key (`<prefix>/<24hex>/video-<16hex>.<ext>`). */
export const REEL_UPLOAD_SLOT = 'video';

/**
 * How long a playback link stays valid, seconds. Feed responses are `no-store`, so a
 * fresh link is minted on every read; this only has to outlast one viewing session.
 */
export const REEL_PLAYBACK_TTL_SEC = intFromEnv('REEL_PLAYBACK_TTL_SECONDS', 6 * 60 * 60);

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
  REEL_UPLOAD_TYPES,
  REEL_ALLOWED_CODECS,
  REEL_FOLDER,
  REEL_PAGE_DEFAULT,
  REEL_PAGE_MAX,
};

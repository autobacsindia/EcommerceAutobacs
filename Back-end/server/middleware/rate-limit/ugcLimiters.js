import { rateLimit } from './core.js';
import { getClientIp } from './clientIp.js';

export const reviewSubmitRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: 'Too many review submissions. Please wait before submitting again.',
  keyGenerator: (req) => `rate_limit:review_submit:${req.user?._id || getClientIp(req)}`
});

export const questionSubmitRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many question submissions. Please wait before asking again.',
  keyGenerator: (req) => `rate_limit:question_submit:${getClientIp(req)}`
});

export const questionAnswerRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: 'Too many answer submissions. Please slow down.',
  keyGenerator: (req) => `rate_limit:question_answer:${req.user?._id || getClientIp(req)}`
});

// Customer service ratings (routes/orderRatings.js). Keyed on the real client IP
// (cf-connecting-ip), never the user id, so one person cannot spread guesses
// across accounts; a customer needs one submit and maybe an edit or two.
export const orderRatingRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many rating attempts. Please wait a few minutes and try again.',
  keyGenerator: (req) => `rate_limit:order_rating:${getClientIp(req)}`
});

// ── Shoppable reels (routes/reels.js) ──────────────────────────────────────────
// Upload signature + submit: a person posts a few reels, not hundreds. Keyed on the
// account (these routes require auth) so one person cannot spread across IPs.
export const reelUploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many reel uploads. Please try again later.',
  keyGenerator: (req) => `rate_limit:reel_upload:${req.user?._id || getClientIp(req)}`
});

// Like / unlike / report: generous for real swiping, closed to scripts.
export const reelEngageRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many actions. Please slow down.',
  keyGenerator: (req) => `rate_limit:reel_engage:${req.user?._id || getClientIp(req)}`
});

// Views + attribution are public — keyed on the real client IP (cf-connecting-ip).
export const reelViewRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:reel_view:${getClientIp(req)}`
});

export const reelAttributeRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many requests. Please slow down.',
  keyGenerator: (req) => `rate_limit:reel_attr:${getClientIp(req)}`
});

// ── Customer-facing error reports (routes/clientErrors.js) ─────────────────────
// Public, keyed on the real client IP (cf-connecting-ip). A broken page reports a
// handful of errors; a loop or a script is cut off here, and the service caps the
// database writes behind it anyway.
export const clientErrorReportRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Too many reports.',
  keyGenerator: (req) => `rate_limit:client_error:${getClientIp(req)}`
});

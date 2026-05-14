import { rateLimit } from './core.js';

export const reviewSubmitRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: 'Too many review submissions. Please wait before submitting again.',
  keyGenerator: (req) => `rate_limit:review_submit:${req.user?._id || req.ip}`
});

export const questionSubmitRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many question submissions. Please wait before asking again.',
  keyGenerator: (req) => `rate_limit:question_submit:${req.ip || req.connection.remoteAddress}`
});

export const questionAnswerRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: 'Too many answer submissions. Please slow down.',
  keyGenerator: (req) => `rate_limit:question_answer:${req.user?._id || req.ip}`
});

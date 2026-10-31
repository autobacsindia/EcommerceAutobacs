/**
 * The real client IP for rate-limit keys.
 *
 * Behind Cloudflare `req.ip` is the edge, so a limiter keyed on it puts every
 * visitor in one shared bucket and silently does nothing. `cf-connecting-ip` is
 * the visitor. app.js also rewrites `req.ip` from that header, but a limiter
 * must not depend on middleware ordering it cannot see — read the header here.
 *
 * Every limiter keys through this one function so the house rule
 * ("rate-limit by real client IP") has exactly one implementation.
 *
 * @param {import('express').Request} req
 * @returns {string|undefined}
 */
export const getClientIp = (req) =>
  req.headers?.['cf-connecting-ip'] || req.ip || req.connection?.remoteAddress;

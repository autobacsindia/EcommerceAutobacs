/**
 * CSRF token seed endpoint.
 *
 * The global csrfProtection middleware no longer mints XSRF-TOKEN on publicly
 * cacheable GETs — a Set-Cookie there makes the response unstorable by Redis and
 * by the CDN, which previously disabled the entire cache layer (see
 * middleware/csrfMiddleware.js `deferCsrfCookie`).
 *
 * That leaves one gap: a visitor whose session only ever touches cached
 * catalogue routes would hold no token when they first mutate something (e.g. a
 * guest "add to cart"). This endpoint closes it deterministically — the frontend
 * calls it once on boot instead of relying on some other response happening to
 * carry the cookie.
 *
 * Always `no-store`: it mints a per-client secret and must never be shared.
 */

import express from 'express';
import { setCsrfCookie } from '../middleware/csrfMiddleware.js';
import { PRIVATE_NO_STORE } from '../config/cacheProfiles.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.setHeader('Cache-Control', PRIVATE_NO_STORE);
  res.setHeader('Vary', 'Cookie');

  // Reuse the existing token when the client already has one, so calling this
  // repeatedly (or from several tabs) can't rotate a token mid-flight and 403 an
  // in-progress request.
  const token = req.cookies?.['XSRF-TOKEN'] || setCsrfCookie(res);

  res.json({ success: true, csrfToken: token });
});

export default router;

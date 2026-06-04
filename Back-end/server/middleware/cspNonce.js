import { randomBytes } from 'crypto';

/**
 * Generates a cryptographically random nonce per request and stores it in
 * res.locals.nonce. Must be applied before helmet() so that the nonce value
 * is available to the CSP directive functions that helmet calls per request.
 */
export const cspNonceMiddleware = (req, res, next) => {
  res.locals.nonce = randomBytes(16).toString('base64');
  next();
};

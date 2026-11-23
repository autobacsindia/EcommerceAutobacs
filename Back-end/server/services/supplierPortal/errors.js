/**
 * The one error type the supplier API throws on purpose. The router turns it into
 * `{ success: false, message, code, ...extra }` with `status`. Anything else falls
 * through to the global error handler (generic message, Sentry).
 *
 * `code` is machine-readable for the mobile app; `message` is a plain sentence a
 * supplier can act on.
 */
export class PartnerError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'PartnerError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const fail = (status, code, message, extra) => new PartnerError(status, code, message, extra);
export const notFound = () => fail(404, 'NOT_FOUND', 'Not found.');

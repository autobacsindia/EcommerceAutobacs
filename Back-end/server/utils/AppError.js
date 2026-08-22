class AppError extends Error {
  /**
   * @param {string}  message
   * @param {number}  statusCode
   * @param {object}  [options]
   * @param {boolean} [options.expose]  Show this exact message to the caller, whoever they are.
   *
   * ── On `expose` ───────────────────────────────────────────────────────────────
   *
   * errorMiddleware replaces any message it does not recognise with "Something went
   * wrong. Please try again later.", because an error message can carry internals. It
   * recognises messages by EXACT match against a whitelist, which works for fixed copy
   * and fails for anything naming the thing that went wrong.
   *
   * So "Please select a variant for Hypersonic Night Buster 5 LED Aux Light" — written
   * for the buyer, containing nothing but a product name they are already looking at —
   * reached them as "Something went wrong", and a fixable cart problem was
   * indistinguishable from a database outage. That is what made a broken coupon apply
   * take two rounds to diagnose.
   *
   * Set `expose` only where the message is composed entirely of things the caller can
   * already see. It is opt-in precisely so that nothing leaks by default.
   */
  constructor(message, statusCode, { expose = false } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.expose = expose;

    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;

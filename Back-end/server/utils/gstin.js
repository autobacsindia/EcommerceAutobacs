/**
 * GSTIN parsing and validation.
 *
 * ⚠️ THIS IS LOAD-BEARING, NOT COSMETIC. The GSTIN a buyer supplies is printed on
 * the payment receipt we email them (services/invoiceService.js). A typo that
 * reaches that document is worse than collecting no GSTIN at all: it is a wrong
 * identifier on a customer-facing financial record, and the customer will not
 * notice until they try to use it.
 *
 * The check digit is what makes that catchable. A GSTIN is not an opaque string
 * — its 15th character is a mod-36 checksum over the first 14, so a single
 * mistyped character is detected here rather than at the customer's accountant.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * It does not call the GSTN network to confirm the registration exists or is
 * active. That call belongs nowhere near the checkout request path: it would put
 * a government endpoint's availability and rate limits between a buyer and a
 * payment. Format + checksum rejects every typo; only a well-formed GSTIN
 * belonging to someone else survives, and that is a fraud question, not a
 * validation one. Asynchronous verification can be layered on later without
 * changing this contract.
 *
 * Format (15 chars): SS PPPPPPPPPP E Z C
 *   SS  state code            2 digits, must be a code GST actually issues under
 *   PPP PAN of the registrant 5 letters, 4 digits, 1 letter
 *   E   entity number         1-9 or A-Z (nth registration for that PAN in that state)
 *   Z   literal 'Z'           reserved, constant today
 *   C   check digit           mod-36 checksum over the first 14 characters
 */

import { GST_STATE_BY_CODE, isKnownStateCode } from '../config/gstStates.js';

/** Value alphabet for the checksum: '0'-'9' = 0-35 through 'Z'. */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const GSTIN_LENGTH = 15;

/** Structural shape, checked before the (more expensive, less obvious) checksum. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Upper-case and strip the spaces and hyphens people paste in from invoices.
 * Never mutates meaning — only whitespace and separators are removed.
 */
export const normalizeGstin = (value) =>
  String(value ?? '').replace(/[\s-]/g, '').toUpperCase();

/**
 * The mod-36 check digit for the first 14 characters of a GSTIN.
 *
 * Each character's alphabet value is multiplied by an alternating factor (1 for
 * even positions, 2 for odd), and the quotient and remainder of that product
 * against 36 are both added to the running sum — which is what lets the scheme
 * catch transpositions, not just substitutions.
 *
 * Exported because tests must BUILD valid fixtures rather than invent them: a
 * hand-typed 15-character string is overwhelmingly likely to have a wrong check
 * digit, so a test written that way would pass for the wrong reason.
 *
 * @param {string} first14
 * @returns {string} the expected 15th character
 */
export const gstinCheckDigit = (first14) => {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = ALPHABET.indexOf(first14[i]);
    if (value === -1) return null;
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36];
};

/**
 * Validate a GSTIN and derive what we store from it.
 *
 * Returns a result object rather than throwing so callers can map the reason
 * onto their own error type — the order controller turns it into a 400 naming
 * the specific problem, because "invalid GSTIN" alone leaves a buyer retyping
 * the same correct string.
 *
 * @param {string} raw
 * @returns {{valid: boolean, reason?: string, message?: string, gstin?: string, stateCode?: string, state?: string, pan?: string}}
 */
export const validateGstin = (raw) => {
  const gstin = normalizeGstin(raw);

  if (!gstin) {
    return { valid: false, reason: 'missing', message: 'GSTIN is required for an enterprise purchase.' };
  }
  if (gstin.length !== GSTIN_LENGTH) {
    return {
      valid: false,
      reason: 'length',
      message: `A GSTIN is ${GSTIN_LENGTH} characters; this one is ${gstin.length}.`,
    };
  }
  if (!GSTIN_PATTERN.test(gstin)) {
    return {
      valid: false,
      reason: 'format',
      message: 'That is not a valid GSTIN format. Expected 15 characters, e.g. 27AAPFU0939F1ZV.',
    };
  }

  const stateCode = gstin.slice(0, 2);
  if (!isKnownStateCode(stateCode)) {
    return {
      valid: false,
      reason: 'state_code',
      message: `"${stateCode}" is not a GST state code. Check the first two digits of your GSTIN.`,
    };
  }

  if (gstinCheckDigit(gstin.slice(0, 14)) !== gstin[14]) {
    // The single most valuable check here: this is a typo, not a wrong entity.
    return {
      valid: false,
      reason: 'checksum',
      message: 'That GSTIN failed its check-digit test — please re-check it for a typo.',
    };
  }

  return {
    valid: true,
    gstin,
    stateCode,
    state: GST_STATE_BY_CODE[stateCode],
    pan: gstin.slice(2, 12),
  };
};

/** Convenience predicate for call sites that only need yes/no. */
export const isValidGstin = (raw) => validateGstin(raw).valid;

export default validateGstin;

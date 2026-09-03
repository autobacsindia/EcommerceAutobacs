/**
 * Buyer identity + legal acceptance — resolved ONCE, for every order path.
 *
 * There are three ways an order gets created (storefront checkout, guest
 * checkout, and an admin recording an offline deal) and all three must record
 * the same things the same way. A second implementation is how one path ends up
 * writing an enterprise order with no GSTIN, or an acceptance with no version.
 * So this module owns the whole decision and the callers only pass input
 * through.
 *
 * ⚠️ WHAT IS DELIBERATELY NOT TAKEN FROM THE CLIENT
 *  - the terms/privacy VERSION. Written from config/legalDocuments.js. A client
 *    that names its own version chooses which contract binds it.
 *  - the governing-law TRACK. Derived from the validated buyer type, not sent.
 *  - the billing STATE. Derived from the GSTIN's state code. GST registration is
 *    per state, so the GSTIN already says which state the bill-to belongs in —
 *    a typed state field could only ever disagree with it.
 *
 * Everything here is a pure function of its arguments so it can be tested
 * without a database, an HTTP request, or a mock.
 */

import AppError from '../utils/AppError.js';
import { validateGstin } from '../utils/gstin.js';
import {
  BUYER_TYPES,
  BUYER_TYPE_VALUES,
  trackForBuyerType,
} from '../config/buyer.js';
import { buildAcceptanceSnapshot } from '../config/legalDocuments.js';

/** 4xx that actually reaches the buyer — see the `expose` note in utils/AppError.js. */
const reject = (message) => {
  throw new AppError(message, 400, { expose: true });
};

const trimmed = (value) => String(value ?? '').trim();

/** Fields a bill-to block cannot be rendered without. `state` is never among them. */
const REQUIRED_BILLING_FIELDS = [
  ['addressLine1', 'address'],
  ['city', 'city'],
  ['postalCode', 'postal code'],
];

const LEGAL_NAME_MAX = 200;

/**
 * Normalise and validate the billing address supplied for an enterprise buyer.
 *
 * @param {object} input     raw billingAddress from the request
 * @param {string} state     canonical state derived from the GSTIN
 * @param {string} stateCode two-digit GST state code
 */
const resolveBillingAddress = (input, state, stateCode) => {
  const address = input && typeof input === 'object' ? input : {};

  const missing = REQUIRED_BILLING_FIELDS
    .filter(([field]) => !trimmed(address[field]))
    .map(([, label]) => label);

  if (missing.length) {
    reject(
      `A billing ${missing.join(', ')} is required for an enterprise purchase. ` +
      'It is what appears on your receipt.'
    );
  }

  return {
    addressLine1: trimmed(address.addressLine1),
    ...(trimmed(address.addressLine2) && { addressLine2: trimmed(address.addressLine2) }),
    city: trimmed(address.city),
    // Authoritative, from the GSTIN. Any client-sent `state` is discarded.
    state,
    stateCode,
    postalCode: trimmed(address.postalCode),
    country: trimmed(address.country) || 'India',
    ...(trimmed(address.phone) && { phone: trimmed(address.phone) }),
  };
};

/**
 * Resolve the `buyer` subdocument from a request body.
 *
 * An absent or `individual` type yields the minimal individual buyer — which is
 * what every pre-existing order effectively is, so nothing needs backfilling.
 *
 * @param {object} raw  request body `buyer` object
 * @returns {{type: string, legalName?: string, gstin?: string, stateCode?: string, billingAddress?: object}}
 */
export const resolveBuyer = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const type = trimmed(input.type) || BUYER_TYPES.INDIVIDUAL;

  if (!BUYER_TYPE_VALUES.includes(type)) {
    reject(`Buyer type must be one of: ${BUYER_TYPE_VALUES.join(', ')}.`);
  }

  if (type === BUYER_TYPES.INDIVIDUAL) {
    // Nothing else is recorded. In particular a GSTIN sent alongside
    // type=individual is dropped rather than stored: it would put a tax
    // identifier on a receipt for a purchase made on the consumer track.
    return { type: BUYER_TYPES.INDIVIDUAL };
  }

  const legalName = trimmed(input.legalName);
  if (!legalName) {
    reject('A registered legal name is required for an enterprise purchase.');
  }
  if (legalName.length > LEGAL_NAME_MAX) {
    reject(`The registered legal name must be ${LEGAL_NAME_MAX} characters or fewer.`);
  }

  // This is the gate that keeps consumers out of the arbitration track, and the
  // check digit is what keeps a typo off the receipt we email them.
  const gst = validateGstin(input.gstin);
  if (!gst.valid) reject(gst.message);

  return {
    type: BUYER_TYPES.ENTERPRISE,
    legalName,
    gstin: gst.gstin,
    stateCode: gst.stateCode,
    billingAddress: resolveBillingAddress(input.billingAddress, gst.state, gst.stateCode),
  };
};

/**
 * Resolve the buyer AND the legal-acceptance snapshot together.
 *
 * They are resolved as one unit because the track recorded in the acceptance has
 * to be derived from the SAME validated buyer that is stored — computing them
 * apart is how an order ends up recording consent to §17B while its buyer says
 * `individual`.
 *
 * @param {object}  body                request body
 * @param {object}  [options]
 * @param {boolean} [options.requireAcceptance=true]  false only for admin-recorded offline orders
 * @param {string}  [options.ipHash]    hashed client IP, for the acceptance record
 * @param {Date}    [options.acceptedAt]
 * @returns {{buyer: object, legalAcceptance: object}}
 */
export const resolveBuyerAndAcceptance = (body = {}, options = {}) => {
  const { requireAcceptance = true, ipHash = null, acceptedAt = new Date() } = options;

  const buyer = resolveBuyer(body.buyer);

  // Strictly `true`. A missing checkbox arrives as undefined, and the string
  // "false" is truthy — accepting either would record consent nobody gave.
  const accepted = body.acceptTerms === true || body.acceptTerms === 'true';
  if (requireAcceptance && !accepted) {
    reject(
      'You must accept the Terms and Conditions and the Privacy Policy to place an order.'
    );
  }

  const legalAcceptance = buildAcceptanceSnapshot({
    track: trackForBuyerType(buyer.type),
    acceptedAt,
    ipHash,
  });

  return { buyer, legalAcceptance };
};

export default { resolveBuyer, resolveBuyerAndAcceptance };

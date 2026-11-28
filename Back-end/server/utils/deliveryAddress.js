/**
 * The delivery-address rule — the ONE server copy.
 *
 * Couriers kept phoning customers because "Kochi" passed as a full address.
 * Every address a person types (website checkout, saved addresses, staff,
 * offline and sales-quotation orders, the admin address edit) now needs:
 *
 *   • houseNumber  — House name / flat / building no. (required)   e.g. "Rose Villa" or "Flat 4B, Jomer Symphony"
 *   • addressLine1 — Street / Area, real detail (required)    e.g. "MG Road, Edappally"
 *   • landmark     — optional                                  e.g. "Opp. Lulu Mall"
 *
 * `addressLine1` keeps its old name so the ~all existing orders and saved
 * addresses read exactly as before; `addressLine2` stays as an optional extra
 * line. New fields are OPTIONAL in the Mongoose schemas — old records must
 * still load — and required only where a person enters an address.
 *
 * Mirrors (keep the logic identical; the shared case table proves it):
 *   Front-end/web/src/lib/deliveryAddress.ts
 *   Mobile/roavion/lib/deliveryAddress.ts
 *   shared/delivery-address-cases.json   ← every copy's tests run these
 */

export const ADDRESS_LIMITS = Object.freeze({ houseNumber: 100, street: 200, landmark: 100 });

export const ADDRESS_MESSAGES = Object.freeze({
  houseRequired: 'Enter your house name or flat / building number, e.g. "Rose Villa" or "Flat 4B, Jomer Symphony".',
  houseJunk: 'That house name / number doesn\'t look right. Enter it as the courier would read it, e.g. "Rose Villa", "12/345" or "Flat 4B".',
  houseLong: `House name / flat / building is too long (max ${ADDRESS_LIMITS.houseNumber} characters).`,
  streetRequired: 'Enter the street and area, e.g. "MG Road, Edappally".',
  streetShort: 'Add a little more detail: street AND area, e.g. "MG Road, Edappally" (one word isn\'t enough for the courier).',
  streetJunk: 'That street / area doesn\'t look right. Enter the real street and area, e.g. "MG Road, Edappally".',
  streetLong: `Street / area is too long (max ${ADDRESS_LIMITS.street} characters).`,
  landmarkJunk: 'That landmark doesn\'t look right. Enter a place nearby, e.g. "Opp. Lulu Mall", or leave it empty.',
  landmarkLong: `Landmark is too long (max ${ADDRESS_LIMITS.landmark} characters).`,
});

// Whole-value placeholders people type to get past a required field.
const PLACEHOLDERS = new Set([
  'na', 'n/a', 'nil', 'none', 'null', 'nill', 'no', 'nothing', 'test', 'testing', 'abc', 'xyz', 'xxx', 'asdf',
  'qwerty', 'same', 'address', 'house', 'home', 'street', 'area', 'road', 'landmark', 'unknown', 'dummy', 'sample',
]);

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const compact = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const words = (s) => s.split(/[\s,./\\-]+/).map(compact).filter(Boolean);

/**
 * Pure: does this value look like filler rather than an address part?
 * "-", "....", "aaaa", "na", "test test", "0000".
 */
export function looksLikeJunk(value) {
  const s = clean(value);
  const c = compact(s);
  if (!c) return true; // only punctuation / spaces
  if (PLACEHOLDERS.has(s.toLowerCase()) || PLACEHOLDERS.has(c)) return true;
  if (/^0+$/.test(c)) return true; // "0", "000"
  if (c.length >= 2 && /^([a-z])\1+$/.test(c)) return true; // "aa", "aaaa"
  if (/([a-z])\1{3,}/.test(c)) return true; // a run of 4+ of one letter: "aaaab"
  const w = words(s);
  if (w.length >= 2 && w.every((x) => x === w[0])) return true; // "test test", "abc abc"
  if (w.length && w.every((x) => PLACEHOLDERS.has(x))) return true; // "na na", "same address"
  return false;
}

/** @returns {string|null} a message, or null when fine */
export function checkHouseNumber(value) {
  const s = clean(value);
  if (!s) return ADDRESS_MESSAGES.houseRequired;
  if (s.length > ADDRESS_LIMITS.houseNumber) return ADDRESS_MESSAGES.houseLong;
  if (looksLikeJunk(s)) return ADDRESS_MESSAGES.houseJunk;
  return null;
}

/** Street / Area: at least two words with real letters in them. */
export function checkStreet(value) {
  const s = clean(value);
  if (!s) return ADDRESS_MESSAGES.streetRequired;
  if (s.length > ADDRESS_LIMITS.street) return ADDRESS_MESSAGES.streetLong;
  if (looksLikeJunk(s)) return ADDRESS_MESSAGES.streetJunk;
  const w = words(s);
  const letters = (s.match(/[a-z]/gi) || []).length;
  if (w.length < 2 || s.length < 6) return ADDRESS_MESSAGES.streetShort;
  if (letters < 4) return ADDRESS_MESSAGES.streetJunk;
  return null;
}

/** Landmark is optional; if given it must be a real place. */
export function checkLandmark(value) {
  const s = clean(value);
  if (!s) return null;
  if (s.length > ADDRESS_LIMITS.landmark) return ADDRESS_MESSAGES.landmarkLong;
  if (looksLikeJunk(s) || s.length < 3 || !/[a-z]/i.test(s)) return ADDRESS_MESSAGES.landmarkJunk;
  return null;
}

/**
 * Pure: every problem with the three street-level fields.
 * @param {{houseNumber?:string, addressLine1?:string, landmark?:string}} addr
 * @returns {{houseNumber?:string, addressLine1?:string, landmark?:string}} empty when valid
 */
export function deliveryAddressProblems(addr = {}) {
  const out = {};
  const h = checkHouseNumber(addr?.houseNumber);
  const s = checkStreet(addr?.addressLine1);
  const l = checkLandmark(addr?.landmark);
  if (h) out.houseNumber = h;
  if (s) out.addressLine1 = s;
  if (l) out.landmark = l;
  return out;
}

/** First problem, or null. */
export function firstAddressProblem(addr) {
  const p = deliveryAddressProblems(addr);
  return p.houseNumber || p.addressLine1 || p.landmark || null;
}

/** Pure: does a saved/old address already meet today's rule? (checkout asks to complete it if not) */
export function isAddressComplete(addr) {
  return !firstAddressProblem(addr);
}

/** Trimmed copies of the three fields (landmark '' when not given). */
export function cleanStreetFields(addr = {}) {
  return {
    houseNumber: clean(addr.houseNumber),
    addressLine1: clean(addr.addressLine1),
    landmark: clean(addr.landmark),
  };
}

/**
 * Pure: the street-level lines, in the order a courier reads them. Works for
 * old addresses too (no houseNumber/landmark → exactly the old lines).
 *   ["Flat 4B, Jomer Symphony", "MG Road, Edappally", "Landmark: Opp. Lulu Mall"]
 */
export function streetLines(addr = {}) {
  const a = addr || {};
  return [
    clean(a.houseNumber),
    clean(a.addressLine1),
    clean(a.addressLine2),
    clean(a.landmark) ? `Landmark: ${clean(a.landmark)}` : '',
  ].filter(Boolean);
}

/**
 * express-validator chains for `<prefix>.houseNumber`, `.addressLine1`, `.landmark`.
 * Imported lazily-free: express-validator is a server dependency already.
 * @param {Function} body  express-validator's `body`
 * @param {string} prefix  e.g. 'shippingAddress'
 */
export function addressFieldRules(body, prefix) {
  const rule = (field, check) => body(`${prefix}.${field}`)
    .custom((v) => {
      const msg = check(v);
      if (msg) throw new Error(msg);
      return true;
    })
    .customSanitizer((v) => clean(v));
  return [
    rule('houseNumber', checkHouseNumber),
    rule('addressLine1', checkStreet),
    rule('landmark', checkLandmark),
  ];
}

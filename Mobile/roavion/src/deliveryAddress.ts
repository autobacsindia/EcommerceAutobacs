/**
 * The delivery-address rule — mobile app copy.
 *
 * MIRROR of Back-end/server/utils/deliveryAddress.js (the server is the
 * authority and re-checks every order) and Front-end/web/src/lib/deliveryAddress.ts.
 * Keep the logic identical: shared/delivery-address-cases.json is the case table.
 *
 *   houseNumber  — House name / flat / building no. (required)  e.g. "Rose Villa" or "Flat 4B, Jomer Symphony"
 *   addressLine1 — Street / Area (required, real detail)   e.g. "MG Road, Edappally"
 *   landmark     — optional                                 e.g. "Opp. Lulu Mall"
 */

export const ADDRESS_LIMITS = { houseNumber: 100, street: 200, landmark: 100 } as const;

export const ADDRESS_MESSAGES = {
  houseRequired: 'Enter your house name or flat / building number, e.g. "Rose Villa" or "Flat 4B, Jomer Symphony".',
  houseJunk: 'That house name / number doesn\'t look right. Enter it as the courier would read it, e.g. "Rose Villa", "12/345" or "Flat 4B".',
  houseLong: `House name / flat / building is too long (max ${ADDRESS_LIMITS.houseNumber} characters).`,
  streetRequired: 'Enter the street and area, e.g. "MG Road, Edappally".',
  streetShort: 'Add a little more detail: street AND area, e.g. "MG Road, Edappally" (one word isn\'t enough for the courier).',
  streetJunk: 'That street / area doesn\'t look right. Enter the real street and area, e.g. "MG Road, Edappally".',
  streetLong: `Street / area is too long (max ${ADDRESS_LIMITS.street} characters).`,
  landmarkJunk: 'That landmark doesn\'t look right. Enter a place nearby, e.g. "Opp. Lulu Mall", or leave it empty.',
  landmarkLong: `Landmark is too long (max ${ADDRESS_LIMITS.landmark} characters).`,
} as const;

/** Labels and placeholders, the same on every form. */
export const ADDRESS_FIELD_TEXT = {
  houseNumber: { label: 'House name / flat / building no.', placeholder: 'e.g. Rose Villa or Flat 4B, Jomer Symphony' },
  addressLine1: { label: 'Street / Area', placeholder: 'e.g. MG Road, Edappally' },
  landmark: { label: 'Landmark (optional)', placeholder: 'e.g. Opp. Lulu Mall' },
} as const;

const PLACEHOLDERS = new Set([
  'na', 'n/a', 'nil', 'none', 'null', 'nill', 'no', 'nothing', 'test', 'testing', 'abc', 'xyz', 'xxx', 'asdf',
  'qwerty', 'same', 'address', 'house', 'home', 'street', 'area', 'road', 'landmark', 'unknown', 'dummy', 'sample',
]);

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const words = (s: string) => s.split(/[\s,./\\-]+/).map(compact).filter(Boolean);

export function looksLikeJunk(value: unknown): boolean {
  const s = clean(value);
  const c = compact(s);
  if (!c) return true;
  if (PLACEHOLDERS.has(s.toLowerCase()) || PLACEHOLDERS.has(c)) return true;
  if (/^0+$/.test(c)) return true;
  if (c.length >= 2 && /^([a-z])\1+$/.test(c)) return true;
  if (/([a-z])\1{3,}/.test(c)) return true;
  const w = words(s);
  if (w.length >= 2 && w.every((x) => x === w[0])) return true;
  if (w.length && w.every((x) => PLACEHOLDERS.has(x))) return true;
  return false;
}

export function checkHouseNumber(value: unknown): string | null {
  const s = clean(value);
  if (!s) return ADDRESS_MESSAGES.houseRequired;
  if (s.length > ADDRESS_LIMITS.houseNumber) return ADDRESS_MESSAGES.houseLong;
  if (looksLikeJunk(s)) return ADDRESS_MESSAGES.houseJunk;
  return null;
}

export function checkStreet(value: unknown): string | null {
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

export function checkLandmark(value: unknown): string | null {
  const s = clean(value);
  if (!s) return null;
  if (s.length > ADDRESS_LIMITS.landmark) return ADDRESS_MESSAGES.landmarkLong;
  if (looksLikeJunk(s) || s.length < 3 || !/[a-z]/i.test(s)) return ADDRESS_MESSAGES.landmarkJunk;
  return null;
}

export interface StreetFields {
  houseNumber?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  landmark?: string | null;
}
export type StreetField = 'houseNumber' | 'addressLine1' | 'landmark';

export function deliveryAddressProblems(a: StreetFields = {}): Partial<Record<StreetField, string>> {
  const out: Partial<Record<StreetField, string>> = {};
  const h = checkHouseNumber(a?.houseNumber);
  const s = checkStreet(a?.addressLine1);
  const l = checkLandmark(a?.landmark);
  if (h) out.houseNumber = h;
  if (s) out.addressLine1 = s;
  if (l) out.landmark = l;
  return out;
}

export function firstAddressProblem(a: StreetFields): string | null {
  const p = deliveryAddressProblems(a);
  return p.houseNumber || p.addressLine1 || p.landmark || null;
}

/** Does a saved/old address meet today's rule? Checkout asks to complete it if not. */
export function isAddressComplete(a: StreetFields): boolean {
  return !firstAddressProblem(a);
}

/** Street-level lines in courier order; old addresses render exactly as before. */
export function streetLines(a: StreetFields | null | undefined): string[] {
  const x = a || {};
  return [
    clean(x.houseNumber),
    clean(x.addressLine1),
    clean(x.addressLine2),
    clean(x.landmark) ? `Landmark: ${clean(x.landmark)}` : '',
  ].filter(Boolean);
}

/**
 * Buyer categories + client-side GSTIN checking.
 *
 * Mirrors Back-end/server/config/buyer.js and utils/gstin.js.
 *
 * ⚠️ THIS IS FOR FEEDBACK ONLY. The server re-validates everything in
 * services/buyerService.js and is the sole authority — nothing here is trusted,
 * and removing it would change no security property. It exists so a buyer who
 * fat-fingers a 15-character GSTIN learns immediately, instead of after filling
 * in a billing address and pressing Place Order.
 *
 * The check-digit algorithm is duplicated rather than fetched because it is a
 * pure, fixed function (a GSTIN's 15th character is a mod-36 checksum over the
 * first 14) — a network round-trip per keystroke to compute it would be absurd.
 */

export const BUYER_TYPES = {
  INDIVIDUAL: 'individual',
  ENTERPRISE: 'enterprise',
} as const;

export type BuyerType = (typeof BUYER_TYPES)[keyof typeof BUYER_TYPES];

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** GST state codes, so the UI can name the state a GSTIN is registered in. */
export const GST_STATE_BY_CODE: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '25': 'Dadra and Nagar Haveli and Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '28': 'Andhra Pradesh', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh',
  '38': 'Ladakh', '97': 'Other Territory', '99': 'Centre Jurisdiction',
};

/**
 * Common short forms typed into a free-text state field. Mirrors the table in
 * Back-end/server/config/gstStates.js — kept in sync by the parity test.
 */
const STATE_ALIASES: Record<string, string> = {
  ap: 'Andhra Pradesh', ar: 'Arunachal Pradesh', as: 'Assam', br: 'Bihar',
  cg: 'Chhattisgarh', ch: 'Chandigarh', dl: 'Delhi', ga: 'Goa', gj: 'Gujarat',
  hr: 'Haryana', hp: 'Himachal Pradesh', jh: 'Jharkhand', jk: 'Jammu and Kashmir',
  ka: 'Karnataka', kl: 'Kerala', la: 'Ladakh', ld: 'Lakshadweep',
  mh: 'Maharashtra', ml: 'Meghalaya', mn: 'Manipur', mp: 'Madhya Pradesh',
  mz: 'Mizoram', nl: 'Nagaland', od: 'Odisha', or: 'Odisha', pb: 'Punjab',
  py: 'Puducherry', rj: 'Rajasthan', sk: 'Sikkim', tn: 'Tamil Nadu',
  tg: 'Telangana', ts: 'Telangana', tr: 'Tripura', uk: 'Uttarakhand',
  ua: 'Uttarakhand', up: 'Uttar Pradesh', wb: 'West Bengal',
  ncr: 'Delhi', newdelhi: 'Delhi',
};

const normalizeStateText = (value: string) =>
  String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * Does a free-text state plausibly name the same state as a GSTIN-derived one?
 *
 * Returns FALSE when it cannot tell. Used only to ask for an explicit billing
 * address, never to block — a false negative on an odd spelling costs the buyer
 * a few keystrokes, which is the right way round.
 */
export function statesMatch(text: string, canonical: string): boolean {
  const a = normalizeStateText(text);
  const b = normalizeStateText(canonical);
  if (!a || !b) return false;
  if (a === b) return true;
  const expanded = STATE_ALIASES[a];
  return expanded ? normalizeStateText(expanded) === b : false;
}

/** Upper-case and drop the spacing people paste in from an invoice. */
export const normalizeGstin = (value: string): string =>
  String(value ?? '').replace(/[\s-]/g, '').toUpperCase();

/** Mod-36 check digit over the first 14 characters. */
export function gstinCheckDigit(first14: string): string | null {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = ALPHABET.indexOf(first14[i]);
    if (value === -1) return null;
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36];
}

export interface GstinCheck {
  valid: boolean;
  message?: string;
  state?: string;
  stateCode?: string;
}

/**
 * Check a GSTIN well enough to tell the buyer what is wrong with it.
 *
 * Messages mirror the server's so the two never contradict each other on the
 * same input — a field that says "looks fine" and then a server error saying
 * otherwise is worse than no client check at all.
 */
export function checkGstin(raw: string): GstinCheck {
  const gstin = normalizeGstin(raw);
  if (!gstin) return { valid: false };
  if (gstin.length !== 15) {
    return { valid: false, message: `A GSTIN is 15 characters; this one is ${gstin.length}.` };
  }
  if (!GSTIN_PATTERN.test(gstin)) {
    return { valid: false, message: 'That is not a valid GSTIN format, e.g. 27AAPFU0939F1ZV.' };
  }
  const stateCode = gstin.slice(0, 2);
  const state = GST_STATE_BY_CODE[stateCode];
  if (!state) {
    return { valid: false, message: `"${stateCode}" is not a GST state code.` };
  }
  if (gstinCheckDigit(gstin.slice(0, 14)) !== gstin[14]) {
    return { valid: false, message: 'That GSTIN failed its check-digit test — please re-check it for a typo.' };
  }
  return { valid: true, state, stateCode };
}

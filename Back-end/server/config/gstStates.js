/**
 * GST state codes — the first two digits of every GSTIN.
 *
 * Why this matters beyond validation: GST registration is PER STATE. A GSTIN is
 * not a company identifier, it is that company's registration in one particular
 * state, and the bill-to address for a purchase quoted against it belongs in
 * that state. So we DERIVE the buyer's billing state from the GSTIN rather than
 * asking for it and then checking the two agree — a field that cannot be typed
 * cannot disagree. See utils/gstin.js.
 *
 * Codes are the official list. Two carry history worth knowing:
 *   - 25 (Daman & Diu) and 26 (Dadra & Nagar Haveli) were merged into a single
 *     UT in 2020, now issued under 26. 25 is kept because registrations issued
 *     before the merger are still valid and still appear on real invoices.
 *   - 28 was undivided Andhra Pradesh. Post-bifurcation AP issues under 37 and
 *     Telangana under 36, but legacy 28 registrations exist.
 * Dropping either would reject a real, valid GSTIN — a silent "your details are
 * wrong" for a customer whose details are fine.
 */

export const GST_STATE_BY_CODE = Object.freeze({
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Dadra and Nagar Haveli and Daman and Diu', // legacy Daman & Diu, pre-2020 merger
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh',                            // legacy, pre-bifurcation
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
});

/**
 * Common short forms people type into a free-text state field.
 *
 * The delivery address on an order is free text ("MH", "Maharashtra", "maharastra"),
 * while a GSTIN yields a canonical name. Comparing the two literally would report
 * a difference on almost every order, so a small alias table does the obvious
 * cases. It is deliberately NOT exhaustive: `statesMatch` treats anything it
 * cannot confidently match as a difference, and the consequences of that are
 * always additive (an extra "delivered to" block, or being asked to type a
 * billing address) — never a blocked sale.
 */
const STATE_ALIASES = Object.freeze({
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
});

/** Letters only, lower-cased — so "Tamil Nadu", "tamilnadu" and "TAMIL-NADU" agree. */
const normalizeStateText = (value) =>
  String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * Does a free-text state plausibly name the same state as a canonical GST name?
 *
 * Returns FALSE when it cannot tell. Callers use this to decide whether to show
 * extra information or ask for an explicit billing address, never to reject —
 * a false negative on an odd spelling must not be able to block a purchase.
 *
 * @param {string} text       free-text state from a delivery address
 * @param {string} canonical  state name derived from a GSTIN
 */
export const statesMatch = (text, canonical) => {
  const a = normalizeStateText(text);
  const b = normalizeStateText(canonical);
  if (!a || !b) return false;
  if (a === b) return true;
  const expanded = STATE_ALIASES[a];
  return expanded ? normalizeStateText(expanded) === b : false;
};

/** Is this a state code the GST system actually issues under? */
export const isKnownStateCode = (code) =>
  Object.prototype.hasOwnProperty.call(GST_STATE_BY_CODE, String(code));

export default GST_STATE_BY_CODE;

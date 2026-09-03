/**
 * Buyer categories — individual (consumer) vs enterprise (commercial).
 *
 * The category is not a cosmetic label. It selects which half of /terms §17
 * governs the purchase: §17A leaves a consumer's statutory route to the Consumer
 * Disputes Redressal Commission expressly intact, while §17B commits the buyer
 * to arbitration under the Arbitration and Conciliation Act, 1996, seated in
 * Ernakulam, with exclusive jurisdiction there.
 *
 * ⚠️ WHY ENTERPRISE REQUIRES A VALID GSTIN
 * Without that gate the category is a free-text self-declaration, and a private
 * individual who ticks "Enterprise" because they want a GST number on their
 * receipt has just signed away the consumer forum. Requiring a checksum-valid
 * GSTIN means the enterprise track can only be entered by someone who actually
 * holds a GST registration — which is close to the legal test for whether they
 * are a consumer at all. The gate is enforced server-side in
 * services/buyerService.js; the UI merely reflects it.
 *
 * Mirrored for display in Front-end/web/src/lib/legal/buyerTypes.ts.
 */

export const BUYER_TYPES = Object.freeze({
  INDIVIDUAL: 'individual',
  ENTERPRISE: 'enterprise',
});

export const BUYER_TYPE_VALUES = Object.freeze(Object.values(BUYER_TYPES));

/** Which governing-law track a buyer category maps to (see /terms §17). */
export const ACCEPTANCE_TRACKS = Object.freeze({
  CONSUMER: 'consumer',
  ENTERPRISE: 'enterprise',
});

export const ACCEPTANCE_TRACK_VALUES = Object.freeze(Object.values(ACCEPTANCE_TRACKS));

/**
 * Map a buyer category to its governing-law track.
 *
 * Deliberately defaults to CONSUMER for anything that is not exactly
 * `enterprise`: an unrecognised, missing or malformed value must never land a
 * buyer in the arbitration track. Fail towards the weaker waiver.
 */
export const trackForBuyerType = (type) =>
  type === BUYER_TYPES.ENTERPRISE ? ACCEPTANCE_TRACKS.ENTERPRISE : ACCEPTANCE_TRACKS.CONSUMER;

export default BUYER_TYPES;

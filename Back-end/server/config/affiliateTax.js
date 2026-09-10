/**
 * Affiliate tax treatment — the DECLARED position, pending professional verification.
 *
 * ⚠️ THIS FILE RECORDS A POSITION. IT DOES NOT COMPUTE TAX.
 *
 * Nothing here is applied automatically to a payout. The per-affiliate `tdsPercent` on
 * the Affiliate document is what a payout actually deducts, and an admin sets it. These
 * constants exist so that:
 *
 *   1. the position we are operating on is written down in ONE place rather than
 *      scattered through UI copy and a T&C document that will drift from it;
 *   2. the affiliate T&C can state it accurately;
 *   3. there is something concrete to hand a chartered accountant.
 *
 * ── STATUS: AWAITING CA CONFIRMATION ─────────────────────────────────────────────
 * The operating assumption is TDS under section 194H (commission/brokerage) and GST at
 * 18% under SAC 9983. Both need confirming, and the answer is not uniform:
 *
 *   - whether 194H or 194-O governs depends on how the arrangement is characterised;
 *   - the 194H rate and its annual threshold have both changed in recent years;
 *   - GST liability sits with the AFFILIATE and only once they cross the registration
 *     threshold, which differs by state and by category of person;
 *   - place of supply for an intermediary service depends on the affiliate's state,
 *     which is why the application collects an address.
 *
 * Getting the section or the rate wrong is the DEDUCTOR's liability — ours — with
 * interest and penalty on the shortfall. So: do not treat these numbers as settled, and
 * do not build anything that derives a deduction from them without a CA sign-off.
 *
 * ── THE QUESTIONS BEING ASKED ────────────────────────────────────────────────────
 * docs/legal/affiliate-tax-brief-for-ca.md is the brief sent to the accountant: the facts
 * of the arrangement, the numbered questions, and a table for their answers. When it
 * comes back, update THREE things together or they will drift:
 *   1. the constants below,
 *   2. clause 6 of docs/legal/affiliateTerms-<version>.md and the matching text on
 *      Front-end/web/src/app/affiliates/terms/page.tsx (a substantive change needs a
 *      NEW version — see config/legalDocuments.js),
 *   3. AFFILIATE_TAX_POSITION_VERIFIED=true in the environment.
 */

/** Income-tax section we believe governs affiliate commission. */
export const TDS_SECTION = '194H';

/** Human label for the T&C and the admin. */
export const TDS_SECTION_LABEL = 'Section 194H — commission or brokerage';

/**
 * Annual commission per affiliate above which TDS is expected to apply.
 *
 * ⚠️ SURFACING ONLY. Nothing enforces this: no payout is blocked by it and no deduction
 * is derived from it. It exists so the admin can be shown "this affiliate has crossed
 * the threshold — confirm the rate with your accountant" rather than the operator
 * having to remember. Building an automatic deduction off an unverified threshold is
 * precisely the mistake this file exists to prevent.
 */
export const TDS_ANNUAL_THRESHOLD_RUPEES = 20000;

/** SAC (service accounting code) for the affiliate's supply of marketing services. */
export const GST_SAC_CODE = '9983';
export const GST_SAC_LABEL = 'SAC 9983 — other professional, technical and business services';

/** GST rate believed applicable to that supply. */
export const GST_PERCENT = 18;

/**
 * Turnover above which an affiliate is expected to need GST registration.
 *
 * Their obligation, not ours — but it changes what they must invoice us for, so the T&C
 * states it and the application collects the address that determines place of supply.
 * Varies by state and by category of person; another CA question.
 */
export const GST_REGISTRATION_THRESHOLD_RUPEES = 2000000;

/**
 * Whether the position above has been confirmed by a chartered accountant.
 *
 * Flipped to true only when someone qualified has signed off. Until then the admin
 * screens carry a visible "unverified" note, so nobody mistakes a placeholder for
 * a decision that was actually made.
 */
export const TAX_POSITION_VERIFIED =
  String(process.env.AFFILIATE_TAX_POSITION_VERIFIED).toLowerCase() === 'true';

export default {
  TDS_SECTION,
  TDS_SECTION_LABEL,
  TDS_ANNUAL_THRESHOLD_RUPEES,
  GST_SAC_CODE,
  GST_SAC_LABEL,
  GST_PERCENT,
  GST_REGISTRATION_THRESHOLD_RUPEES,
  TAX_POSITION_VERIFIED,
};

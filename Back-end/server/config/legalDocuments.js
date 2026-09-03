/**
 * Legal document versions — SINGLE SOURCE OF TRUTH.
 *
 * WHY A VERSION EXISTS AT ALL
 * `/terms` §17B puts Enterprise / Commercial disputes into arbitration seated in
 * Ernakulam, with the courts there holding exclusive jurisdiction. That is a
 * substantial waiver, and the thing that makes it stand up is being able to show
 * WHICH text a specific buyer agreed to, on a specific date. A terms page that
 * is edited in place cannot show that — `git blame` on a .tsx file is not
 * evidence, and the page a buyer saw eighteen months ago no longer exists.
 *
 * So: every order snapshots the version in force when it was placed (see
 * Order.legalAcceptance), and that version is written HERE, by the server, never
 * accepted from the client. A client that could name its own terms version could
 * choose which contract to be bound by.
 *
 * BUMPING A VERSION
 * Any change to the SUBSTANCE of a document (not typography, not a typo) needs:
 *   1. the `version` below moved to today's date,
 *   2. a committed snapshot of the rendered text at docs/legal/<key>-<version>.md,
 *   3. the mirrored constant in Front-end/web/src/lib/legal/legalVersions.ts,
 *   4. a Redis `route:*` / `public:*` flush + Cloudflare purge — a legal page
 *      served stale from an edge cache is the one document where "it'll expire
 *      in an hour" is not an acceptable answer.
 * Tests on BOTH sides enforce 2 and 3; nothing can enforce 1 and 4 but you.
 *
 * Versions are ISO dates: readable, sortable, and unambiguous about when the
 * text took effect.
 */

export const LEGAL_DOCUMENTS = Object.freeze({
  terms: Object.freeze({
    key: 'terms',
    path: '/terms',
    label: 'Terms and Conditions',
    // 2026-09-03: split the single governing-law clause into §17A (consumer:
    // courts + consumer authorities, CDRC route expressly preserved, no
    // compulsory arbitration) and §17B (enterprise: good-faith talks →
    // arbitration under the Arbitration and Conciliation Act, 1996, seated at
    // Ernakulam). Added §21 defining Enterprise / Commercial Buyer, and
    // corrected §6, which claimed tax was added at checkout when pricingService
    // embeds GST in the listed price.
    version: '2026-09-03',
  }),
  privacy: Object.freeze({
    key: 'privacy',
    path: '/privacy',
    label: 'Privacy Policy',
    version: '2025-12-09',
  }),
});

/** Version strings the server stamps onto an order at creation. */
export const CURRENT_TERMS_VERSION = LEGAL_DOCUMENTS.terms.version;
export const CURRENT_PRIVACY_VERSION = LEGAL_DOCUMENTS.privacy.version;

/** How an acceptance came to be recorded. */
export const ACCEPTANCE_CHANNELS = Object.freeze({
  /** The buyer ticked the box themselves at checkout. Evidence of their consent. */
  CHECKOUT: 'checkout',
  /** An admin recorded an off-platform sale. NOT evidence the buyer clicked anything. */
  OFFLINE_ADMIN: 'offline_admin',
});

/**
 * The acceptance snapshot to persist with an order.
 *
 * Deliberately a function of server state only — it takes no client input, so
 * there is no argument a buyer's browser can pass that changes which contract
 * they are recorded as having accepted.
 *
 * ⚠️ `channel` IS LOAD-BEARING, NOT A LABEL. An offline order carries an
 * acceptance so the versions in force are on the record, but nobody ticked a box:
 * the customer was never at a browser. Recording that identically to a real
 * checkout acceptance would manufacture evidence of consent that does not exist —
 * which matters most for exactly the orders most likely to be enterprise, where
 * the clause being "accepted" is the arbitration one.
 *
 * `ipHash` is therefore only meaningful on a CHECKOUT acceptance. On an offline
 * one it would be the ADMIN's address, so it is refused rather than stored.
 *
 * @param {{ track: 'consumer'|'enterprise', channel?: string, acceptedAt?: Date, ipHash?: string, recordedBy?: string }} ctx
 */
export const buildAcceptanceSnapshot = ({
  track,
  channel = ACCEPTANCE_CHANNELS.CHECKOUT,
  acceptedAt = new Date(),
  ipHash = null,
  recordedBy = null,
}) => {
  const isCheckout = channel === ACCEPTANCE_CHANNELS.CHECKOUT;
  return {
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    track,
    channel,
    acceptedAt,
    // Only the buyer's own IP is evidence. An admin's is not, so it never lands here.
    ...(isCheckout && ipHash && { ipHash }),
    // Who keyed it in, for the offline case. Absent on a real checkout acceptance.
    ...(!isCheckout && recordedBy && { recordedBy }),
  };
};

export default LEGAL_DOCUMENTS;

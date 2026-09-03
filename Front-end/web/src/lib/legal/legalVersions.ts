/**
 * Mirror of Back-end/server/config/legalDocuments.js — the backend owns these
 * versions; this file exists so the storefront can render "Last updated" and
 * (from Phase 3) tell a buyer at checkout exactly which version they are
 * accepting, without a round-trip for two short strings.
 *
 * ⚠️ THE TWO FILES MUST NOT DRIFT. A checkout that displays "version 2026-09-03"
 * while the server records something else is worse than displaying nothing: it
 * is a written misstatement about the contract being formed, on the one screen
 * where the buyer is agreeing to arbitration.
 *
 * Guarded on BOTH sides on purpose, because the CI triggers are asymmetric:
 * `ci-frontend.yml` runs only on `Front-end/web/**` and `ci.yml` only on
 * `Back-end/server/**`. A backend-only commit bumping the version there would
 * never run the frontend suite, so a guard living only here would not fire.
 * See legalVersions.test.ts and Back-end/server/tests/unit/config/legalDocuments.test.js.
 */

export const LEGAL_DOCUMENTS = {
  terms: {
    key: 'terms',
    path: '/terms',
    label: 'Terms and Conditions',
    version: '2026-09-03',
  },
  privacy: {
    key: 'privacy',
    path: '/privacy',
    label: 'Privacy Policy',
    version: '2025-12-09',
  },
} as const;

export const CURRENT_TERMS_VERSION = LEGAL_DOCUMENTS.terms.version;
export const CURRENT_PRIVACY_VERSION = LEGAL_DOCUMENTS.privacy.version;

/**
 * Object-storage configuration (Cloudflare R2).
 *
 * Mirrors the `SEARCH_ENGINE` convention: `STORAGE_PROVIDER` selects the active
 * backend and is read PER CALL, so switching between Cloudinary and R2 during
 * the migration is an env change plus a restart — not a redeploy, and not a
 * code edit. That property is what makes the cutover reversible: if R2 delivery
 * misbehaves in prod, flipping the variable back restores Cloudinary instantly
 * while the bytes stay in both places.
 *
 * ── Two buckets, deliberately ───────────────────────────────────────────────
 * PUBLIC  — catalog imagery (products, brands, categories, vehicles, banners).
 *           Fronted by a Cloudflare custom domain, cached at the edge, world
 *           readable. Nothing here is confidential.
 * PRIVATE — careers applications (CVs + answer videos), return evidence,
 *           support attachments, invoice and shipping-slip PDFs. NEVER gets a
 *           custom domain; every read is a short-lived presigned URL.
 *
 * Keeping them apart is a structural guarantee rather than a convention: there
 * is no public base URL configured for the private bucket, so no code path —
 * including a future one written by someone who has not read this file — can
 * accidentally mint a permanent public link to an applicant's CV. Collapsing
 * them into one bucket with a prefix convention would make that a one-typo
 * mistake, and the blast radius is applicant PII.
 */

/** Env vars required before the R2 provider can do anything. */
const REQUIRED_R2_VARS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_PUBLIC_BUCKET',
  'R2_PRIVATE_BUCKET',
];

/**
 * Active provider, read per call. 'cloudinary' until the cutover flips it.
 * @returns {'cloudinary'|'r2'}
 */
export const storageProvider = () =>
  (process.env.STORAGE_PROVIDER || 'cloudinary').trim().toLowerCase() === 'r2'
    ? 'r2'
    : 'cloudinary';

/** True when every R2 variable is present. */
export const isR2Configured = () => REQUIRED_R2_VARS.every((v) => !!process.env[v]);

/** Names of the R2 variables that are missing, for error messages. */
export const missingR2Vars = () => REQUIRED_R2_VARS.filter((v) => !process.env[v]);

/**
 * Resolved R2 settings. Read lazily (a getter, not a frozen object at import
 * time) because scripts load dotenv AFTER the module graph is built, and a
 * snapshot taken at import would capture an empty env and silently point the
 * migration at the wrong account.
 */
export const r2Config = () => ({
  accountId:       process.env.R2_ACCOUNT_ID || '',
  accessKeyId:     process.env.R2_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  publicBucket:    process.env.R2_PUBLIC_BUCKET || '',
  privateBucket:   process.env.R2_PRIVATE_BUCKET || '',
  // S3 API endpoint. Distinct from the DELIVERY domain below — this one is
  // credentialed and must never be exposed to a browser.
  endpoint:        `https://${process.env.R2_ACCOUNT_ID || ''}.r2.cloudflarestorage.com`,
  // Public delivery origin for the PUBLIC bucket only (Cloudflare custom domain).
  publicBaseUrl:  (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  // How long a presigned GET for a private asset stays valid. Kept short: these
  // URLs are handed to an admin UI and are bearer credentials for PII.
  signedGetTtlSeconds: Number(process.env.R2_SIGNED_GET_TTL_SECONDS || 300),
  // Presigned PUT window for a direct browser upload. Long enough for a slow
  // mobile connection to finish a video, short enough to bound abuse.
  signedPutTtlSeconds: Number(process.env.R2_SIGNED_PUT_TTL_SECONDS || 900),
});

/**
 * Throw if R2 is selected but unusable. Called by the provider on first use
 * rather than at import, so a Cloudinary-only deployment never trips on R2
 * variables it has no reason to set.
 */
export const assertR2Configured = () => {
  if (isR2Configured()) return;
  throw new Error(
    `[Storage] STORAGE_PROVIDER=r2 but missing env: ${missingR2Vars().join(', ')}`
  );
};

export default { storageProvider, isR2Configured, missingR2Vars, r2Config, assertR2Configured };

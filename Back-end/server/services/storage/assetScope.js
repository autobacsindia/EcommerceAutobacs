/**
 * Which R2 bucket does a Cloudinary asset belong in?
 *
 * This is the single most safety-critical mapping in the migration. Getting it
 * wrong in one direction is cosmetic (a product photo behind a signed URL just
 * fails to render); getting it wrong in the other direction publishes job
 * applicants' CVs and answer videos, customers' return-evidence footage, and
 * support attachments to a world-readable CDN domain — permanently, and
 * retroactively, for every asset the run touched.
 *
 * So the mapping is:
 *   1. EXPLICIT — an allowlist of prefixes, not a heuristic.
 *   2. PRIVATE-FIRST — private prefixes are tested before public ones, so a
 *      nested path can never be captured by a broader public rule.
 *   3. FAIL-CLOSED — anything unrecognised resolves to `null` (skip + report),
 *      never to a default. A new folder someone adds next year does not get
 *      silently published because the migration assumed public.
 *
 * Rule 3 is the one that matters. The tempting default is "public unless it
 * looks private", which is exactly backwards: the cost of skipping an asset is
 * a re-run, and the cost of publishing one is a disclosure you cannot undo.
 */

/**
 * Prefixes whose contents are confidential. Checked FIRST.
 * Sources: careersCloudinary.CAREERS_FOLDER_BASE, returnsCloudinary.RETURNS_FOLDER_BASE,
 * supportAttachments.SUPPORT_FOLDER_BASE, orderController (shipping slips),
 * invoiceService (INVOICE_CLOUDINARY_FOLDER).
 */
export const PRIVATE_PREFIXES = [
  'autobacs/careers',
  'autobacs/returns',
  'autobacs/support',
  'shipping-slips',
  'invoices',
];

/** Prefixes that are public storefront/marketing imagery. */
export const PUBLIC_PREFIXES = [
  'autobacs/products',
  'autobacs/brands',
  'autobacs/categories',
  'autobacs/vehicle and makes',
  'autobacs/vehicles',
  'autobacs/promo-banners',
  'autobacs/banners',
  'autobacs/spin-prizes',
  'autobacs/media',
  'autobacs/site',
  'autobacs/articles',
  'autobacs/homepage asset',
  'press-coverage',
];

/**
 * Public assets that live at the Cloudinary ROOT (no folder) — legacy uploads
 * that predate the folder convention: the car-explorer artwork referenced by the
 * `vehicles` collection, the home before/after showcase, and the Roavion logo.
 *
 * EXACT ids, not prefixes. An earlier version of this list used brand prefixes
 * (`ford_`, `maruti_`, `roavion-`) and silently missed real production assets
 * three separate ways: a typo in the source data (`marutii_jimmy`), an
 * inconsistent separator (`ford_-ranger`), and a capitalisation difference
 * (`Roavion-Logo` vs `roavion-`). Prefixes are a guess about a naming
 * convention that was never enforced; this set was DERIVED on 2026-09-01 by
 * scanning all 27,337 documents across all 53 production collections plus the
 * application source, so it reflects what is actually referenced rather than
 * what the names suggest.
 *
 * The set is closed: `routes/uploads.js` forces every new upload into an
 * allowlisted folder, so no new root-level asset can appear.
 */
export const PUBLIC_ROOT_IDS = new Set([
  'after_bmw_svmikn',
  'audi-q7_yaecyb',
  'before_bmw_hlwaqs',
  'bmw_x5_axixjn',
  'ford_-endeavour_syx3ek',
  'ford_-ranger_sofijq',
  'hyundai_creta_zlgso8',
  'isuzu_dmax_iipade',
  'jeep_wrangler_smdurl',
  'kia_carens_ts45ng',
  'kia_seltos_ewzub9',
  'kia_sonet_ww17n9',
  'land_rover_defender_kotvlf',
  'mahindra_bolero_sgl63g',
  'mahindra_scorpio_gqqybu',
  'mahindra_thar_edxwvh',
  'mahindra_xuv300_gxqhcm',
  'mahindra_xuv700_muuegw',
  'maruti_baleno_ibzki6',
  'maruti_brezza_wdh7u7',
  'maruti_ertiga_vwf3ht',
  'maruti_swift_r7csac',
  'marutii_jimmy_lnlj5k',
  'mercedes_benz_g-class_i2hoct',
  'porche_cayenne_xw8mfh',
  'roavion-primary_pwywsn',
  'toyota_fortuner_a7thz2',
  'toyota_hilux_wpz70i',
  'toyota_innova_crysta_kcrkbb',
  'toyota_innova_hycross_fsujya',
  'volks_polo_am8sbz',
]);

/**
 * Deliberately NOT migrated.
 *
 * `samples/` plus the loose `cld-sample*` / `main-sample` / `sample` assets are
 * Cloudinary's own demo content, seeded into every new cloud (~20 MB of
 * landscapes, kittens and breakfast). Copying it would import junk into a clean
 * bucket and pay to store it forever.
 *
 * The rest were confirmed ORPHANED in the same 2026-09-01 audit described
 * above — present in Cloudinary, referenced by no document and no source file.
 * They are listed explicitly rather than left unmapped so the migration report
 * stays signal: an unmapped asset means "a human must decide", and 19 known-dead
 * assets repeating on every run would train the operator to ignore that.
 *
 * `autobacs/brand-logos/*` is the notable one — a real-looking folder of six
 * brand logos that does not appear in Cloudinary's own folder listing (the
 * assets carry a slashed public_id rather than a folder) and that nothing
 * references. Live brand logos are in `autobacs/brands`.
 *
 * NOTE on method: the audit matched on FULL public_ids, not substrings. A
 * substring pass reported `sample` as referenced because an article body
 * contains the word "sampled".
 */
export const EXCLUDED_PREFIXES = [
  'samples',
  // Six brand logos that nothing references. Excluded as a PREFIX, not as exact
  // ids: these assets carry the file extension inside the public_id
  // (`…/ironman.png`), so an exact-id list transcribed from a folder listing
  // misses every one of them. A dead folder is a folder-shaped fact — match it
  // that way.
  'autobacs/brand-logos',
];

/** Exact ids confirmed dead by the 2026-09-01 reference audit. */
export const KNOWN_ORPHANS = new Set([
  'Roavion-Logo_xwqbx9',
  'cld-sample',
  'cld-sample-2',
  'cld-sample-3',
  'cld-sample-4',
  'cld-sample-5',
  'copy_of_cover',
  'kling_20260701_IMAGE_I_am_givin_289_0_jtcggb',
  'kling_20260701_IMAGE_I_am_givin_290_0_lmodnq',
  'kling_20260701_IMAGE_I_want_you_4515_1_f8bxim',
  'main-sample',
  'roavion-mark_nxvywm',
  'sample',
]);

const startsWithSegment = (publicId, prefix) =>
  publicId === prefix || publicId.startsWith(`${prefix}/`);

/**
 * Resolve the destination bucket scope for a Cloudinary public_id.
 *
 * @param {string} publicId
 * @returns {'public'|'private'|null} null = unrecognised or excluded; skip and report.
 */
export const scopeFor = (publicId) => {
  if (typeof publicId !== 'string' || !publicId.trim()) return null;
  const id = publicId.trim().replace(/^\/+/, '');

  if (EXCLUDED_PREFIXES.some((p) => startsWithSegment(id, p))) return null;
  if (KNOWN_ORPHANS.has(id)) return null;

  // Private first — a public prefix must never be able to shadow a private one.
  if (PRIVATE_PREFIXES.some((p) => startsWithSegment(id, p))) return 'private';
  if (PUBLIC_PREFIXES.some((p) => startsWithSegment(id, p))) return 'public';

  // Root-level legacy assets, matched exactly. The `!includes('/')` guard is
  // belt-and-braces: every id in the set is already root-level.
  if (!id.includes('/') && PUBLIC_ROOT_IDS.has(id)) return 'public';

  return null;
};

/**
 * Why was this asset skipped?
 *
 * `scopeFor` collapses "deliberately excluded" and "nobody has classified this"
 * into the same null, but the two mean opposite things to an operator: the first
 * is a decision already recorded in this file, the second is a decision still
 * owed. Reporting both as "unmapped" buries the handful of assets that need a
 * human behind 78 lines of Cloudinary demo content, which is how a real
 * unclassified asset gets skipped for good.
 *
 * @param {string} publicId
 * @returns {'excluded'|'orphaned'|'unmapped'|null} null when it IS mapped.
 */
export const skipReason = (publicId) => {
  if (scopeFor(publicId)) return null;
  if (typeof publicId !== 'string' || !publicId.trim()) return 'unmapped';
  const id = publicId.trim().replace(/^\/+/, '');
  if (EXCLUDED_PREFIXES.some((p) => startsWithSegment(id, p))) return 'excluded';
  if (KNOWN_ORPHANS.has(id)) return 'orphaned';
  return 'unmapped';
};

export default { scopeFor, skipReason, PRIVATE_PREFIXES, PUBLIC_PREFIXES, PUBLIC_ROOT_IDS, EXCLUDED_PREFIXES, KNOWN_ORPHANS };

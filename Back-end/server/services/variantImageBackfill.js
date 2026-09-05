/**
 * Recover the per-model photos WooCommerce had and this catalogue lost.
 *
 * ── What was lost ───────────────────────────────────────────────────────────
 * A WooCommerce variation carries its own image. Our importer
 * (utils/wcVariants.js) never read that field, so every migrated model shows its
 * parent product's photo. Measured against the live Woo store: 505 variations,
 * 474 with their own image, 389 of which appear NOWHERE in the parent gallery —
 * 142 of 149 variable products affected. Those 389 photographs exist only on the
 * old WordPress host; they are not in our database in any form.
 *
 * ── Why the planning is separated from the doing ────────────────────────────
 * Deciding what to copy is the risky part; the I/O around it is mechanical.
 * `planProductBackfill` is pure, so every skip/dedup/match rule is unit-tested
 * without a network, a bucket or a database, and the dry run reports EXACTLY the
 * decisions an --apply would act on rather than an approximation of them.
 *
 * ── Idempotency is structural, not a flag ───────────────────────────────────
 * The object key is DERIVED from the source URL: the same Woo image always maps
 * to the same key under the same product. So a re-run — including one after a
 * crash between upload and database write — recognises its own work and reuses
 * it instead of minting a second copy. Nothing depends on the previous run
 * having finished, or on a journal being intact.
 *
 * ── Deduplication ───────────────────────────────────────────────────────────
 * Woo reuses one photo across several variations. Grouping by source URL means
 * one upload and one gallery entry with several models pointing at it. Each
 * duplicate avoided is an original plus ~14 pre-generated derivatives.
 *
 * The images are written into the parent gallery with `variantOwned: true`, so
 * the ownership rule in utils/variantImage.js governs them from then on: they
 * die with the last model that points at them, and never take an ordinary
 * product photo with them.
 */
import crypto from 'crypto';
import { imageKey } from '../utils/productGallery.js';

/**
 * Source extensions we will re-host, mapped to the content type to store.
 *
 * Kept to formats the delivery Worker serves: it clamps every response to an
 * image allowlist, so storing a type outside it would put an object in the
 * bucket that can never be served — a silent, undebuggable broken image.
 *
 * AVIF earns its place from real data, not completeness: six live Woo variation
 * images are `.avif`, and without it those six were being dropped as
 * "unsupported" on a pipeline that already generates AVIF derivatives. GIF is
 * deliberately absent — none exist in the source set, and an allowlist should
 * describe what is actually there.
 */
export const SOURCE_TYPES = {
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

/** Long immutable TTL — these objects are content-addressed by their key. */
export const PUBLIC_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Why a variant produced no work. Surfaced verbatim in the dry-run report. */
export const SKIP = {
  ALREADY:     'already-has-image',
  UNMATCHED:   'no-matching-woo-variation',
  NO_SOURCE:   'woo-variation-has-no-image',
  UNSUPPORTED: 'unsupported-image-format',
};

/**
 * Normalised label, for the fallback matcher below. Case, spacing and
 * punctuation drift freely between Woo and our copy; the words do not.
 */
export const normaliseLabel = (label) =>
  String(label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Match models to Woo variations by LABEL, for rows that lost `wpVariationId`.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The admin product form submits the whole variants array rather than a patch,
 * and it never carried `wpVariationId` — so every admin save of a variable
 * product silently severed the Woo linkage. 16 models across 7 products had
 * already lost it, including ones whose photo IS the product difference
 * ("Blue"/"Yellow" steering wheel, "Amber"/"Black" filter covers). The editor
 * now preserves the field, but that cannot restore what is already gone.
 *
 * ── Why it is opt-in and conservative ───────────────────────────────────────
 * A label is a display string an admin may have rewritten; an id is a fact.
 * Matching on it can therefore be WRONG, and a wrong match here means showing a
 * shopper the blue steering wheel when they picked yellow — worse than the
 * status quo of showing the parent photo. So it requires --match-by-label, and
 * a pairing is accepted only when the normalised label is unique on BOTH sides.
 * An ambiguous label is left unmatched rather than guessed at.
 *
 * @returns {Map<string, object>} variantId → Woo variation
 */
export const matchByLabel = (variants, wcVariations) => {
  const countBy = (list, get) => {
    const counts = new Map();
    for (const item of list) {
      const key = normaliseLabel(get(item));
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  };

  const wcLabel = (v) => (v.attributes || []).map((a) => a.option).filter(Boolean).join(' / ');
  const ourCounts = countBy(variants, (v) => v.label);
  const wcCounts = countBy(wcVariations, wcLabel);

  const wcByLabel = new Map();
  for (const v of wcVariations) wcByLabel.set(normaliseLabel(wcLabel(v)), v);

  const out = new Map();
  for (const variant of variants) {
    const key = normaliseLabel(variant.label);
    // Unique on both sides, or not at all.
    if (!key || ourCounts.get(key) !== 1 || wcCounts.get(key) !== 1) continue;
    const wc = wcByLabel.get(key);
    if (wc) out.set(String(variant._id), wc);
  }
  return out;
};

/**
 * The stable basename for a source URL. Same input → same output, forever.
 *
 * Truncated to 16 hex chars: 64 bits of collision resistance across the ~500
 * images in scope, while keeping keys readable in a bucket listing. The `v-`
 * prefix makes a model photo identifiable at a glance next to the random
 * basenames the admin uploader mints.
 */
export const basenameFor = (sourceUrl) =>
  `v-${crypto.createHash('sha1').update(String(sourceUrl)).digest('hex').slice(0, 16)}`;

/** Lowercased extension from a URL path, ignoring query strings. */
export const extensionOf = (sourceUrl) => {
  try {
    const path = new URL(String(sourceUrl)).pathname;
    const dot = path.lastIndexOf('.');
    const slash = path.lastIndexOf('/');
    if (dot <= slash + 1) return '';
    return path.slice(dot + 1).toLowerCase();
  } catch {
    return '';
  }
};

/**
 * The object key this source URL will occupy under this product.
 * Mirrors the admin uploader's shape (`autobacs/products/<productId>/<name>.<ext>`)
 * so backfilled assets are indistinguishable from hand-uploaded ones downstream.
 */
export const keyFor = (productId, sourceUrl) => {
  const ext = extensionOf(sourceUrl);
  if (!SOURCE_TYPES[ext]) return '';
  return `autobacs/products/${productId}/${basenameFor(sourceUrl)}.${ext}`;
};

/** Find a gallery entry already holding this source, ignoring extension drift. */
const findExisting = (images, base) =>
  (Array.isArray(images) ? images : []).find((img) => {
    const key = imageKey(img);
    if (!key) return false;
    const name = key.slice(key.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    return (dot > 0 ? name.slice(0, dot) : name) === base;
  });

/**
 * Decide what this product needs, without doing any of it.
 *
 * @param {object} product      lean Product doc (_id, name, slug, images, variants)
 * @param {Array}  wcVariations raw objects from GET /products/{id}/variations
 * @returns {{productId, name, slug, uploads: Array, skipped: Array}}
 *   `uploads[]` is one entry per DISTINCT source image:
 *     { sourceUrl, key, publicId, contentType, variantIds[], reuseExisting }
 *   `reuseExisting` is set when the asset is already in the gallery — the bytes
 *   are not fetched again, only the pointers are written.
 */
export const planProductBackfill = (product, wcVariations = [], { allowLabelMatch = false } = {}) => {
  const productId = String(product?._id || '');
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const byWpId = new Map(
    (Array.isArray(wcVariations) ? wcVariations : [])
      .filter((v) => v && v.id != null)
      .map((v) => [String(v.id), v])
  );

  const uploads = new Map();   // sourceUrl → upload entry
  const skipped = [];

  /*
    Second-chance matching for models whose `wpVariationId` was destroyed by an
    admin save. Restricted to those: a model WITH an id is matched by it and is
    never reconsidered here, so a correct id can never lose to a similar label.
  */
  const needsLabelMatch = allowLabelMatch
    ? variants.filter((v) => v?.wpVariationId == null && !(typeof v?.imageKey === 'string' && v.imageKey.trim()))
    : [];
  const labelMatches = needsLabelMatch.length
    ? matchByLabel(needsLabelMatch, Array.isArray(wcVariations) ? wcVariations : [])
    : new Map();
  /*
    Records the full pairing, not just "this one was label-matched". A human
    reviewing a fuzzy match needs both sides side by side — our label, Woo's
    label, the variation id and the image that would be attached — or the review
    is not a review, it is a nod.
  */
  const matchedByLabel = [];

  for (const variant of variants) {
    const variantId = String(variant?._id || '');
    const label = variant?.label || '(unlabelled)';
    const note = (reason) => skipped.push({ variantId, label, reason });

    // Already done. This is what makes a re-run a no-op, and it is checked FIRST
    // so a variant an admin has since given a different photo is never clobbered
    // by the Woo original.
    if (typeof variant?.imageKey === 'string' && variant.imageKey.trim()) {
      note(SKIP.ALREADY);
      continue;
    }

    let wc = variant?.wpVariationId != null ? byWpId.get(String(variant.wpVariationId)) : null;
    if (!wc && labelMatches.has(variantId)) {
      wc = labelMatches.get(variantId);
      matchedByLabel.push({
        variantId,
        ourLabel: label,
        wcVariationId: wc.id,
        wcLabel: (wc.attributes || []).map((a) => a.option).filter(Boolean).join(' / '),
        sourceUrl: wc.image?.src || null,
      });
    }
    if (!wc) { note(SKIP.UNMATCHED); continue; }

    const sourceUrl = wc.image?.src;
    if (!sourceUrl) { note(SKIP.NO_SOURCE); continue; }

    const ext = extensionOf(sourceUrl);
    if (!SOURCE_TYPES[ext]) { note(SKIP.UNSUPPORTED); continue; }

    const existing = uploads.get(sourceUrl);
    if (existing) { existing.variantIds.push(variantId); continue; }

    const base = basenameFor(sourceUrl);
    const already = findExisting(product?.images, base);
    uploads.set(sourceUrl, {
      sourceUrl,
      key: already ? imageKey(already) : keyFor(productId, sourceUrl),
      publicId: already ? imageKey(already) : keyFor(productId, sourceUrl),
      contentType: SOURCE_TYPES[ext],
      variantIds: [variantId],
      reuseExisting: Boolean(already),
    });
  }

  return {
    productId,
    name: product?.name || '',
    slug: product?.slug || '',
    uploads: [...uploads.values()],
    skipped,
    // Surfaced so the dry run can list every label-matched pairing for review —
    // these are the ones a human should actually check before --apply.
    labelMatched: matchedByLabel,
  };
};

/**
 * Fold a plan (plus the refs actually uploaded) into the document changes.
 *
 * Pure, so the exact `$set` an --apply would issue is assertable in a test and
 * printable in a dry run. Returns `null` when there is nothing to write, so the
 * caller never issues an empty update.
 *
 * @param {object} product  the lean doc the plan was built from
 * @param {object} plan     from planProductBackfill
 * @param {Map<string,{url:string, public_id:string}>} uploaded  sourceUrl → stored ref
 * @returns {{images: Array, variants: Array}|null}
 */
export const composeProductUpdate = (product, plan, uploaded) => {
  const images = [...(product?.images || [])].map((img) =>
    (typeof img?.toObject === 'function' ? img.toObject() : { ...img })
  );
  const variants = [...(product?.variants || [])].map((v) =>
    (typeof v?.toObject === 'function' ? v.toObject() : { ...v })
  );

  const pointerFor = new Map();   // variantId → imageKey
  let appended = 0;

  for (const upload of plan.uploads) {
    const ref = uploaded.get(upload.sourceUrl);
    if (!ref) continue;                       // download/upload failed — left untouched

    if (!upload.reuseExisting) {
      images.push({
        url: ref.url,
        public_id: ref.public_id,
        alt: plan.name,
        // Appended, never promoted: the existing primary is the PDP hero image
        // and every listing thumbnail, and a migration must not restyle 142
        // product pages as a side effect of recovering a photo.
        isPrimary: false,
        variantOwned: true,
      });
      appended++;
    }
    for (const variantId of upload.variantIds) pointerFor.set(variantId, ref.public_id);
  }

  if (pointerFor.size === 0) return null;

  const nextVariants = variants.map((v) => {
    const key = pointerFor.get(String(v._id));
    return key ? { ...v, imageKey: key } : v;
  });

  return { images, variants: nextVariants, appended, pointed: pointerFor.size };
};

/**
 * Aggregate plans into the numbers a human decides on.
 */
export const summarise = (plans) => {
  const totals = {
    products: plans.length,
    productsWithWork: 0,
    uploads: 0,
    reused: 0,
    pointers: 0,
    skipped: {},
  };
  for (const plan of plans) {
    if (plan.uploads.length) totals.productsWithWork++;
    for (const u of plan.uploads) {
      if (u.reuseExisting) totals.reused++; else totals.uploads++;
      totals.pointers += u.variantIds.length;
    }
    for (const s of plan.skipped) {
      totals.skipped[s.reason] = (totals.skipped[s.reason] || 0) + 1;
    }
  }
  return totals;
};

export default { planProductBackfill, composeProductUpdate, summarise, keyFor, basenameFor };

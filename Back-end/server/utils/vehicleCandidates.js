/**
 * Pure candidate extraction for scripts/audit-vehicle-candidates.js.
 *
 * Lives here rather than inside the script because the script WRITES PUBLIC PAGES:
 * `--apply` creates Vehicle rows, each of which becomes /vehicles/{make}/{model}
 * and a sitemap entry. Logic with that blast radius should not be reachable only
 * by running it against production, which is what a code review found — the
 * extraction rules had no tests at all, and four separate defects were hiding in
 * them (chassis-shape applied to the wrong position, label sightings counted as
 * products, a make guessed from text naming two makes, and an alias-blind dedupe).
 *
 * Everything below is a pure function over plain objects.
 */

import {
  isVehicleAxis,
  splitCompoundLabel,
  cleanModelLabel,
  detectMake,
  detectMakes,
  phraseVariants,
  titleCaseModel,
} from './vehicleMatch.js';

/**
 * Why a label segment produced no usable candidate. Reported rather than silently
 * dropped, so an operator can see what the audit could not interpret.
 */
export const SKIP_REASONS = {
  NO_MAKE: 'no-make-resolvable',
  AMBIGUOUS_MAKE: 'text-names-multiple-makes',
  DENYLISTED: 'denylisted',
  UNPARSEABLE: 'no-model-after-cleaning',
};

/**
 * Attribute a model to a make.
 *
 * Order matters. A label that carries its own make ("Ford Fiesta") is the most
 * direct evidence available and wins outright. Only when the label is bare
 * ("CIAZ", "X5 M 4.4L") does the product NAME supply the make.
 *
 * ⚠ The name is used ONLY when it names exactly one marque. `detectMake` returns
 * the longest match, which silently invents an attribution for text like
 * "Land Rover Defender Style Taillight for Mahindra Thar" — a Mahindra part
 * borrowing a Land Rover look, confidently reported as `land rover`. Under
 * `--apply` that mints a Vehicle row for a car that does not exist. Refusing to
 * guess turns a wrong row into a visible skip.
 *
 * @returns {{make: string|null, reason: string|null}}
 */
export function attributeMake(modelText, productName) {
  const labelMake = detectMake(modelText);
  if (labelMake) return { make: labelMake, reason: null };

  const nameMakes = detectMakes(productName);
  if (nameMakes.length === 1) return { make: nameMakes[0], reason: null };
  if (nameMakes.length > 1) return { make: null, reason: SKIP_REASONS.AMBIGUOUS_MAKE };
  return { make: null, reason: SKIP_REASONS.NO_MAKE };
}

/** Strip a leading make from a model so "Ford Ford Fiesta" cannot be produced. */
export function stripLeadingMake(model, make) {
  if (!make) return model;
  let out = model;
  for (const spelling of phraseVariants(make)) {
    out = out.replace(new RegExp(`^${spelling}\\s+`, 'i'), '').trim();
  }
  return out;
}

/**
 * Every vehicle reference in one product's vehicle-axis variant labels.
 *
 * @param {object} product           lean Product with name + variants
 * @param {object} opts
 * @param {object} opts.corrections  cleaned-model (lowercased) → preferred spelling
 * @param {Set}    opts.denylist     cleaned models (lowercased) that are not cars
 * @returns {{candidates: object[], skipped: object[]}}
 */
export function extractCandidates(product, { corrections = {}, denylist = new Set() } = {}) {
  const candidates = [];
  const skipped = [];

  for (const variant of product.variants || []) {
    if (!isVehicleAxis(variant.attributes)) continue;
    const { models, chassis } = splitCompoundLabel(variant.label);

    // ── Model position ──────────────────────────────────────────────────────
    //
    // ⚠ Shape is NOT consulted here, and that is the whole point. `looksLikeChassisCode`
    // is a letter-then-2-3-digits test, which matches Hyundai's "i10"/"i20", Volvo's
    // "S60"/"XC60" and any similarly-shaped consumer name. Applying it in this
    // position silently classified those as chassis codes and skipped them — the
    // exact inversion of the documented rule that POSITION is the signal and shape
    // only confirms it. Anything in the model position is a consumer model.
    for (const segment of models) {
      const cleaned = cleanModelLabel(segment);
      if (!cleaned) {
        skipped.push({ segment, evidence: variant.label, reason: SKIP_REASONS.UNPARSEABLE });
        continue;
      }
      if (denylist.has(cleaned.toLowerCase())) {
        skipped.push({ segment: cleaned, evidence: variant.label, reason: SKIP_REASONS.DENYLISTED });
        continue;
      }

      const { make, reason } = attributeMake(cleaned, product.name);
      if (!make) {
        skipped.push({ segment: cleaned, evidence: variant.label, reason, product: product.name });
        continue;
      }

      const bare = stripLeadingMake(cleaned, make);
      if (!bare) continue;

      const lookup = bare.toLowerCase();
      candidates.push({
        make,
        model: corrections[lookup] || titleCaseModel(bare),
        kind: 'consumer-model',
        evidence: variant.label,
      });
    }

    // ── Chassis position ────────────────────────────────────────────────────
    //
    // Segments after the en-dash ("… – G05/F95"), where manufacturers put platform
    // codes. Recorded so an operator can see them; never promoted to a model.
    for (const segment of chassis) {
      const cleaned = cleanModelLabel(segment);
      if (!cleaned) continue;
      const { make } = attributeMake(cleaned, product.name);
      if (!make) continue;
      candidates.push({
        make,
        model: corrections[cleaned.toLowerCase()] || cleaned,
        kind: 'chassis-code',
        evidence: variant.label,
      });
    }
  }

  return { candidates, skipped };
}

/**
 * Fold per-product candidates into one row per make+model.
 *
 * ⚠ `productCount` is the number of DISTINCT PRODUCTS, not the number of label
 * sightings. One product whose labels read "CIVIC 06>10" and "CIVIC 13>16" is one
 * product that sells a Civic part, and counting it twice let a single product
 * satisfy `--min-products=2` on its own — defeating the threshold that is the main
 * guard against creating junk public pages. It also duplicated that product's name
 * in the evidence samples an operator reviews.
 *
 * The key ignores punctuation so "BRV"/"BR-V" and "MU 7"/"MU-7" fold together; the
 * first spelling seen supplies the display form.
 */
export function aggregateCandidates(perProduct) {
  const byKey = new Map();

  for (const { productId, productName, candidates } of perProduct) {
    for (const c of candidates) {
      const key = `${c.make}|${c.model.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          canonicalMake: c.make,
          model: c.model,
          kind: c.kind,
          productIds: new Set(),
          products: [],
          evidence: new Set(),
        });
      }
      const row = byKey.get(key);
      const id = String(productId);
      if (!row.productIds.has(id)) {
        row.productIds.add(id);
        if (row.products.length < 5) row.products.push(productName);
      }
      row.evidence.add(c.evidence);
      // A consumer-model sighting outranks a chassis-code one: the same string can
      // legitimately appear in both positions across different labels.
      if (c.kind === 'consumer-model') row.kind = 'consumer-model';
    }
  }

  return byKey;
}

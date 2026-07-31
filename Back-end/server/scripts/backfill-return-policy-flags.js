/**
 * Backfill Product.returnPolicy flags from the signed Return/Refund policy's
 * non-returnable + non-cancellable classes. Run once after deploying the
 * returns feature so existing/imported products carry the right eligibility;
 * operators then fine-tune individual products in the admin editor.
 *
 * Classification is a HEURISTIC over category names, tags and the product name
 * (there is no structured "is electrical / custom / imported" field yet):
 *   - electrical → non-returnable (electrical/electronic components)
 *   - imported   → non-returnable (imported kits / special-order)
 *   - custom     → non-returnable AND non-cancellable (custom / made-to-order)
 * Everything else is left returnable + cancellable (the model default).
 *
 * Idempotent + non-destructive: it only ever tightens a flag (returnable/
 * cancellable true → false) for a matched product; it never re-opens a product an
 * admin has since marked non-returnable by hand. Re-running only adds new matches.
 *
 * Usage:
 *   node scripts/backfill-return-policy-flags.js            # dry run (report only)
 *   node scripts/backfill-return-policy-flags.js --apply    # write the flags
 *   railway run npm run backfill-return-policy-flags -- --apply   # against prod Mongo
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../models/Product.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');

// Keyword → class. Matched against the product NAME ONLY (deliberately NOT
// category/tags — a cross-sell tag like "lighting" on a roll bar produced obvious
// false positives, e.g. flagging a roll bar as electrical). This under-flags on
// purpose: it only tightens items whose NAME is unambiguous, and leaves everything
// else returnable for a human to classify in the admin editor. Order matters —
// first match wins — so put the most specific class first.
//
// electrical: physical lighting/electronics products (lights, LED, sensors, ECU).
//   These map to the policy's "electrical and electronic components". Excludes the
//   word "bar" alone (light BAR is caught by 'light'/'led', a roll bar is not).
// imported / custom: only when the NAME itself says so.
const RULES = [
  { cls: 'imported',   re: /\b(imported|special[-\s]?order)\b/i },
  { cls: 'custom',     re: /\b(custom(?:\s?-?\s?made)?|made[-\s]?to[-\s]?order|bespoke)\b/i },
  { cls: 'electrical', re: /\b(head\s?light|tail\s?light|fog\s?light|work\s?light|pod\s?light|driving\s?light|roof\s?light|marker\s?light|light\s?bar|led|drl|ecu|wiring\s?harness|sensor|flasher)\b/i },
];

// Physical PARTS that merely mention a light/LED in their name (a body kit "with
// tail light", a "diffuser with LED"). The product is predominantly a physical
// component, so flagging the whole thing electrical/non-returnable would wrongly
// block a legitimate return of the part — leave these for manual admin review.
const PHYSICAL_PART = /\b(body\s?kit|diffuser|grill|grille|bumper|splitter|bonnet|hood|roll\s?bar|side\s?step|roof\s?rack|steering\s?wheel|gear\s?knob)\b/i;

function classify(name) {
  for (const { cls, re } of RULES) {
    if (re.test(name)) {
      if (cls === 'electrical' && PHYSICAL_PART.test(name)) return null;
      return cls;
    }
  }
  return null;
}

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  await mongoose.connect(uri);
  console.log('[backfill-return-policy-flags] connected');
}

async function run() {
  await connect();

  const products = await Product.find({})
    .select('name returnPolicy')
    .lean();

  const summary = { electrical: 0, imported: 0, custom: 0, unchanged: 0 };
  const ops = [];

  for (const p of products) {
    const cls = classify(p.name || '');
    if (!cls) { summary.unchanged++; continue; }

    const current = p.returnPolicy || {};
    const set = { 'returnPolicy.returnable': false, 'returnPolicy.nonReturnReason': cls };
    // custom/installation are also non-cancellable once confirmed.
    if (cls === 'custom') set['returnPolicy.cancellable'] = false;

    // Skip if already exactly this (idempotent) — only tighten, never loosen.
    const already =
      current.returnable === false &&
      current.nonReturnReason === cls &&
      (cls !== 'custom' || current.cancellable === false);
    if (already) { summary.unchanged++; continue; }

    summary[cls]++;
    ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: set } } });
    console.log(`  [${cls}] ${p.name}`);
  }

  console.log(
    `\n[backfill-return-policy-flags] ${products.length} products scanned — ` +
    `electrical:${summary.electrical} imported:${summary.imported} custom:${summary.custom} unchanged:${summary.unchanged}`
  );

  if (!APPLY) {
    console.log('[backfill-return-policy-flags] DRY RUN — re-run with --apply to write.');
  } else if (ops.length) {
    const res = await Product.bulkWrite(ops);
    console.log(`[backfill-return-policy-flags] APPLIED — modified ${res.modifiedCount} products.`);
  } else {
    console.log('[backfill-return-policy-flags] nothing to write.');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[backfill-return-policy-flags] failed:', err);
  process.exit(1);
});

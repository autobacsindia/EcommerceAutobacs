/**
 * CLI: restore the "exactly one primary image" invariant across the catalogue.
 *
 *   node --import=dotenv/config scripts/repair-primary-image.js            # DRY RUN
 *   node --import=dotenv/config scripts/repair-primary-image.js --apply
 *   node --import=dotenv/config scripts/repair-primary-image.js --rollback=<journal.json>
 *
 * The decision lives in utils/productGallery.js `planPrimaryRepair` (pure,
 * unit-tested). This file is only Mongo I/O and reporting.
 *
 * ── What it fixes ───────────────────────────────────────────────────────────
 * 815 of 930 production products have a gallery with NO image flagged primary.
 * productGallery.js states the invariant as "a non-empty gallery always has
 * exactly one isPrimary"; the data has disagreed since a migration rewrote every
 * image into the `img-N.jpg` naming and dropped the flag.
 *
 * ── Why this is safe to run on a live store ─────────────────────────────────
 * It is a behavioural NO-OP. Every consumer already reads
 * `images.find(isPrimary) || images[0]`, so promoting images[0] writes down the
 * answer reads were ALREADY producing. Same thumbnails, same ads, same order
 * records — the only change is that the choice becomes recorded data instead of
 * an accident of array order.
 *
 * That property is what makes it safe, and it is also the constraint: this
 * script must never pick a "better" primary. Doing so would restyle 815 product
 * cards and every ad referencing them, which is a visible change and does not
 * belong in a data-hygiene fix.
 *
 * ── No cache purge needed ───────────────────────────────────────────────────
 * Nothing renders differently, so there is nothing stale to clear. (If that ever
 * stops being true, this script has stopped being a no-op and needs rethinking.)
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 *   • DRY RUN by default; --apply required to write.
 *   • Only ever sets `images[].isPrimary`. No other field, no deletes.
 *   • Journalled: every --apply writes repair-primary-image.<ts>.json with the
 *     exact prior images array of each product touched, and prints the rollback.
 *   • Skips galleries that are already correct, so a re-run is a no-op.
 */
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import Product from '../models/Product.js';
import { planPrimaryRepair } from '../utils/productGallery.js';

const TAG = '[repair-primary-image]';
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = null) => {
  const hit = argv.find((a) => a.startsWith(`${f}=`));
  return hit ? hit.slice(f.length + 1) : d;
};

const APPLY = has('--apply');
const ROLLBACK = val('--rollback');
const LIMIT = Number(val('--limit', Infinity));
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

/**
 * autoIndex OFF. It defaults to true, so merely connecting would build every
 * index declared across the model graph against whatever cluster this points at
 * — which for a local run is PRODUCTION.
 */
const connect = async () => {
  if (!MONGO_URI) { console.error(`${TAG} ✗ Missing MONGO_URI / MONGODB_URI`); process.exit(1); }
  await mongoose.connect(MONGO_URI, { autoIndex: false });
  console.log(`${TAG} connected to ${MONGO_URI.split('@').pop().split('/')[0]}`);
};

const rollback = async (file) => {
  const journal = JSON.parse(fs.readFileSync(file, 'utf8'));
  await connect();
  console.log(`${TAG} reverting ${journal.entries.length} product(s) from ${file}`);
  let n = 0;
  for (const e of journal.entries) {
    await Product.updateOne({ _id: e.productId }, { $set: { images: e.before } });
    n += 1;
  }
  console.log(`${TAG} reverted ${n} product(s).`);
  await mongoose.disconnect();
};

const main = async () => {
  if (ROLLBACK) return rollback(ROLLBACK);

  console.log(`${TAG} ${APPLY ? '*** APPLY ***' : 'DRY RUN (pass --apply to write)'}`);
  await connect();

  const products = await Product.find(
    { 'images.0': { $exists: true } },
    '_id name slug images',
  ).lean();
  console.log(`${TAG} ${products.length} product(s) with at least one image\n`);

  const plans = [];
  const reasons = { none: 0, multiple: 0 };
  for (const product of products) {
    const plan = planPrimaryRepair(product.images);
    if (!plan.changed) continue;
    reasons[plan.reason] += 1;
    plans.push({ product, images: plan.images, reason: plan.reason });
    if (plans.length >= LIMIT) break;
  }

  console.log(`${TAG} ── PLAN ─────────────────────────────────────────────`);
  console.log(`  already correct        : ${products.length - plans.length}`);
  console.log(`  no primary at all      : ${reasons.none}`);
  console.log(`  more than one primary  : ${reasons.multiple}`);
  console.log(`  products to repair     : ${plans.length}`);
  console.log(`\n  Each repair promotes the image reads ALREADY resolve to, so`);
  console.log(`  nothing on the storefront changes appearance.`);
  for (const p of plans.slice(0, 10)) {
    console.log(`      ${p.reason.padEnd(8)} ${p.product.slug}`);
  }
  if (plans.length > 10) console.log(`      … and ${plans.length - 10} more`);

  if (!APPLY) {
    console.log(`\n${TAG} DRY RUN — nothing written. Re-run with --apply.`);
    return mongoose.disconnect();
  }

  const journal = { startedAt: new Date().toISOString(), entries: [] };
  const journalPath = path.resolve(`repair-primary-image.${Date.now()}.json`);
  let written = 0;
  const failures = [];

  for (const p of plans) {
    try {
      journal.entries.push({ productId: String(p.product._id), slug: p.product.slug, before: p.product.images });
      await Product.updateOne({ _id: p.product._id }, { $set: { images: p.images } });
      written += 1;
      if (written % 100 === 0) console.log(`${TAG} [${written}/${plans.length}]`);
    } catch (err) {
      failures.push(`${p.product.slug}: ${err.message}`);
    }
  }

  if (journal.entries.length) fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  console.log(`\n${TAG} APPLIED — ${written}/${plans.length} product(s) repaired.`);
  if (failures.length) {
    console.error(`${TAG} ${failures.length} failure(s):`);
    failures.forEach((f) => console.error(`      ! ${f}`));
    process.exitCode = 1;
  }
  console.log(`${TAG} Journal: ${journalPath}`);
  console.log(`${TAG} Rollback: node --import=dotenv/config scripts/repair-primary-image.js --rollback=${journalPath}`);
  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(`${TAG} ✗ ${err.stack || err.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

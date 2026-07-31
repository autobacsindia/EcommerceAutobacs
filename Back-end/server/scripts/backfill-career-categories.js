/**
 * Backfill the managed `CareerCategory` collection from the category strings that
 * already live on JobPosting docs. Run once after deploying the managed-categories
 * feature so the admin Categories panel reflects the categories roles are already
 * grouped under (before this, roles referenced categories by free-text string and
 * no CareerCategory rows existed).
 *
 * Order: categories are created in the same FIRST-SEEN order the /careers page
 * groups them (by each role's sortOrder, then createdAt), and sortOrder is assigned
 * to match — so the public section order is unchanged after the backfill.
 *
 * Idempotent: existing categories (matched case-insensitively) are left untouched
 * — their sortOrder isn't clobbered — so re-running only ever adds what's missing.
 *
 * Usage:
 *   node scripts/backfill-career-categories.js            # dry run (report only)
 *   node scripts/backfill-career-categories.js --apply    # create the missing rows
 *   railway run npm run backfill-career-categories -- --apply   # against prod Mongo
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import CareerCategory from '../models/CareerCategory.js';
import JobPosting from '../models/JobPosting.js';
import { slugify, generateUniqueSlug } from '../utils/slug.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const CI = { locale: 'en', strength: 2 }; // case- + diacritic-insensitive collation

// Fold a name to the SAME key the CareerCategory name unique index compares on
// (collation locale 'en', strength:2 — case AND diacritic insensitive). Plain
// toLowerCase() keeps 'Café' ≠ 'Cafe', but the DB index collides them, so a JS
// dedup on toLowerCase would let a diacritic variant slip through and blow up on
// create() with E11000. NFD + strip combining marks (U+0300–U+036F) reproduces
// the fold.
const foldKey = (s) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI / MONGO_URI not set');
  await mongoose.connect(uri);
  console.log('[backfill-career-categories] connected');
}

async function run() {
  await connect();

  // Every posting that carries a category (any status), in the page's grouping
  // order. Including non-open roles means a category used only by a draft/closed
  // role still gets a managed entry the admin can see and reorder.
  const postings = await JobPosting.find({ category: { $nin: [null, ''] } })
    .select('category sortOrder createdAt')
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();

  // First-seen distinct names (keep original casing; dedupe with the SAME fold the
  // DB unique index uses, so 'Café' and 'Cafe' collapse to one here just as they
  // would collide on insert).
  const seen = new Set();
  const distinct = [];
  for (const p of postings) {
    const name = (p.category || '').trim();
    if (!name) continue;
    const key = foldKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(name);
  }

  const existing = await CareerCategory.find({}).collation(CI).lean();
  const existingKeys = new Set(existing.map((c) => foldKey(c.name)));
  let maxSort = existing.reduce((m, c) => Math.max(m, c.sortOrder ?? 0), -1);

  const toCreate = distinct.filter((n) => !existingKeys.has(foldKey(n)));

  console.log(
    `[backfill-career-categories] categories in postings=${distinct.length} ` +
    `already managed=${existing.length} to create=${toCreate.length}`
  );
  for (const name of distinct) {
    console.log(`  - ${name} [${existingKeys.has(foldKey(name)) ? 'exists' : 'NEW'}]`);
  }

  if (!APPLY) {
    console.log('[backfill-career-categories] dry run — re-run with --apply to write.');
    await mongoose.disconnect();
    return;
  }

  // Create each missing category independently. A single failure must NOT abort the
  // run and strand a half-written collection: a duplicate (E11000 — e.g. a concurrent
  // run, or a collation-equivalent row that slipped past the fold) is treated as an
  // idempotent skip; any other error is recorded and the loop moves on. sortOrder is
  // only advanced on a successful insert, so skips/failures never leave a numbering gap.
  let created = 0;
  let skipped = 0;
  const failures = [];
  for (const name of toCreate) {
    const nextSort = maxSort + 1;
    try {
      const slug = await generateUniqueSlug(CareerCategory, slugify(name) || 'category');
      await CareerCategory.create({ name, slug, sortOrder: nextSort });
      maxSort = nextSort; // advance only on success → no gaps
      created += 1;
      console.log(`  ✓ created "${name}" (slug=${slug}, sortOrder=${nextSort})`);
    } catch (err) {
      if (err?.code === 11000) {
        skipped += 1;
        console.warn(`  ~ skipped "${name}" (already exists / duplicate key)`);
      } else {
        failures.push({ name, error: err.message });
        console.error(`  ✗ failed "${name}": ${err.message}`);
      }
    }
  }

  console.log(
    `[backfill-career-categories] created ${created}, skipped ${skipped}, ` +
    `failed ${failures.length} (APPLIED)`
  );
  if (failures.length) {
    console.error('[backfill-career-categories] failures:', failures);
    process.exitCode = 1; // signal partial failure without aborting the clean disconnect
  }
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[backfill-career-categories] failed:', err);
  process.exit(1);
});

/**
 * Load the reviewed /model/<keyword> sheet into the redirect table.
 *
 * WHY: Search Console lists ~670 old WordPress landing pages (/model/floor-mat/…)
 * as 404. Most already redirect (they name a vehicle or a product); the rest need
 * a human to say where they go. The marketing team reviews the sheet, this script
 * writes their answers as `source: 'legacy'` rows, and the storefront middleware
 * serves them as one-hop 301s (or 410 Gone) within ~7 minutes. No deploy needed.
 *
 * SAFE BY DEFAULT
 *   - Dry run unless --apply. Prints every write, skip and error.
 *   - Only rows the reviewer filled in. Only targets that are live right now.
 *   - Never touches a row an admin set (source product/manual).
 *   - Refuses to apply while the sheet has errors (fix the sheet, rerun).
 *   - Idempotent: rerunning the same sheet writes nothing new.
 *   - `{ autoIndex: false }`: connecting never builds indexes on the cluster.
 *
 * ROLLBACK: --apply saves the batch (what it wrote and what each row held before)
 * to <sheet>.batch-<id>.json and prints the command. `--rollback <file>` deletes
 * the rows that batch created and puts back the targets it overwrote.
 *
 * Usage (prod: run through Railway so no local .env is involved):
 *   railway run node scripts/import-legacy-redirects.js <sheet.csv>            # dry run
 *   railway run node scripts/import-legacy-redirects.js <sheet.csv> --apply
 *   railway run node scripts/import-legacy-redirects.js --rollback <batch.json>
 */
import fs from 'node:fs';
import mongoose from 'mongoose';
import { parse } from 'csv-parse/sync';
import Redirect from '../models/Redirect.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Vehicle from '../models/Vehicle.js';
import { planLegacyImport, IMPORT_SOURCE } from '../utils/legacyRedirectImport.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const rollbackAt = args.indexOf('--rollback');
const ROLLBACK_FILE = rollbackAt >= 0 ? args[rollbackAt + 1] : null;
const SHEET = ROLLBACK_FILE ? null : args.find((a) => !a.startsWith('--'));

function die(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

/** Header names in the sheet carry a hint after the name ("approved_target (fill in…)"). */
function readSheet(file) {
  const rows = parse(fs.readFileSync(file, 'utf8'), {
    columns: (h) => h.map((c) => String(c).trim().split(/\s+/)[0].toLowerCase()),
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  });
  if (!rows.length || !('old_url' in rows[0]) || !('approved_target' in rows[0])) {
    die('the sheet needs old_url and approved_target columns');
  }
  return rows;
}

async function liveSets() {
  const [products, categories, vehicles] = await Promise.all([
    Product.find({ isActive: true, deletedAt: null }).select('slug').lean(),
    Category.find({ isActive: true }).select('slug').lean(),
    Vehicle.find({ isActive: true }).select('slug').lean(),
  ]);
  const set = (docs) => new Set(docs.map((d) => d.slug).filter(Boolean));
  return { products: set(products), categories: set(categories), vehicles: set(vehicles) };
}

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) die('MONGODB_URI is not set');
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
}

async function rollback(file) {
  const batch = JSON.parse(fs.readFileSync(file, 'utf8'));
  const created = batch.rows.filter((r) => r.previous === undefined).map((r) => r.fromPath);
  const restored = batch.rows.filter((r) => r.previous !== undefined);
  console.log(`batch ${batch.id}: delete ${created.length} created rows, restore ${restored.length} overwritten rows`);
  if (!APPLY) return console.log('dry run — add --apply to roll back');
  const del = await Redirect.deleteMany({ fromPath: { $in: created }, source: IMPORT_SOURCE });
  const ops = restored.map((r) => ({ updateOne: { filter: { fromPath: r.fromPath, source: IMPORT_SOURCE }, update: { $set: { toPath: r.previous } } } }));
  const res = ops.length ? await Redirect.bulkWrite(ops, { ordered: false }) : { modifiedCount: 0 };
  console.log(`rolled back: deleted ${del.deletedCount}, restored ${res.modifiedCount}`);
}

async function importSheet(file) {
  const rows = readSheet(file);
  const live = await liveSets();
  const existing = new Map(
    (await Redirect.find({ fromPath: { $regex: '^/model/' } }).select('fromPath toPath source').limit(50000).lean())
      .map((r) => [r.fromPath, r]),
  );
  const plan = planLegacyImport(rows, live, existing);

  const show = (label, list, fmt) => {
    console.log(`\n${label}: ${list.length}`);
    list.forEach((x) => console.log(`  ${fmt(x)}`));
  };
  show('WRITE', plan.writes, (w) => `${w.fromPath} → ${w.toPath ?? '410 Gone'}${w.previous !== undefined ? `   (was ${w.previous ?? '410'})` : ''}`);
  show('ERRORS (fix in the sheet)', plan.errors, (e) => `${e.fromPath}: ${e.reason}`);
  const reasons = plan.skipped.reduce((m, s) => m.set(s.reason, (m.get(s.reason) || 0) + 1), new Map());
  console.log(`\nunchanged: ${plan.unchanged.length}   skipped: ${plan.skipped.length}`);
  reasons.forEach((n, r) => console.log(`  ${n} × ${r}`));

  if (!APPLY) return console.log('\ndry run — nothing written. Add --apply to write.');
  if (plan.errors.length) die(`${plan.errors.length} error(s) in the sheet — fix them and rerun; nothing written`);
  if (!plan.writes.length) return console.log('\nnothing to write');

  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const batchFile = `${file}.batch-${id}.json`;
  // Saved BEFORE writing, so a crash mid-write still leaves a rollback path.
  fs.writeFileSync(batchFile, JSON.stringify({ id, sheet: file, rows: plan.writes }, null, 2));
  const res = await Redirect.bulkWrite(plan.writes.map((w) => ({
    updateOne: {
      filter: { fromPath: w.fromPath },
      update: { $set: { toPath: w.toPath, source: IMPORT_SOURCE, note: `model-review ${id}` } },
      upsert: true,
    },
  })), { ordered: false });
  console.log(`\nwrote: ${res.upsertedCount} new, ${res.modifiedCount} updated`);
  console.log('live on the storefront within ~7 minutes (edge map refresh).');
  console.log(`ROLLBACK: node scripts/import-legacy-redirects.js --rollback ${batchFile} --apply`);
}

async function main() {
  if (!ROLLBACK_FILE && !SHEET) die('usage: import-legacy-redirects.js <sheet.csv> [--apply] | --rollback <batch.json> [--apply]');
  await connect();
  try {
    if (ROLLBACK_FILE) await rollback(ROLLBACK_FILE);
    else await importSheet(SHEET);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

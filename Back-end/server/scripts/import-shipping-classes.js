/**
 * One-off: load the REVIEWED size-class sheet (researched online sizes) onto products.
 *
 * Sets `shippingClass` (as 'manual' — a person reviewed it) and the online-listed
 * `listedSize` + source link. "Not sure" rows leave the class blank. Rules and
 * safety guards: utils/shippingClassImport.js.
 *
 * Usage (production goes through Railway so the right MONGODB_URI is used — never
 * the local .env):
 *   node scripts/import-shipping-classes.js --file <sheet.csv>                    # dry run, changes nothing
 *   node scripts/import-shipping-classes.js --file <sheet.csv> --apply            # write + save a backup
 *   node scripts/import-shipping-classes.js --file <sheet.csv> --apply --overwrite  # also replace hand-set values
 *   node scripts/import-shipping-classes.js --rollback <backup.json>              # dry run of the undo
 *   node scripts/import-shipping-classes.js --rollback <backup.json> --apply      # undo
 *
 * ROLLBACK: --apply writes shipping-class-import-backup-<timestamp>.json next to
 * the sheet first, holding every changed product's previous values. --rollback
 * restores exactly those, and only on products still carrying the imported class.
 */

import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import {
  parseSheet, planImport, summarizePlan, applyPlan, applyRollback,
} from '../utils/shippingClassImport.js';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

const APPLY = flag('--apply');
const OVERWRITE = flag('--overwrite');
const FILE = value('--file');
const ROLLBACK = value('--rollback');

function die(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) die('MONGODB_URI (or MONGO_URI) is not set.');
  // autoIndex: false — connecting must never build indexes on whatever cluster this points at.
  await mongoose.connect(uri, { autoIndex: false });
  console.log(`db=${mongoose.connection.name}  host=${mongoose.connection.host}  mode=${APPLY ? 'APPLY' : 'DRY RUN'}`);
}

async function runImport() {
  const sheetPath = path.resolve(FILE);
  if (!fs.existsSync(sheetPath)) die(`No such file: ${sheetPath}`);
  let parsed;
  try {
    parsed = parseSheet(fs.readFileSync(sheetPath, 'utf8'));
  } catch (e) {
    die(e.message);
  }
  const { rows, errors } = parsed;
  console.log(`Sheet: ${rows.length} usable row(s), ${errors.length} row(s) with problems.`);
  for (const e of errors.slice(0, 50)) console.log(`  line ${e.line} ${e.slug || '(no slug)'}: ${e.error}`);
  if (errors.length > 50) console.log(`  …and ${errors.length - 50} more`);

  await connect();
  const products = await Product.find({ slug: { $in: rows.map((r) => r.slug) }, deletedAt: null })
    .select('_id slug name shippingClass shippingClassSource shippingSize listedSize')
    .lean();
  const plan = planImport(rows, products, { overwrite: OVERWRITE });
  console.log('\nSummary:', JSON.stringify(summarizePlan(plan), null, 2));
  for (const s of plan.notFound.slice(0, 20)) console.log(`  not found: ${s}`);
  for (const m of plan.skippedManual.slice(0, 20)) console.log(`  kept hand-set ${m.field} on ${m.slug} (use --overwrite to replace)`);
  for (const m of plan.mismatches.slice(0, 30)) console.log(`  check line ${m.line} ${m.slug}: sheet says ${m.sheet}, its size says ${m.sizeSays}`);

  if (!APPLY) {
    console.log('\nDry run — nothing was written. Re-run with --apply to save.');
    return;
  }
  if (plan.updates.length === 0) { console.log('\nNothing to write.'); return; }

  const backupPath = path.join(path.dirname(sheetPath), `shipping-class-import-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(plan.updates, null, 2));
  console.log(`\nBackup of previous values: ${backupPath}`);

  const { written, changedSincePlan } = await applyPlan(Product, plan);
  console.log(`Written: ${written} product(s).`);
  if (changedSincePlan.length) console.log(`Skipped, edited by someone since the plan: ${changedSincePlan.join(', ')}`);
  console.log(`\nTo undo:  node scripts/import-shipping-classes.js --rollback ${backupPath} --apply`);
}

async function runRollback() {
  const backupPath = path.resolve(ROLLBACK);
  if (!fs.existsSync(backupPath)) die(`No such file: ${backupPath}`);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'))
    .map((u) => ({ ...u, _id: new mongoose.Types.ObjectId(String(u._id)) }));
  console.log(`Backup holds ${backup.length} product(s).`);
  await connect();
  if (!APPLY) {
    console.log('Dry run — nothing was restored. Re-run with --apply to undo the import.');
    return;
  }
  const { restored } = await applyRollback(Product, backup);
  console.log(`Restored: ${restored} product(s). Products edited since the import were left as they are.`);
}

async function main() {
  if (!FILE && !ROLLBACK) die('Pass --file <sheet.csv> or --rollback <backup.json>.');
  if (FILE && ROLLBACK) die('Pass only one of --file or --rollback.');
  try {
    if (ROLLBACK) await runRollback();
    else await runImport();
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

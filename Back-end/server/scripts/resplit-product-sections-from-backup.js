/**
 * Re-split Key Features / Why Choose from the ORIGINAL descriptions captured in the
 * pre-migration backup, using the improved parser.
 *
 * Why a separate script: the first split migration already stripped the headings out
 * of Product.description, so re-running split-description-sections.js would find "no
 * headings" and skip. The original text lives only in the backup JSON written before
 * that migration (reports/product-prefields-backup-*.json). This re-derives
 * features[]/whyChoose[]/description from that backup with the current (fixed) parser,
 * correcting products whose items were collapsed into a single bullet.
 *
 * Safe + idempotent: re-running yields the same result. Dry-run by default; pass
 * --apply to write. Optionally pass --backup <file> (defaults to the newest backup).
 *
 * Usage:
 *   node scripts/resplit-product-sections-from-backup.js
 *   node scripts/resplit-product-sections-from-backup.js --apply
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import Product from '../models/Product.js';
import { looksLikeHtml, htmlBlocks, textBlocks, partition } from './split-description-sections.js';

dotenv.config();

function newestBackup() {
  const dir = path.join(process.cwd(), 'reports');
  const files = fs.readdirSync(dir)
    .filter(f => /^product-prefields-backup-.*\.json$/.test(f))
    .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error('No product-prefields-backup-*.json found in reports/');
  return path.join(dir, files[0].f);
}

(async () => {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const backupArg = argv.indexOf('--backup');
  const backupFile = backupArg !== -1 ? argv[backupArg + 1] : newestBackup();

  const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  if (!isMain) return;

  console.log(`\n=== Re-split from backup (${apply ? 'APPLY' : 'DRY_RUN'}) ===`);
  console.log(`Backup: ${backupFile}\n`);
  const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MongoDB URI not found in environment variables');
  await mongoose.connect(uri);
  console.log('✓ Connected to MongoDB');

  // Current feature/whyChoose counts, to report how many products improve.
  const current = await Product.find({}).select('_id features whyChoose').setOptions({ includeDeleted: true }).lean();
  const curById = new Map(current.map(p => [p._id.toString(), p]));

  const report = {
    timestamp: new Date().toISOString(),
    mode: apply ? 'APPLY' : 'DRY_RUN',
    backupFile,
    counts: { backupProducts: backup.length, matched: 0, noHeadings: 0, updated: 0, improved: 0, featuresTotal: 0, whyChooseTotal: 0 },
    improvedSamples: [],
    errors: [],
  };

  for (const b of backup) {
    try {
      const desc = b.description || '';
      const r = partition(looksLikeHtml(desc) ? htmlBlocks(desc) : textBlocks(desc), b.name);
      if (!r.matched) { report.counts.noHeadings++; continue; }
      report.counts.matched++;
      report.counts.featuresTotal += r.features.length;
      report.counts.whyChooseTotal += r.whyChoose.length;

      const cur = curById.get(b._id?.toString?.() || String(b._id));
      const curFeat = (cur?.features || []).length;
      const improved = r.features.length > curFeat; // collapsed (1) -> many
      if (improved) {
        report.counts.improved++;
        if (report.improvedSamples.length < 15) {
          report.improvedSamples.push({ name: b.name, before: curFeat, after: r.features.length, firstTwo: r.features.slice(0, 2) });
        }
      }

      if (apply) {
        await Product.updateOne(
          { _id: b._id },
          { $set: { description: r.description, features: r.features, whyChoose: r.whyChoose } },
          { includeDeleted: true }
        );
        report.counts.updated++;
      }
    } catch (err) {
      report.errors.push({ id: b._id, name: b.name, error: err.message });
    }
  }

  console.log('=== Summary ===');
  console.log(`  Backup products:        ${report.counts.backupProducts}`);
  console.log(`  Matched (have headings):${report.counts.matched}`);
  console.log(`  No headings (skipped):  ${report.counts.noHeadings}`);
  console.log(`  Products ${apply ? 'updated' : 'that WOULD update'}: ${apply ? report.counts.updated : report.counts.matched}`);
  console.log(`  Improved (more items than now): ${report.counts.improved}`);
  console.log(`  Feature items total:    ${report.counts.featuresTotal}`);
  console.log(`  Why-Choose items total: ${report.counts.whyChooseTotal}`);
  console.log(`  Errors:                 ${report.errors.length}`);
  if (report.improvedSamples.length) {
    console.log('\nImproved samples (before -> after feature count):');
    report.improvedSamples.forEach(s => console.log(`  ${s.before} -> ${s.after}  ${s.name}`));
  }
  if (!apply) console.log('\nDRY RUN — no changes written. Re-run with --apply to persist.');

  const outDir = path.join(process.cwd(), 'reports');
  const outFile = path.join(outDir, `resplit-${report.mode.toLowerCase()}-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\n✓ Report written to: ${outFile}`);

  await mongoose.connection.close();
  console.log('✓ Disconnected from MongoDB');
})().catch(err => { console.error('✗ Re-split failed:', err); process.exitCode = 1; });

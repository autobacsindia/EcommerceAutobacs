/**
 * Strip "bolt-on" product fields that were added AFTER the WooCommerce migration
 * and are no longer rendered or editable: packageContents, qna (legacy embedded),
 * variableSpecs, and the editorial marketing sections (productStoryText/Cards,
 * installationSteps, indianRoadsText/Cards).
 *
 * The Product schema definitions for these fields have been removed, so they are
 * dead weight on existing documents. This $unsets them across the collection.
 *
 * IMPORTANT ordering: run scripts/split-description-sections.js FIRST. That script
 * reads `description` (and is unaffected by these fields); this script does not
 * touch description/features/whyChoose/specifications/compatibleVehicles.
 *
 * Safety:
 *   - Dry-run by default: reports how many products carry non-empty values for
 *     each field (especially variableSpecs — confirm no live variant usage before
 *     applying). Pass --apply to write.
 *   - { strict: false } so the $unset runs even though the paths are no longer in
 *     the schema. A JSON report is always written to reports/.
 *
 * Usage:
 *   node scripts/strip-bolt-on-product-fields.js            # dry run (no writes)
 *   node scripts/strip-bolt-on-product-fields.js --apply    # apply changes
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import Product from '../models/Product.js';

dotenv.config();

const FIELDS = [
  'packageContents',
  'qna',
  'variableSpecs',
  'productStoryText',
  'productStoryCards',
  'installationSteps',
  'indianRoadsText',
  'indianRoadsCards',
];

class StripBoltOnFields {
  constructor({ apply }) {
    this.apply = apply;
    this.report = {
      timestamp: new Date().toISOString(),
      mode: apply ? 'APPLY' : 'DRY_RUN',
      fields: FIELDS,
      counts: {},          // field -> # docs with a non-empty value
      productsWithAny: 0,   // docs carrying at least one of the fields
      modified: 0,          // docs actually modified on --apply
    };
  }

  async connect() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new Error('MongoDB URI not found in environment variables');
    await mongoose.connect(uri);
    console.log('✓ Connected to MongoDB');
  }

  async disconnect() {
    await mongoose.connection.close();
    console.log('✓ Disconnected from MongoDB');
  }

  async run() {
    console.log(`\n=== Strip Bolt-On Product Fields (${this.report.mode}) ===\n`);
    const db = mongoose.connection.db;
    const coll = db.collection('products');

    // Per-field presence counts (non-null/non-empty). $exists alone would count
    // fields explicitly set to [] / '' — use $nin to require a real value.
    for (const f of FIELDS) {
      const count = await coll.countDocuments({
        [f]: { $exists: true, $nin: [null, '', []] },
      });
      this.report.counts[f] = count;
      console.log(`  ${f.padEnd(20)} present on ${count} product(s)`);
    }

    const anyFilter = { $or: FIELDS.map((f) => ({ [f]: { $exists: true } })) };
    this.report.productsWithAny = await coll.countDocuments(anyFilter);
    console.log(`\n  Products carrying ≥1 of these fields: ${this.report.productsWithAny}`);

    if (this.apply) {
      const unset = Object.fromEntries(FIELDS.map((f) => [f, '']));
      const res = await Product.updateMany(
        anyFilter,
        { $unset: unset },
        { strict: false, includeDeleted: true }
      );
      this.report.modified = res.modifiedCount ?? res.nModified ?? 0;
      console.log(`\n✓ Modified ${this.report.modified} product(s).`);
    } else {
      console.log('\nDRY RUN — no changes written. Review counts (esp. variableSpecs), then re-run with --apply.');
    }

    this.saveReport();
    return this.report;
  }

  saveReport() {
    const dir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `strip-bolt-on-${this.report.mode.toLowerCase()}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(this.report, null, 2));
    console.log(`✓ Report written to: ${file}`);
  }
}

(async () => {
  const apply = process.argv.slice(2).includes('--apply');
  const job = new StripBoltOnFields({ apply });
  try {
    await job.connect();
    await job.run();
  } catch (err) {
    console.error('✗ Strip failed:', err);
    process.exitCode = 1;
  } finally {
    await job.disconnect();
  }
})();

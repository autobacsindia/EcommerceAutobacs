/**
 * Split merged "Key Features" / "Why Choose" content out of Product.description
 * into the structured Product.features[] / Product.whyChoose[] fields.
 *
 * Background: in WooCommerce these were separate structured sections of the product
 * body, but the migration importer (services/wordpressSyncService.js) flattened the
 * whole HTML body through htmlToText into a single `description` field. As a result
 * the "Key Features" and "Why Choose ..." headings now sit INLINE inside description
 * text, and the public page resorts to a fragile render-time regex to pull them back
 * out. This one-time backfill reconstructs the structured fields so the page can read
 * real data and admins can curate them.
 *
 * Two parse branches, auto-detected per product:
 *   - HTML branch  (description still contains tags): split on <h2..h6> headings;
 *     each <p>/<li> under a heading becomes one list item.
 *   - Text branch  (flattened): split on standalone lines "Key Features" / "Why Choose…".
 *
 * Safety:
 *   - Idempotent: only products whose description STILL contains the headings are
 *     touched; after a successful split the markers are gone, so re-runs are no-ops.
 *   - A standalone heading is required (exact heading element or exact line) — the
 *     phrase appearing inside prose will NOT trigger a split.
 *   - Dry-run by default. Pass --apply to write. A JSON report is always written to
 *     reports/ with before/after samples for review.
 *   - Writes ONLY description, features, whyChoose. Back up the description field
 *     (mongoexport) before applying to production.
 *
 * Usage:
 *   node scripts/split-description-sections.js            # dry run (no writes)
 *   node scripts/split-description-sections.js --apply    # apply changes
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import Product from '../models/Product.js';
import { looksLikeHtml, htmlBlocks, textBlocks, partition } from '../utils/descriptionSections.js';

dotenv.config();

class DescriptionSplitBackfill {
  constructor({ apply }) {
    this.apply = apply;
    this.report = {
      timestamp: new Date().toISOString(),
      mode: apply ? 'APPLY' : 'DRY_RUN',
      counts: {
        totalProducts: 0,
        htmlBranch: 0,
        textBranch: 0,
        noHeadings: 0,
        productsChanged: 0,
        featuresExtracted: 0,
        whyChooseExtracted: 0,
        skippedEmptyResult: 0,
      },
      samples: [],   // before/after for eyeball review
      errors: [],
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
    console.log(`\n=== Description Section Split (${this.report.mode}) ===\n`);

    // includeDeleted: process every catalog product, active or not.
    const products = await Product.find({})
      .select('_id name description features whyChoose')
      .setOptions({ includeDeleted: true })
      .lean();
    this.report.counts.totalProducts = products.length;
    console.log(`Products: ${products.length}\n`);

    for (const product of products) {
      try {
        const desc = product.description || '';
        const isHtml = looksLikeHtml(desc);
        const blocks = isHtml ? htmlBlocks(desc) : textBlocks(desc);
        const result = partition(blocks, product.name);

        if (!result.matched) {
          this.report.counts.noHeadings++;
          continue;
        }
        this.report.counts[isHtml ? 'htmlBranch' : 'textBranch']++;

        // Guard: never blank out a description. If parsing left no intro text,
        // keep the original description and skip (surface for manual review).
        if (!result.description) {
          this.report.counts.skippedEmptyResult++;
          if (this.report.samples.length < 60) {
            this.report.samples.push({
              skipped: true, reason: 'empty intro after split',
              name: product.name, id: product._id.toString(),
            });
          }
          continue;
        }

        this.report.counts.productsChanged++;
        this.report.counts.featuresExtracted += result.features.length;
        this.report.counts.whyChooseExtracted += result.whyChoose.length;

        if (this.report.samples.length < 60) {
          this.report.samples.push({
            name: product.name,
            id: product._id.toString(),
            branch: isHtml ? 'html' : 'text',
            before: { description: desc.slice(0, 400) },
            after: {
              description: result.description.slice(0, 400),
              features: result.features,
              whyChoose: result.whyChoose,
            },
          });
        }

        if (this.apply) {
          await Product.findByIdAndUpdate(product._id, {
            $set: {
              description: result.description,
              features: result.features,
              whyChoose: result.whyChoose,
            },
          });
        }
      } catch (err) {
        this.report.errors.push({ id: product._id?.toString(), name: product.name, error: err.message });
      }
    }

    this.printSummary();
    this.saveReport();
    return this.report;
  }

  printSummary() {
    const c = this.report.counts;
    console.log('=== Summary ===');
    console.log(`  Total products:                      ${c.totalProducts}`);
    console.log(`  Parsed via HTML branch:              ${c.htmlBranch}`);
    console.log(`  Parsed via text branch:              ${c.textBranch}`);
    console.log(`  No Key-Features/Why-Choose headings: ${c.noHeadings}`);
    console.log(`  Products ${this.apply ? 'updated' : 'that WOULD change'}:   ${c.productsChanged}`);
    console.log(`  Feature items extracted:             ${c.featuresExtracted}`);
    console.log(`  Why-Choose items extracted:          ${c.whyChooseExtracted}`);
    console.log(`  Skipped (empty intro after split):   ${c.skippedEmptyResult}`);
    console.log(`  Errors:                              ${this.report.errors.length}`);

    const shown = this.report.samples.filter((s) => !s.skipped).slice(0, 3);
    if (shown.length) {
      console.log('\nSample (first few):');
      for (const s of shown) {
        console.log(`\n  • ${s.name}  [${s.branch}]`);
        console.log(`    features (${s.after.features.length}): ${s.after.features.slice(0, 2).join(' | ')}`);
        console.log(`    whyChoose (${s.after.whyChoose.length}): ${s.after.whyChoose.slice(0, 2).join(' | ')}`);
      }
    }
    if (!this.apply) {
      console.log('\nDRY RUN — no changes written. Review the report, then re-run with --apply.');
    }
  }

  saveReport() {
    const dir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `description-split-${this.report.mode.toLowerCase()}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(this.report, null, 2));
    console.log(`\n✓ Report written to: ${file}`);
  }
}

// Pure parsing helpers exported for unit testing.
export { looksLikeHtml, htmlBlocks, textBlocks, partition, coalesceItems, stripTags } from '../utils/descriptionSections.js';

// Only run the migration when executed directly (not when imported by tests).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  (async () => {
    const apply = process.argv.slice(2).includes('--apply');
    const backfill = new DescriptionSplitBackfill({ apply });
    try {
      await backfill.connect();
      await backfill.run();
    } catch (err) {
      console.error('✗ Backfill failed:', err);
      process.exitCode = 1;
    } finally {
      await backfill.disconnect();
    }
  })();
}

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

dotenv.config();

const HEADING_KEY_FEATURES = /^key\s+features$/i;
const HEADING_WHY_CHOOSE   = /^why\s+choose\b/i;
// Item title/desc separator the frontend renders/bolds on (spaced en-dash or hyphen).
const SPACED_DASH = /\s[–-]\s/;
// Inline "Capitalized Title:description" on one line (colon instead of dash).
const TITLE_COLON = /^([A-Z][^:]{1,60}?):\s*(\S[\s\S]*)$/;
// A line that is ONLY a title — "Advanced Foam Cell Technology:" — whose
// description follows on the next block(s). Common in the migrated text where each
// heading and paragraph became its own line.
const BARE_TITLE = /^[A-Z][^:\n]{1,80}:$/;

/** Strip HTML tags and decode the handful of entities WooCommerce emits. */
function stripTags(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&#8211;|&ndash;/gi, '–')
    .replace(/&#8212;|&mdash;/gi, '—')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeHtml(s) {
  return /<\/?(h[1-6]|p|ul|ol|li|div|strong|br|span)\b/i.test(s || '');
}

// Normalize an item to the "Title – desc" shape the frontend renders/bolds on.
// Leaves dash-style items untouched; rewrites a leading "Title:desc" colon to a
// spaced en-dash so colon-style and dash-style items render consistently.
function normalizeItem(item) {
  const t = item.replace(/\s+/g, ' ').trim();
  if (SPACED_DASH.test(t)) return t;
  const m = t.match(TITLE_COLON);
  return m ? `${m[1].trim()} – ${m[2].trim()}` : t;
}

// Some migrated products crammed an entire section onto ONE line:
//   "Title One:desc one. Title Two:desc two. Title Three:desc three"
// Split such a block before each capitalized "Title:" that begins a new point
// (at string start, or after sentence-ending punctuation). Blocks without a
// second title are returned unchanged.
function explodeInlineTitles(block) {
  const re = /(^|[.!?]\s+)([A-Z][^:\n]{2,60}?:)/g;
  const starts = [];
  let m;
  while ((m = re.exec(block)) !== null) starts.push(m.index + m[1].length);
  if (starts.length <= 1) return [block.trim()].filter(Boolean);
  const parts = [];
  const head = block.slice(0, starts[0]).trim();
  if (head) parts.push(head); // text before the first title (rare)
  for (let i = 0; i < starts.length; i++) {
    const stop = i + 1 < starts.length ? starts[i + 1] : block.length;
    parts.push(block.slice(starts[i], stop).trim());
  }
  return parts.filter(Boolean);
}

/**
 * Assemble flattened blocks into clean "Title – desc" items, handling every shape
 * seen in the migrated catalog:
 *   • "Title – desc" on one line                  → one item
 *   • "Title:desc" on one line                    → one item (colon → dash)
 *   • "Title:" on its own line, desc on the next  → title + following line(s)
 *   • multiple "Title:desc" on a single line      → split into several items
 *   • a plain follow-up sentence                  → folded into the previous item
 */
function coalesceItems(items) {
  // 1) explode any single line that packs multiple titles into separate blocks.
  const blocks = items.flatMap((raw) => explodeInlineTitles((raw || '').replace(/\s+/g, ' ').trim()));

  // 2) state machine: bare-title lines open an item that the next plain line fills.
  const assembled = []; // { title, desc } | { whole }
  for (const block of blocks) {
    if (!block) continue;
    if (BARE_TITLE.test(block)) {
      assembled.push({ title: block.replace(/:\s*$/, '').trim(), desc: '' });
    } else if (SPACED_DASH.test(block) || TITLE_COLON.test(block)) {
      assembled.push({ whole: block });
    } else {
      const last = assembled[assembled.length - 1];
      if (last && last.title !== undefined) {
        last.desc = last.desc ? `${last.desc} ${block}` : block;
      } else if (last && last.whole !== undefined) {
        last.whole = `${last.whole} ${block}`;
      } else {
        assembled.push({ whole: block });
      }
    }
  }

  // 3) render each to a normalized "Title – desc" string.
  return assembled
    .map((it) => (it.whole !== undefined
      ? normalizeItem(it.whole)
      : normalizeItem(it.desc ? `${it.title} – ${it.desc}` : it.title)))
    .filter(Boolean);
}

/** Parse an HTML description into ordered blocks: { type: 'heading'|'item', text }. */
function htmlBlocks(html) {
  const re = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>|<p\b[^>]*>([\s\S]*?)<\/p>|<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  const blocks = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) blocks.push({ type: 'heading', text: stripTags(m[2]) });
    else blocks.push({ type: 'item', text: stripTags(m[3] ?? m[4] ?? '') });
  }
  return blocks;
}

/** Parse a flattened text description into ordered blocks (each non-empty line). */
function textBlocks(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      if (HEADING_KEY_FEATURES.test(line) || HEADING_WHY_CHOOSE.test(line)) {
        return { type: 'heading', text: line };
      }
      return { type: 'item', text: line };
    });
}

/**
 * Walk ordered blocks through a Key-Features / Why-Choose state machine.
 * Returns { description, features, whyChoose, matched } where matched indicates
 * at least one of the two headings was actually found.
 */
function partition(blocks, productName) {
  const introParts = [];
  const features = [];
  const whyChoose = [];
  let section = 'intro';
  let matched = false;
  const nameNorm = (productName || '').trim().toLowerCase();

  for (const b of blocks) {
    if (b.type === 'heading') {
      if (HEADING_KEY_FEATURES.test(b.text)) { section = 'features'; matched = true; continue; }
      if (HEADING_WHY_CHOOSE.test(b.text))   { section = 'whyChoose'; matched = true; continue; }
      // Any other heading (typically the <h2> product-name title): keep as intro
      // text only if it isn't just a duplicate of the product name.
      if (b.text && b.text.trim().toLowerCase() !== nameNorm && section === 'intro') {
        introParts.push(b.text);
      }
      continue;
    }
    // item
    if (section === 'features') features.push(b.text);
    else if (section === 'whyChoose') whyChoose.push(b.text);
    else {
      // Drop a leading intro line that merely repeats the product name.
      if (introParts.length === 0 && b.text.trim().toLowerCase() === nameNorm) continue;
      introParts.push(b.text);
    }
  }

  return {
    description: introParts.join('\n\n').trim(),
    features: coalesceItems(features),
    whyChoose: coalesceItems(whyChoose),
    matched,
  };
}

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
export { looksLikeHtml, htmlBlocks, textBlocks, partition, coalesceItems, stripTags };

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

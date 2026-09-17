/**
 * Backfill product -> vehicle fitment (Product.compatibleVehicles)
 *
 * WooCommerce never stored structured fitment (no product attributes); the only
 * reliable signal is the make/model embedded in each product's name / tags /
 * description. This script reads that text and links each product to the
 * matching Vehicle rows so the "My Vehicle" filter, shop-by-vehicle tiles and
 * GET /products/by-vehicle/:slug all return results.
 *
 * Design notes (see docs / plan):
 *  - Data-driven: match phrases are derived from the live Vehicle collection, so
 *    coverage automatically tracks whatever vehicles exist. A small alias map
 *    only covers spelling variants the DB can't express (Suzuki<->Maruti, V-Cross
 *    as a D-Max variant, etc.).
 *  - A product is linked to ALL year-rows of every matched (make, model). The
 *    shop-by-vehicle path resolves a slug to ONE specific Vehicle._id and matches
 *    it exactly, so linking only one arbitrary year-row can leave that path empty.
 *  - Idempotent: writes use $addToSet, so the script is safe to re-run.
 *  - Dry-run by default. Pass --apply to write. A JSON report is always written
 *    to reports/ for review.
 *
 * Usage:
 *   node scripts/backfill-vehicle-fitment.js            # dry run (no writes)
 *   node scripts/backfill-vehicle-fitment.js --apply    # apply changes
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import Product from '../models/Product.js';
import Vehicle from '../models/Vehicle.js';
// Shared with scripts/audit-vehicle-candidates.js. These lived here as local
// consts until 2026-09-17; the audit needs the SAME spelling rules, and two
// copies would mean the audit recommends a row this script then fails to match.
import {
  MODEL_ALIASES,
  MAKE_ALIASES,
  phraseVariants,
  tokenMatch,
  stylingMatch,
  isVehicleAxis,
  needsMakeConfirmation,
} from '../utils/vehicleMatch.js';

dotenv.config();

// Vehicles people commonly reference that are NOT in the Vehicle collection yet.
// Used only to surface "you should add a Vehicle row for this" in the report.
const WATCH_MISSING_MODELS = [
  'scorpio', 'bolero', 'xuv', 'xuv700', 'xuv300', 'bolero neo',
  'innova', 'innova crysta', 'fortuner legender',
  'swift', 'baleno', 'brezza', 'ertiga', 'grand vitara',
  'creta n line', 'venue', 'seltos x line', 'sonet', 'carens',
  'compass', 'meridian', 'gurkha', 'isuzu mu-x', 'mu-x',
];


class VehicleFitmentBackfill {
  constructor({ apply }) {
    this.apply = apply;
    this.report = {
      timestamp: new Date().toISOString(),
      mode: apply ? 'APPLY' : 'DRY_RUN',
      counts: {
        activeVehicles: 0,
        distinctModels: 0,
        activeProducts: 0,
        productsChanged: 0,
        productsUnchanged: 0,
        vehicleLinksAdded: 0,
        orphanRefsRemoved: 0,
      },
      perModelMatches: {},      // "Make Model" -> products matched
      lowConfidence: [],        // matches that relied on a short token w/o make
      sampleMappings: [],       // first N applied/intended mappings
      unmatchedMentions: [],    // products that mention a vehicle we couldn't map
      errors: [],
    };
  }

  async connect() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new Error('MongoDB URI not found in environment variables');
    // ⚠ autoIndex defaults to TRUE. This file imports Product and Vehicle, so a
    // bare connect() would build every index those schemas declare against
    // whatever cluster the URI names — which, with the local .env, is production.
    // Prod deliberately runs autoIndex:false so index changes arrive by migration,
    // and a script quietly rebuilding them defeats that. Matches the guard already
    // in backfill-stock-rank.js and verify-search-relevance.js.
    await mongoose.connect(uri, { autoIndex: false });
    console.log('✓ Connected to MongoDB');
  }

  async disconnect() {
    await mongoose.connection.close();
    console.log('✓ Disconnected from MongoDB');
  }

  /** Build the model index from the live Vehicle collection. */
  async buildModelIndex() {
    const vehicles = await Vehicle.find({ isActive: true })
      .select('_id make model year slug')
      .lean();
    this.report.counts.activeVehicles = vehicles.length;

    const index = new Map(); // key: "make|model" (lower) -> entry
    for (const v of vehicles) {
      const key = `${v.make}|${v.model}`.toLowerCase();
      let entry = index.get(key);
      if (!entry) {
        const modelKey = v.model.toLowerCase().trim();
        const makeKey = v.make.toLowerCase().trim();
        const modelPhrases = new Set();
        phraseVariants(v.model).forEach((p) => modelPhrases.add(p));
        (MODEL_ALIASES[modelKey] || []).forEach((a) =>
          phraseVariants(a).forEach((p) => modelPhrases.add(p)));

        const makePhrases = new Set();
        phraseVariants(v.make).forEach((p) => makePhrases.add(p));
        (MAKE_ALIASES[makeKey] || []).forEach((a) =>
          phraseVariants(a).forEach((p) => makePhrases.add(p)));

        // Ambiguous = a model token that cannot stand alone: a very short one
        // ("X5", "Q7") or an ordinary English word ("City", "Accent"). Either way
        // the make must also appear before the match is accepted. See
        // needsMakeConfirmation — the word list was added after a dry run proposed
        // 49 Honda City links, nearly all from "ideal for city driving".
        entry = {
          make: v.make,
          model: v.model,
          label: `${v.make} ${v.model}`,
          ids: [],
          modelPhrases: [...modelPhrases],
          makePhrases: [...makePhrases],
          ambiguous: needsMakeConfirmation(modelKey),
        };
        index.set(key, entry);
      }
      entry.ids.push(v._id);
    }
    this.report.counts.distinctModels = index.size;
    return [...index.values()];
  }

  /** Match a product against the index. Returns { ids, matches, mentions }. */
  matchProduct(product, modelEntries) {
    // NOTE: tags are intentionally EXCLUDED. The migrated WooCommerce tags are
    // SEO keyword-stuffing that name-drops unrelated/competitor models
    // (e.g. a Honda City kit tagged "Fortuner Body Kit", "Thar body kit"; a Hilux
    // part tagged "hilux vs fortuner"), which produces large-scale false fitment.
    // The product name (and, secondarily, the description) is the reliable signal.
    // Vehicle-axis variant labels ARE included, added 2026-09-17. For a grouped
    // product the model rows are the most explicit fitment statement in the whole
    // record — "BMC Air Filter for BMW" names only the make, while its 13 labels
    // name every car it fits. Without them those products could never be linked to
    // anything more specific than the make, which is the gap that started this work.
    //
    // ⚠ Only variants whose ATTRIBUTE AXIS names a vehicle. Across the 111 live
    // variable products the axis is `package` on 42 and `color` on 12 — feeding a
    // colour list in would let a vehicle named like a colour or a size match, and
    // fitment invented from a dropdown of paint options is worse than no fitment.
    const variantText = (product.variants || [])
      .filter((v) => isVehicleAxis(v.attributes))
      .map((v) => v.label || '')
      .join('  ');

    const text = [
      product.name || '',
      product.description || '',
      variantText,
    ].join('  ').toLowerCase();

    const raw = [];
    for (const entry of modelEntries) {
      const hitVariants = entry.modelPhrases.filter((v) => tokenMatch(text, v));
      if (hitVariants.length === 0) continue;
      const makeHit = entry.makePhrases.some((v) => tokenMatch(text, v));
      if (entry.ambiguous && !makeHit) continue; // too risky without the make

      // Styling reference (e.g. "Defender-style ... for Thar") rather than fitment.
      const styling = hitVariants.every((v) => stylingMatch(text, v));
      const confidence = makeHit || entry.model.replace(/[^a-z0-9]/gi, '').length > 4
        ? 'high'
        : 'medium';
      raw.push({ entry, label: entry.label, confidence, styling });
    }

    // Drop styling-only models when at least one solid (non-styling) model matched;
    // keep them only when they're the sole signal (best-effort fallback).
    const hasSolid = raw.some((m) => !m.styling);
    const matches = [];
    const idSet = new Set();
    for (const m of raw) {
      if (m.styling && hasSolid) continue;
      matches.push({ label: m.label, confidence: m.confidence });
      m.entry.ids.forEach((id) => idSet.add(id.toString()));
    }

    // Surface vehicles we couldn't map (missing Vehicle rows) for manual follow-up.
    const mentions = [];
    if (matches.length === 0) {
      for (const m of WATCH_MISSING_MODELS) {
        if (phraseVariants(m).some((v) => tokenMatch(text, v))) mentions.push(m);
      }
    }
    return { idStrings: [...idSet], matches, mentions };
  }

  async run() {
    console.log(`\n=== Vehicle Fitment Backfill (${this.report.mode}) ===\n`);
    const modelEntries = await this.buildModelIndex();
    console.log(`Vehicles: ${this.report.counts.activeVehicles} active, ` +
      `${this.report.counts.distinctModels} distinct models`);

    // Every existing Vehicle._id (active or not). Any id on a product NOT in this
    // set is an orphaned/dead reference (the Vehicle collection was reseeded) and
    // is stripped, since it can never match a vehicle in any query.
    const liveIdSet = new Set(
      (await Vehicle.find({}).select('_id').lean()).map((v) => v._id.toString())
    );

    const products = await Product.find({ isActive: true })
      .select('_id name sku tags description compatibleVehicles variants.label variants.attributes')
      .lean();
    this.report.counts.activeProducts = products.length;
    console.log(`Products: ${products.length} active\n`);

    for (const product of products) {
      try {
        const { idStrings, matches, mentions } = this.matchProduct(product, modelEntries);

        if (mentions.length) {
          this.report.unmatchedMentions.push({
            id: product._id.toString(),
            name: product.name,
            mentions: [...new Set(mentions)],
          });
        }

        const existing = (product.compatibleVehicles || []).map((id) => id.toString());
        const existingLive = existing.filter((id) => liveIdSet.has(id)); // keep valid (e.g. manual) links
        const orphanCount = existing.length - existingLive.length;       // dead refs to drop

        // Final desired set: valid existing links ∪ text-matched links.
        const finalSet = new Set([...existingLive, ...idStrings]);
        const addedLinks = idStrings.filter((id) => !existingLive.includes(id)).length;

        for (const m of matches) {
          this.report.perModelMatches[m.label] = (this.report.perModelMatches[m.label] || 0) + 1;
        }
        if (matches.some((m) => m.confidence === 'medium')) {
          this.report.lowConfidence.push({
            id: product._id.toString(),
            name: product.name,
            matches: matches.map((m) => `${m.label} (${m.confidence})`),
          });
        }

        // Did the array actually change? (links added OR orphans removed)
        const changed = finalSet.size !== existing.length ||
          [...finalSet].some((id) => !existing.includes(id));
        if (!changed) {
          this.report.counts.productsUnchanged++;
          continue;
        }

        this.report.counts.productsChanged++;
        this.report.counts.vehicleLinksAdded += addedLinks;
        this.report.counts.orphanRefsRemoved += orphanCount;
        if (this.report.sampleMappings.length < 40 && matches.length) {
          this.report.sampleMappings.push({
            name: product.name,
            adds: matches.map((m) => m.label),
            newLinks: addedLinks,
            orphansRemoved: orphanCount,
          });
        }

        if (this.apply) {
          await Product.findByIdAndUpdate(product._id, {
            $set: { compatibleVehicles: [...finalSet].map((id) => new mongoose.Types.ObjectId(id)) },
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
    console.log(`  Products ${this.apply ? 'updated' : 'that WOULD change'}:   ${c.productsChanged}`);
    console.log(`  Already up to date:                  ${c.productsUnchanged}`);
    console.log(`  Vehicle links ${this.apply ? 'added' : 'to add'}:            ${c.vehicleLinksAdded}`);
    console.log(`  Orphan refs ${this.apply ? 'removed' : 'to remove'}:          ${c.orphanRefsRemoved}`);
    console.log(`  Errors:                              ${this.report.errors.length}`);

    console.log('\nMatches per vehicle:');
    Object.entries(this.report.perModelMatches)
      .sort((a, b) => b[1] - a[1])
      .forEach(([label, n]) => console.log(`  ${label}: ${n}`));

    if (this.report.sampleMappings.length) {
      console.log('\nSample mappings:');
      this.report.sampleMappings.slice(0, 15).forEach((s) =>
        console.log(`  ${s.name}  ->  ${s.adds.join(', ')}  (+${s.newLinks})`));
    }
    if (this.report.lowConfidence.length) {
      console.log(`\n⚠ ${this.report.lowConfidence.length} low-confidence match(es) — review the report.`);
    }
    if (this.report.unmatchedMentions.length) {
      console.log(`\nℹ ${this.report.unmatchedMentions.length} product(s) mention a vehicle with no Vehicle row ` +
        `(add the row, then re-run). e.g.:`);
      this.report.unmatchedMentions.slice(0, 8).forEach((u) =>
        console.log(`  ${u.name}  ->  ${u.mentions.join(', ')}`));
    }
    if (!this.apply) {
      console.log('\nDRY RUN — no changes written. Re-run with --apply to persist.');
    }
  }

  saveReport() {
    const dir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `vehicle-fitment-backfill-${this.report.mode.toLowerCase()}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(this.report, null, 2));
    console.log(`\n✓ Report written to: ${file}`);
  }
}

(async () => {
  const apply = process.argv.slice(2).includes('--apply');
  const backfill = new VehicleFitmentBackfill({ apply });
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

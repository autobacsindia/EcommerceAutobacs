/**
 * Which vehicles does the catalogue sell parts for that we have no `Vehicle` row?
 *
 * WHY THIS EXISTS
 * ---------------
 * The vehicle filter is ObjectId set-membership on `Product.compatibleVehicles`
 * (services/atlasSearchService.js), so a product can only be filtered to a vehicle
 * that EXISTS as a row. Measured 2026-09-17 on prod: 29 vehicle rows for 930 active
 * products, and 373 of those products carry no fitment at all. Several makes the
 * catalogue actively sells for — Honda, Renault, Nissan — have never had a row, so
 * no amount of backfilling can reach them.
 *
 * scripts/backfill-vehicle-fitment.js answers the other half ("which KNOWN vehicle
 * does this product fit?") by deriving its match phrases from the Vehicle
 * collection. That is exactly why it cannot answer this one: a make with zero rows
 * is invisible to it. Both scripts share utils/vehicleMatch.js so their spelling
 * rules cannot drift apart.
 *
 * WHAT IT READS
 * -------------
 * Vehicle-axis variant labels, plus product names for the make-gap summary.
 *
 * ⚠ `tags` are deliberately NOT read, matching the backfill's long-standing note:
 * migrated WooCommerce tags are SEO keyword-stuffing that name-drops competitor
 * models (a Hilux part tagged "hilux vs fortuner"), so they manufacture fitment
 * that does not exist.
 *
 * ⚠ Only variants whose ATTRIBUTE AXIS names a vehicle are read. Across the 111
 * live variable products the axis is `package` on 42 and `color` on 12; reading
 * those would propose creating vehicles called "Red" and "22 Inch - Dual Row".
 *
 * ⚠ EVERY ROW CREATED IS PUBLIC. A Vehicle becomes a page at
 * /vehicles/{make}/{model} and a sitemap entry, so `--apply` is gated behind a
 * product-count threshold and chassis codes need a second, explicit flag.
 *
 * Usage:
 *   node scripts/audit-vehicle-candidates.js                       # dry run
 *   node scripts/audit-vehicle-candidates.js --min-products=2      # raise the bar
 *   node scripts/audit-vehicle-candidates.js --apply               # create rows
 *   node scripts/audit-vehicle-candidates.js --apply --include-chassis-codes
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import Product from '../models/Product.js';
import Vehicle from '../models/Vehicle.js';
import {
  KNOWN_MAKES,
  MODEL_ALIASES,
  isVehicleAxis,
  splitCompoundLabel,
  cleanModelLabel,
  looksLikeChassisCode,
  detectMake,
  vehicleSlug,
  makeDisplayName,
  titleCaseModel,
  phraseVariants,
  tokenMatch,
} from '../utils/vehicleMatch.js';

dotenv.config();

/**
 * ── CURATION ──────────────────────────────────────────────────────────────────
 *
 * Reviewed against the production dry run on 2026-09-17. Held in code rather than
 * applied by hand in the admin so the decisions are reviewable, repeatable and
 * attributable — a row someone clicked into existence six months ago is
 * indistinguishable from a mistake.
 */

/** Cleaned model → the name it should actually be stored under. */
const MODEL_CORRECTIONS = {
  // Generation markers. "Octavia III" and "Octavia" are one car to a shopper, and
  // two rows would split its products across two filter entries.
  'octavia iii': 'Octavia',
  // "A 200" is one variant of the A-Class; the row should be the model.
  'a 200': 'A-Class',
  // Honda's own spelling. titleCaseModel renders the label's "BRV" as "Brv",
  // since a 3-letter token with no digit is indistinguishable from a word.
  brv: 'BR-V',
  'mu 7': 'MU-7',
};

/** Cleaned models that are NOT cars, found by reviewing the dry-run output. */
const MODEL_DENYLIST = new Set([
  'polo m pi',   // a mangled MPI engine designation, not a Polo variant
]);

/**
 * Real, popular cars that the --min-products threshold drops.
 *
 * The threshold works as a NOISE filter — a genuine model name is spelled the same
 * way by several products, while a trim or generation fragment appears once. That
 * is why 2 cuts cleanly. But it also discards cars whose labels happen to be
 * written inconsistently: Honda City is India's best-selling sedan and appears as
 * four separate generation fragments ("CITY - VIth GEN", "CITY - Vth GEN", …), so
 * every spelling sits at a count of one.
 *
 * These are force-included at any count. Each was checked against the dry run as a
 * car the catalogue genuinely sells parts for.
 */
const ALWAYS_INCLUDE = [
  ['honda', 'City'], ['honda', 'Accord'], ['honda', 'Mobilio'], ['honda', 'WR-V'],
  ['ford', 'Figo'], ['ford', 'Fiesta'], ['ford', 'EcoSport'], ['ford', 'Mustang'],
  ['hyundai', 'Venue'], ['hyundai', 'Santa Fe'], ['hyundai', 'Accent'],
  ['hyundai', 'Eon'], ['hyundai', 'Santro'],
  ['isuzu', 'MU-7'],
];

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const includeChassis = args.includes('--include-chassis-codes');
const minProducts = Number(
  (args.find((a) => a.startsWith('--min-products=')) || '--min-products=1').split('=')[1]
) || 1;

class VehicleCandidateAudit {
  constructor(options) {
    Object.assign(this, options);
    this.report = {
      timestamp: new Date().toISOString(),
      mode: this.apply ? 'APPLY' : 'DRY_RUN',
      options: { minProducts: this.minProducts, includeChassis: this.includeChassis },
      counts: {
        activeProducts: 0,
        vehicleAxisProducts: 0,
        existingVehicles: 0,
        candidatesFound: 0,
        wouldCreate: 0,
        created: 0,
      },
      candidates: [],   // eligible new make+model, ranked by product count
      skipped: {
        alreadyExists: [],
        chassisCode: [],
        belowThreshold: [],
        noMake: [],
      },
      makeGaps: [],     // makes the catalogue sells for with few/no Vehicle rows
      errors: [],
    };
  }

  async connect() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new Error('MongoDB URI not found in environment variables');
    // ⚠ autoIndex defaults to TRUE and this file imports models, so a bare
    // connect() would build every declared index against whatever cluster the URI
    // names — production, with the local .env.
    await mongoose.connect(uri, { autoIndex: false });
    console.log('✓ Connected to MongoDB');
  }

  async disconnect() {
    await mongoose.connection.close();
    console.log('✓ Disconnected from MongoDB');
  }

  /**
   * Existing rows, keyed "make|model" on the CANONICAL make.
   *
   * Keyed on the canonical make rather than the stored string so "Maruti" and a
   * product saying "Suzuki" resolve to one key — otherwise the audit proposes
   * "Suzuki Ertiga" while "Maruti Ertiga" already exists.
   *
   * Also returns the display spelling each make already uses, so a created row
   * can never disagree with its siblings ("BMW", not "Bmw").
   */
  async loadExisting() {
    const vehicles = await Vehicle.find({}).select('make model slug isActive').lean();
    this.report.counts.existingVehicles = vehicles.length;

    const keys = new Set();
    const displayByMake = new Map();
    const rowsByMake = new Map();

    for (const v of vehicles) {
      const canonical = detectMake(v.make) || String(v.make).toLowerCase().trim();
      const model = String(v.model).toLowerCase().trim();

      // Every spelling this row answers to, not just its stored one. Without the
      // alias arm the audit proposes "Mahindra Scorpio" while "Mahindra Scorpio N"
      // already exists — MODEL_ALIASES maps 'scorpio n' → ['scorpio'] precisely
      // because the catalogue writes it both ways, and cleanModelLabel strips the
      // trailing bare "N". Two rows for one car splits its products across two
      // filter entries, which is worse than the gap we set out to close.
      const spellings = new Set();
      phraseVariants(model).forEach((p) => spellings.add(p));
      (MODEL_ALIASES[model] || []).forEach((a) =>
        phraseVariants(a).forEach((p) => spellings.add(p)));
      for (const [canonicalModel, aliases] of Object.entries(MODEL_ALIASES)) {
        if (aliases.includes(model)) phraseVariants(canonicalModel).forEach((p) => spellings.add(p));
      }
      for (const spelling of spellings) keys.add(`${canonical}|${spelling}`);

      if (!displayByMake.has(canonical)) displayByMake.set(canonical, v.make);
      rowsByMake.set(canonical, (rowsByMake.get(canonical) || 0) + 1);
    }
    return { keys, displayByMake, rowsByMake };
  }

  /** Does a candidate already have a row, under any spelling that row answers to? */
  existsAlready(keys, canonicalMake, model) {
    return phraseVariants(model).some((p) => keys.has(`${canonicalMake}|${p}`));
  }

  /**
   * Pull model references out of one product's vehicle-axis variants.
   *
   * The make almost never appears in the label itself ("X5 M 4.4L (2019 →) – G05")
   * — it lives in the product NAME ("BMC Air Filter for BMW"). So the make is
   * resolved from the name first, and only falls back to the label for the case
   * where the label carries it ("Ford Fiesta,Classic,...").
   */
  collectFromVariants(product) {
    const found = [];
    const nameMake = detectMake(product.name);

    for (const variant of product.variants || []) {
      if (!isVehicleAxis(variant.attributes)) continue;
      const { models, chassis } = splitCompoundLabel(variant.label);

      for (const segment of models) {
        const cleaned = cleanModelLabel(segment);
        if (!cleaned) continue;

        // The label may lead with its own make ("Ford Fiesta"); strip it so the
        // model is stored bare and "Ford Ford Fiesta" cannot be produced.
        const segMake = detectMake(cleaned);
        let model = cleaned;
        if (segMake) {
          for (const spelling of phraseVariants(segMake)) {
            model = model.replace(new RegExp(`^${spelling}\\s+`, 'i'), '').trim();
          }
        }
        if (!model) continue;

        // Curation, applied before the model is recorded so the dedupe key, the
        // already-exists check and the created row all see ONE spelling.
        const lookup = model.toLowerCase();
        if (MODEL_DENYLIST.has(lookup)) continue;
        model = MODEL_CORRECTIONS[lookup] || titleCaseModel(model);

        found.push({
          make: nameMake || segMake,
          model,
          kind: looksLikeChassisCode(model) ? 'chassis-code' : 'consumer-model',
          evidence: variant.label,
        });
      }

      // Chassis segments sit AFTER the en-dash — the position manufacturers use.
      // Recorded so a human can see them, never promoted to a consumer model.
      for (const segment of chassis) {
        const cleaned = cleanModelLabel(segment);
        if (!cleaned) continue;
        found.push({
          make: nameMake,
          model: cleaned,
          kind: 'chassis-code',
          evidence: variant.label,
        });
      }
    }
    return found;
  }

  /**
   * Makes the catalogue clearly sells for, counted against how many rows they have.
   *
   * Deliberately NOT an attempt to parse model names out of free product text.
   * That is what the backfill's `WATCH_MISSING_MODELS`/`unmatchedMentions` already
   * does, and doing it worse here would fill the report with noise. A make with 20
   * products and 0 rows is an unambiguous signal on its own; the sample names tell
   * a human which models to add.
   */
  buildMakeGaps(products, rowsByMake) {
    const byMake = new Map();
    for (const p of products) {
      const haystack = String(p.name || '').toLowerCase();
      for (const make of KNOWN_MAKES) {
        if (!phraseVariants(make).some((v) => tokenMatch(haystack, v))) continue;
        if (!byMake.has(make)) byMake.set(make, { products: 0, samples: [] });
        const entry = byMake.get(make);
        entry.products += 1;
        if (entry.samples.length < 5) entry.samples.push(p.name);
      }
    }

    return [...byMake.entries()]
      .map(([make, e]) => ({
        make: makeDisplayName(make),
        productsMentioning: e.products,
        vehicleRows: rowsByMake.get(make) || 0,
        samples: e.samples,
      }))
      .filter((m) => m.vehicleRows === 0 || m.productsMentioning >= m.vehicleRows * 10)
      .sort((a, b) => b.productsMentioning - a.productsMentioning);
  }

  async run() {
    console.log(`\n=== Vehicle Candidate Audit (${this.report.mode}) ===\n`);
    const { keys, displayByMake, rowsByMake } = await this.loadExisting();
    console.log(`Existing vehicles: ${this.report.counts.existingVehicles}`);

    const products = await Product.find({ isActive: true })
      .select('_id name productType variants.label variants.attributes')
      .lean();
    this.report.counts.activeProducts = products.length;
    console.log(`Products: ${products.length} active\n`);

    // key -> aggregate
    const candidates = new Map();
    for (const product of products) {
      try {
        const found = this.collectFromVariants(product);
        if (found.length) this.report.counts.vehicleAxisProducts += 1;

        for (const f of found) {
          if (!f.make) {
            this.report.skipped.noMake.push({ model: f.model, product: product.name, evidence: f.evidence });
            continue;
          }
          // Dedupe on a PUNCTUATION-FREE key. The raw lowercase model treats
          // "BRV"/"BR-V" and "MU 7"/"MU-7" as different cars, so one run proposed
          // both spellings as separate rows — the same duplicate the alias check
          // prevents against EXISTING rows, but within this run's own candidates.
          // The first spelling seen supplies the display form.
          const key = `${f.make}|${f.model.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
          if (!candidates.has(key)) {
            candidates.set(key, {
              make: displayByMake.get(f.make) || makeDisplayName(f.make),
              canonicalMake: f.make,
              model: f.model,
              kind: f.kind,
              productCount: 0,
              products: [],
              evidence: new Set(),
            });
          }
          const c = candidates.get(key);
          c.productCount += 1;
          if (c.products.length < 5) c.products.push(product.name);
          c.evidence.add(f.evidence);
          // Any consumer-model sighting outranks a chassis-code one: the same
          // string can appear in both positions across different labels.
          if (f.kind === 'consumer-model') c.kind = 'consumer-model';
        }
      } catch (err) {
        this.report.errors.push({ id: product._id?.toString(), name: product.name, error: err.message });
      }
    }

    // Partition into create / skip.
    const eligible = [];
    for (const [key, c] of candidates) {
      const row = {
        make: c.make,
        model: c.model,
        slug: vehicleSlug(c.make, c.model),
        kind: c.kind,
        productCount: c.productCount,
        products: c.products,
        evidence: [...c.evidence].slice(0, 3),
      };
      this.report.counts.candidatesFound += 1;

      if (this.existsAlready(keys, c.canonicalMake, c.model)) {
        this.report.skipped.alreadyExists.push(row);
      } else if (c.kind === 'chassis-code' && !this.includeChassis) {
        this.report.skipped.chassisCode.push(row);
      } else if (c.productCount < this.minProducts) {
        this.report.skipped.belowThreshold.push(row);
      } else {
        eligible.push(row);
      }
    }

    // Force-included cars the threshold would drop. Skipped when a row already
    // exists, so re-running cannot duplicate them.
    for (const [canonicalMake, model] of ALWAYS_INCLUDE) {
      if (this.existsAlready(keys, canonicalMake, model)) continue;
      if (eligible.some((r) => r.make.toLowerCase() === canonicalMake && r.model === model)) continue;
      const make = displayByMake.get(canonicalMake) || makeDisplayName(canonicalMake);
      eligible.push({
        make,
        model,
        slug: vehicleSlug(make, model),
        kind: 'consumer-model',
        productCount: 0,
        products: [],
        evidence: ['curated: threshold drops it, but the catalogue sells for it'],
        curated: true,
      });
    }

    eligible.sort((a, b) => b.productCount - a.productCount || a.make.localeCompare(b.make));
    this.report.candidates = eligible;
    this.report.counts.wouldCreate = eligible.length;
    this.report.makeGaps = this.buildMakeGaps(products, rowsByMake);

    if (this.apply) await this.createRows(eligible);

    this.printSummary();
    this.saveReport();
    return this.report;
  }

  async createRows(rows) {
    for (const row of rows) {
      try {
        // Idempotent on the unique slug, so a re-run after a partial failure cannot
        // throw a duplicate-key error or create a second row for one vehicle.
        const res = await Vehicle.updateOne(
          { slug: row.slug },
          { $setOnInsert: { make: row.make, model: row.model, slug: row.slug, isActive: true } },
          { upsert: true }
        );
        if (res.upsertedCount) this.report.counts.created += 1;
      } catch (err) {
        this.report.errors.push({ slug: row.slug, error: err.message });
      }
    }
  }

  printSummary() {
    const c = this.report.counts;
    console.log('=== Summary ===');
    console.log(`  Products with a vehicle-axis variant: ${c.vehicleAxisProducts}`);
    console.log(`  Distinct make+model candidates:       ${c.candidatesFound}`);
    console.log(`  Already have a Vehicle row:           ${this.report.skipped.alreadyExists.length}`);
    console.log(`  Skipped as chassis codes:             ${this.report.skipped.chassisCode.length}`);
    console.log(`  Skipped below --min-products=${this.minProducts}:        ${this.report.skipped.belowThreshold.length}`);
    console.log(`  Skipped, no make resolvable:          ${this.report.skipped.noMake.length}`);
    console.log(`  ${this.apply ? 'CREATED' : 'WOULD CREATE'}:                         ${this.apply ? c.created : c.wouldCreate}`);

    if (this.report.candidates.length) {
      console.log(`\n${this.apply ? 'Created' : 'Would create'} these Vehicle rows (each becomes a PUBLIC page):`);
      for (const r of this.report.candidates) {
        // The public route is /vehicles/{make}/{model} from the two fields, NOT a
        // split of the slug: slug.replace('-', '/') hits the FIRST hyphen and
        // rendered "Land Rover Range Rover Velar" as /vehicles/land/rover-range-...
        const url = `/vehicles/${encodeURIComponent(r.make)}/${encodeURIComponent(r.model)}`;
        console.log(`  ${String(r.productCount).padStart(3)} product(s)  ${r.make} ${r.model}   ${url}`);
        console.log(`       from: ${r.evidence[0]?.slice(0, 72) || ''}`);
      }
    }

    if (this.report.skipped.chassisCode.length) {
      console.log('\nChassis codes (need --include-chassis-codes; usually you want the consumer name instead):');
      this.report.skipped.chassisCode.slice(0, 12).forEach((r) =>
        console.log(`  ${r.make} ${r.model}  (${r.productCount})`));
    }

    if (this.report.makeGaps.length) {
      console.log('\nMakes the catalogue sells for, vs rows they have:');
      this.report.makeGaps.forEach((m) =>
        console.log(`  ${m.make.padEnd(16)} ${String(m.productsMentioning).padStart(3)} product(s), ${m.vehicleRows} row(s)` +
          (m.vehicleRows === 0 ? '   ⚠ UNREACHABLE by the vehicle filter' : '')));
    }

    if (!this.apply) {
      console.log('\nDRY RUN — nothing written. Review the list above, then re-run with --apply.');
      console.log('⚠ Every row created becomes a public /vehicles page and a sitemap entry.');
    }
  }

  saveReport() {
    const dir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `vehicle-candidates-${this.report.mode.toLowerCase()}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(this.report, null, 2));
    console.log(`\n✓ Report written to: ${file}`);
  }
}

(async () => {
  const audit = new VehicleCandidateAudit({ apply, includeChassis, minProducts });
  try {
    await audit.connect();
    await audit.run();
  } catch (err) {
    console.error('✗ Audit failed:', err);
    process.exitCode = 1;
  } finally {
    await audit.disconnect();
  }
})();

/**
 * Compare every Mongoose schema's declared indexes against what actually exists
 * in the connected database, and report the difference.
 *
 * WHY THIS EXISTS
 * ---------------
 * `autoIndex` is off in production (config/db.js — deliberately, so a deploy can
 * never kick off a foreground index build on a large collection). The tradeoff is
 * that schema index changes are NEVER applied automatically, and nothing was
 * checking. Production drifted for months and it cost us a live bug:
 *
 *   - `carts` carried two TTL indexes on `recentChanges` (300s) that were not in
 *     the schema. A TTL index over an array of dates expires on the MINIMUM value
 *     and deletes the WHOLE document, so shoppers' carts were being erased.
 *   - `carts.sessionId_1` was still `sparse` where the schema said partial.
 *
 * Worse, scripts/ensure-production-indexes.js could not have caught either:
 * createIndex() throws IndexOptionsConflict (85) when an index exists with
 * different options, and that script treated 85/86 as "already exists" and
 * reported success. It also only ever CREATES, so it is structurally blind to an
 * index that should not be there at all.
 *
 * This script closes both gaps: it reports EXTRA, MISSING and MISMATCHED.
 *
 * Usage:
 *   node scripts/audit-index-drift.js                 # report (exit 1 on drift)
 *   node scripts/audit-index-drift.js --json          # machine-readable
 *   node scripts/audit-index-drift.js --apply         # create missing indexes
 *   node scripts/audit-index-drift.js --apply --allow-drop
 *                                                     # also drop EXTRA indexes
 *
 * --apply never drops anything unless --allow-drop is passed, because an "extra"
 * index may be a deliberate hand-built one. Read the report before dropping.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

dotenv.config();

const ARGS = new Set(process.argv.slice(2));
const APPLY = ARGS.has('--apply');
const ALLOW_DROP = ARGS.has('--allow-drop');
const AS_JSON = ARGS.has('--json');

const MODELS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'models');

/** Indexes Mongo maintains itself; never report these. */
const IMPLICIT = new Set(['_id_']);

/**
 * Load every model module so mongoose.models is populated.
 * @returns {Promise<void>}
 */
async function loadModels() {
  const entries = readdirSync(MODELS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    await import(pathToFileURL(path.join(MODELS_DIR, entry.name)).href);
  }
}

/**
 * Canonical form of an index key so ordering differences are not false drift.
 *
 * Text indexes need special handling. A schema declares
 * `{ name: 'text', tags: 'text' }`, but MongoDB reports the built index as
 * `{ _fts: 'text', _ftsx: 1 }` with the real fields moved into `weights`.
 * Compared naively the two never match, so every text index shows up as BOTH
 * missing and extra — which would make this script exit 1 forever AND make
 * `--apply --allow-drop` delete live text indexes. Collapse both forms to a
 * single `text:<fields>` signature instead.
 */
function keySignature(key, weights) {
  const isText = Object.values(key).includes('text') || key._fts === 'text';
  if (isText) {
    const fields = key._fts
      ? Object.keys(weights || {}).sort()
      : Object.entries(key).filter(([, d]) => d === 'text').map(([f]) => f).sort();
    return `text:${fields.join(',')}`;
  }
  return Object.entries(key).map(([f, d]) => `${f}:${d}`).join(',');
}

/**
 * The option fields that actually change index behaviour. Cosmetic fields
 * (`background`, `v`, `ns`, `name`) are ignored so we don't report noise.
 */
function behaviouralOptions(opts = {}) {
  const out = {};
  // NOTE: `name` is deliberately NOT compared here — the schema usually omits it
  // while MongoDB always reports one, so comparing would flag every index as
  // drifted. It IS carried separately through `declared`/`missing` so that
  // --apply recreates a named index (e.g. `guest_cart_ttl`) under its intended
  // name; without that it was rebuilt as `updatedAt_1` and the sibling repair
  // scripts that address it by name then failed with IndexOptionsConflict.
  if (opts.unique) out.unique = true;
  if (opts.sparse) out.sparse = true;
  if (opts.expireAfterSeconds != null) out.expireAfterSeconds = opts.expireAfterSeconds;
  if (opts.partialFilterExpression) out.partialFilterExpression = opts.partialFilterExpression;
  // Sort the weight keys. MongoDB returns them in its own order, so an identical
  // text index compared naively reports as drifted forever purely on key order.
  if (opts.weights) {
    out.weights = Object.fromEntries(
      Object.keys(opts.weights).sort().map((k) => [k, opts.weights[k]])
    );
  }
  if (opts.collation) out.collation = { locale: opts.collation.locale, strength: opts.collation.strength };
  return out;
}

const sameOptions = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI (or MONGO_URI) not set');

  await loadModels();
  // autoIndex MUST be false. It defaults to true, and this script imports every
  // model — so connecting would make Mongoose build every declared index against
  // whatever cluster this points at, silently "fixing" the very drift we came to
  // measure (and risking a foreground build on production).
  await mongoose.connect(uri, { autoIndex: false });
  const db = mongoose.connection.db;

  const report = { checked: 0, missing: [], extra: [], mismatched: [], skipped: [] };

  const existingCollections = new Set(
    (await db.listCollections().toArray()).map((c) => c.name)
  );

  for (const modelName of Object.keys(mongoose.models)) {
    const model = mongoose.models[modelName];
    const collName = model.collection.collectionName;

    if (!existingCollections.has(collName)) {
      report.skipped.push({ model: modelName, collection: collName, reason: 'collection does not exist yet' });
      continue;
    }

    report.checked += 1;

    // Schema side.
    const declared = new Map();
    for (const [key, opts] of model.schema.indexes()) {
      declared.set(keySignature(key, opts?.weights), {
        key,
        options: behaviouralOptions(opts),
        name: opts?.name,
      });
    }

    // Live side.
    const live = new Map();
    for (const idx of await db.collection(collName).listIndexes().toArray()) {
      if (IMPLICIT.has(idx.name)) continue;
      live.set(keySignature(idx.key, idx.weights), {
        name: idx.name,
        key: idx.key,
        options: behaviouralOptions(idx),
      });
    }

    for (const [sig, want] of declared) {
      const have = live.get(sig);
      if (!have) {
        report.missing.push({
          collection: collName,
          key: want.key,
          options: want.options,
          name: want.name,
        });
      } else if (!sameOptions(want.options, have.options)) {
        report.mismatched.push({
          collection: collName,
          name: have.name,
          key: want.key,
          schema: want.options,
          database: have.options,
          desiredName: want.name,
        });
      }
    }

    for (const [sig, have] of live) {
      if (!declared.has(sig)) {
        report.extra.push({ collection: collName, name: have.name, key: have.key, options: have.options });
      }
    }
  }

  const driftCount = report.missing.length + report.extra.length + report.mismatched.length;

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n=== Index drift audit — ${report.checked} collections checked ===\n`);

    if (report.mismatched.length) {
      console.log(`MISMATCHED (${report.mismatched.length}) — exists but with different options:`);
      for (const m of report.mismatched) {
        console.log(`  ${m.collection}.${m.name} ${JSON.stringify(m.key)}`);
        console.log(`      schema:   ${JSON.stringify(m.schema)}`);
        console.log(`      database: ${JSON.stringify(m.database)}`);
      }
      console.log('');
    }

    if (report.extra.length) {
      console.log(`EXTRA (${report.extra.length}) — in the database but NOT in any schema:`);
      for (const e of report.extra) {
        const ttl = e.options.expireAfterSeconds != null
          ? `  <-- TTL ${e.options.expireAfterSeconds}s, DELETES DOCUMENTS`
          : '';
        console.log(`  ${e.collection}.${e.name} ${JSON.stringify(e.key)}${ttl}`);
      }
      console.log('');
    }

    if (report.missing.length) {
      console.log(`MISSING (${report.missing.length}) — declared in a schema but absent:`);
      for (const m of report.missing) {
        console.log(`  ${m.collection} ${JSON.stringify(m.key)} ${JSON.stringify(m.options)}`);
      }
      console.log('');
    }

    if (driftCount === 0) console.log('✓ No drift. Schemas and database agree.\n');
  }

  if (APPLY && driftCount > 0) {
    console.log('--- applying ---');

    // Each index is applied INDEPENDENTLY.
    //
    // Previously a single failure threw straight out of the loop, which left the
    // migration half-applied and printed no record of what had already succeeded —
    // the worst possible state to resume from against production. At least one
    // failure is expected and legitimate: MongoDB permits only ONE text index per
    // collection, so creating the schema's `products` text index while the older
    // four-field one is still live is rejected outright. That must not prevent the
    // other 30+ indexes from being created.
    const failures = [];

    for (const m of report.missing) {
      const opts = { ...m.options, background: true };
      if (m.name) opts.name = m.name; // preserve an explicitly-named index
      try {
        await db.collection(m.collection).createIndex(m.key, opts);
        console.log(`  ✓ created ${m.collection} ${JSON.stringify(m.key)}`);
      } catch (err) {
        failures.push({ op: 'create', collection: m.collection, key: m.key, message: err.message });
        console.error(`  ✗ FAILED create ${m.collection} ${JSON.stringify(m.key)} — ${err.message}`);
      }
    }
    for (const m of report.mismatched) {
      const opts = { ...m.schema, background: true };
      if (m.desiredName) opts.name = m.desiredName;
      // Drop and create are paired: if the drop succeeds but the create fails, the
      // collection is left with NO index where it previously had a usable one, so
      // that case is reported loudly rather than counted as a routine failure.
      try {
        await db.collection(m.collection).dropIndex(m.name);
      } catch (err) {
        failures.push({ op: 'drop', collection: m.collection, key: m.key, message: err.message });
        console.error(`  ✗ FAILED drop ${m.collection}.${m.name} — ${err.message}`);
        continue; // nothing was removed, so the old index still serves queries
      }
      try {
        await db.collection(m.collection).createIndex(m.key, opts);
        console.log(`  ✓ rebuilt ${m.collection}.${m.name}`);
      } catch (err) {
        failures.push({ op: 'recreate', collection: m.collection, key: m.key, message: err.message });
        console.error(
          `  ✗✗ CRITICAL: dropped ${m.collection}.${m.name} but could NOT recreate it — ` +
          `that collection is now missing the index entirely. Recreate by hand: ${err.message}`
        );
      }
    }
    if (ALLOW_DROP) {
      for (const e of report.extra) {
        await db.collection(e.collection).dropIndex(e.name);
        console.log(`  ✓ dropped ${e.collection}.${e.name}`);
      }
    } else if (report.extra.length) {
      console.log(`  (${report.extra.length} EXTRA left in place — re-run with --allow-drop to remove)`);
    }

    if (failures.length) {
      console.log(`\n--- ${failures.length} operation(s) FAILED ---`);
      for (const f of failures) {
        console.log(`  ${f.op} ${f.collection} ${JSON.stringify(f.key)}\n      ${f.message}`);
      }
      console.log('\nRe-run after resolving these; createIndex is idempotent, so the');
      console.log('successful ones above will simply be no-ops.\n');
      process.exitCode = 1;
    }
    console.log('');
  }

  await mongoose.disconnect();
  // Non-zero exit so CI or a cron can gate on this.
  process.exit(driftCount > 0 && !APPLY ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\n✗ Index drift audit failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

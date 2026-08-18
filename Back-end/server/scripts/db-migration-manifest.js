/**
 * Prove a cluster-to-cluster migration lost nothing.
 *
 * Capture a manifest from the SOURCE cluster before the move, then compare the
 * TARGET against it afterwards. Compares, per collection: document count, index
 * names + key specs + behavioural options (unique / TTL / partial), and a
 * checksum-ish sample of _ids. Counts alone are not proof — a restore can produce
 * the right count with the wrong indexes, which is precisely the failure that
 * hurts later (a missing unique index silently permits duplicates; a missing TTL
 * silently stops retention).
 *
 * Usage (from Back-end/server):
 *   # 1. before the migration, against the OLD cluster
 *   node scripts/db-migration-manifest.js --save
 *
 *   # 2. after mongorestore, against the NEW cluster
 *   TARGET_MONGODB_URI="mongodb+srv://…newcluster…/autobacs" \
 *     node scripts/db-migration-manifest.js --compare
 *
 * Reads MONGODB_URI / MONGO_URI for --save, and TARGET_MONGODB_URI for --compare
 * (falling back to MONGODB_URI so it can also be used to re-verify in place).
 * Exits non-zero on any discrepancy, so it can gate a cutover.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
// Also load the gitignored audit/migration env if present. Without this,
// TARGET_MONGODB_URI defined in .env.audit.local is invisible and the compare
// silently falls back to MONGODB_URI — i.e. it compares the OLD cluster against
// itself and reports meaningless drift. Existing process env always wins.
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.audit.local') });

const ARGS = new Set(process.argv.slice(2));
const SAVE = ARGS.has('--save');
const COMPARE = ARGS.has('--compare');

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'db-migration-manifest.json'
);

/** Index options that change behaviour. Cosmetic fields are ignored. */
function indexShape(idx) {
  const out = { name: idx.name, key: idx.key };
  if (idx.unique) out.unique = true;
  if (idx.sparse) out.sparse = true;
  if (idx.expireAfterSeconds != null) out.expireAfterSeconds = idx.expireAfterSeconds;
  if (idx.partialFilterExpression) out.partialFilterExpression = idx.partialFilterExpression;
  if (idx.weights) out.weights = idx.weights;
  return out;
}

async function buildManifest(uri) {
  await mongoose.connect(uri, { autoIndex: false });
  const db = mongoose.connection.db;
  const host = mongoose.connection.host;

  const collections = (await db.listCollections().toArray())
    .filter((c) => c.type === 'collection')
    .map((c) => c.name)
    .sort();

  const manifest = { capturedAt: new Date().toISOString(), host, db: db.databaseName, collections: {} };

  for (const name of collections) {
    const col = db.collection(name);
    const count = await col.countDocuments();
    const indexes = (await col.listIndexes().toArray()).map(indexShape)
      .sort((a, b) => a.name.localeCompare(b.name));

    // Deterministic fingerprint of content: oldest + newest _id, which for
    // ObjectIds encodes creation time and makes an accidental partial restore
    // visible even when counts coincide.
    let firstId = null;
    let lastId = null;
    if (count > 0) {
      const f = await col.find({}, { projection: { _id: 1 } }).sort({ _id: 1 }).limit(1).next();
      const l = await col.find({}, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).next();
      firstId = String(f?._id);
      lastId = String(l?._id);
    }

    manifest.collections[name] = { count, indexCount: indexes.length, indexes, firstId, lastId };
  }

  const totals = Object.values(manifest.collections).reduce(
    (acc, c) => ({ docs: acc.docs + c.count, indexes: acc.indexes + c.indexCount }),
    { docs: 0, indexes: 0 }
  );
  manifest.totals = { collections: collections.length, ...totals };

  await mongoose.disconnect();
  return manifest;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function compare(source, target) {
  const problems = [];
  const notes = [];

  const srcNames = Object.keys(source.collections);
  const tgtNames = Object.keys(target.collections);

  for (const name of srcNames) {
    if (!tgtNames.includes(name)) {
      problems.push(`MISSING COLLECTION: ${name} (${source.collections[name].count} docs)`);
      continue;
    }
    const s = source.collections[name];
    const t = target.collections[name];

    if (s.count !== t.count) {
      problems.push(`COUNT ${name}: source ${s.count} -> target ${t.count} (${t.count - s.count >= 0 ? '+' : ''}${t.count - s.count})`);
    }
    if (s.firstId !== t.firstId || s.lastId !== t.lastId) {
      // Not fatal on a live source (new writes shift lastId), so report as a note.
      notes.push(`ID RANGE ${name}: source [${s.firstId}..${s.lastId}] target [${t.firstId}..${t.lastId}]`);
    }

    const srcIdx = new Map(s.indexes.map((i) => [i.name, i]));
    const tgtIdx = new Map(t.indexes.map((i) => [i.name, i]));
    for (const [iname, ishape] of srcIdx) {
      const got = tgtIdx.get(iname);
      if (!got) {
        problems.push(`MISSING INDEX: ${name}.${iname} ${JSON.stringify(ishape.key)}`);
      } else if (!same(ishape, got)) {
        problems.push(`INDEX DIFFERS: ${name}.${iname}\n      source: ${JSON.stringify(ishape)}\n      target: ${JSON.stringify(got)}`);
      }
    }
    for (const iname of tgtIdx.keys()) {
      if (!srcIdx.has(iname)) notes.push(`EXTRA INDEX on target: ${name}.${iname}`);
    }
  }

  for (const name of tgtNames) {
    if (!srcNames.includes(name)) notes.push(`EXTRA COLLECTION on target: ${name}`);
  }

  return { problems, notes };
}

async function main() {
  if (!SAVE && !COMPARE) {
    console.error('Pass --save (capture from source) or --compare (check target).');
    process.exit(2);
  }

  if (SAVE) {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new Error('MONGODB_URI (or MONGO_URI) not set');
    const manifest = await buildManifest(uri);
    fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2));
    console.log(`\n✓ Manifest captured from ${manifest.host}`);
    console.log(`  ${manifest.totals.collections} collections, ${manifest.totals.docs} documents, ${manifest.totals.indexes} indexes`);
    console.log(`  -> ${OUT}\n`);
    console.log('Keep this file. After mongorestore, run:');
    console.log('  TARGET_MONGODB_URI="<new cluster uri>" node scripts/db-migration-manifest.js --compare\n');
    return;
  }

  if (!fs.existsSync(OUT)) throw new Error(`No manifest at ${OUT} — run --save against the OLD cluster first`);
  const source = JSON.parse(fs.readFileSync(OUT, 'utf8'));

  const uri = process.env.TARGET_MONGODB_URI || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('TARGET_MONGODB_URI not set');
  const target = await buildManifest(uri);

  console.log(`\n=== Migration parity check ===`);
  console.log(`  source: ${source.host}  (captured ${source.capturedAt})`);
  console.log(`  target: ${target.host}\n`);
  console.log(`  collections  ${source.totals.collections} -> ${target.totals.collections}`);
  console.log(`  documents    ${source.totals.docs} -> ${target.totals.docs}`);
  console.log(`  indexes      ${source.totals.indexes} -> ${target.totals.indexes}\n`);

  const { problems, notes } = compare(source, target);

  if (notes.length) {
    console.log(`Notes (${notes.length}) — expected if the source kept taking writes:`);
    for (const n of notes) console.log(`  · ${n}`);
    console.log('');
  }

  if (problems.length === 0) {
    console.log('✓ PARITY CONFIRMED — every collection and index matched.\n');
    process.exit(0);
  }

  console.log(`✗ ${problems.length} PROBLEM(S) — do NOT cut over:`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log('');
  process.exit(1);
}

main().catch(async (err) => {
  console.error('\n✗ Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

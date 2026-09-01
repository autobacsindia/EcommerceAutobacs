/**
 * Seed the `search_synonyms` collection that the Atlas Search index reads.
 *
 * Atlas synonym mappings are backed by a real MongoDB collection in the same
 * database, so the mapping declared in config/atlasSearchIndex.js is inert until
 * this collection exists and is populated. Two failure modes that both look like
 * "synonyms just don't work":
 *
 *   - collection missing  → the index build FAILS and the index goes to a non-READY
 *     state, which silently routes every search to the MongoDB fallback
 *   - collection empty    → the index builds fine and every synonym expands to
 *     nothing, with no error anywhere
 *
 * So run this BEFORE applying the index definition, and re-run it whenever
 * ATLAS_SYNONYM_MAPPINGS changes. Changing the collection contents does NOT need
 * an index rebuild — Atlas picks synonym changes up on its own.
 *
 * Source of truth is config/searchSynonyms.js#ATLAS_SYNONYM_MAPPINGS, which
 * deliberately does NOT mirror SYNONYM_GROUPS one-for-one: see the comment there
 * on why bidirectional expansion of the category-ish groups is the "151 results
 * for spoiler" bug.
 *
 * Rollback: this collection is derived and nothing else reads it. To undo, re-run
 * with an earlier ATLAS_SYNONYM_MAPPINGS, or drop the collection and remove the
 * `synonyms` block from the index definition (both are needed — an index that
 * references a missing collection will not build).
 *
 * Usage:
 *   node scripts/seed-search-synonyms.js            # dry run
 *   node scripts/seed-search-synonyms.js --apply    # write
 */
import mongoose from 'mongoose';
import 'dotenv/config';
import { ATLAS_SYNONYM_MAPPINGS } from '../config/searchSynonyms.js';
import { ATLAS_SYNONYM_SOURCE_COLLECTION } from '../config/atlasSearchIndex.js';

const APPLY = process.argv.includes('--apply');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error('MONGODB_URI is not set.');
  process.exit(1);
}

/** Reject a malformed mapping here rather than letting the index build fail on it. */
function validate(mappings) {
  const problems = [];
  mappings.forEach((m, i) => {
    if (m.mappingType === 'equivalent') {
      if (!Array.isArray(m.synonyms) || m.synonyms.length < 2) {
        problems.push(`[${i}] equivalent mapping needs at least 2 synonyms`);
      }
    } else if (m.mappingType === 'explicit') {
      if (!Array.isArray(m.input) || m.input.length === 0) problems.push(`[${i}] explicit mapping needs a non-empty input`);
      if (!Array.isArray(m.synonyms) || m.synonyms.length === 0) problems.push(`[${i}] explicit mapping needs a non-empty synonyms list`);
    } else {
      problems.push(`[${i}] unknown mappingType "${m.mappingType}"`);
    }
  });
  return problems;
}

const problems = validate(ATLAS_SYNONYM_MAPPINGS);
if (problems.length > 0) {
  console.error('❌ Invalid synonym mappings:');
  problems.forEach((p) => console.error('   ' + p));
  process.exit(1);
}

// autoIndex:false is mandatory: it defaults to true, and merely connecting would
// build every declared index against whatever cluster this points at.
await mongoose.connect(uri, { autoIndex: false });
const collection = mongoose.connection.db.collection(ATLAS_SYNONYM_SOURCE_COLLECTION);

const existing = await collection.countDocuments();
const equivalent = ATLAS_SYNONYM_MAPPINGS.filter((m) => m.mappingType === 'equivalent').length;
const explicit = ATLAS_SYNONYM_MAPPINGS.filter((m) => m.mappingType === 'explicit').length;

console.log(`Collection: ${ATLAS_SYNONYM_SOURCE_COLLECTION}`);
console.log(`Existing documents: ${existing}`);
console.log(`Declared mappings:  ${ATLAS_SYNONYM_MAPPINGS.length} (${equivalent} equivalent, ${explicit} explicit)`);
console.log(APPLY ? '\nMode: APPLY (will replace collection contents)\n' : '\nMode: DRY RUN (use --apply to write)\n');

for (const m of ATLAS_SYNONYM_MAPPINGS) {
  console.log(
    m.mappingType === 'explicit'
      ? `  explicit    ${m.input.join(', ')}  →  ${m.synonyms.join(', ')}`
      : `  equivalent  ${m.synonyms.join(' = ')}`
  );
}

if (!APPLY) {
  console.log('\nDry run complete. Nothing was written.');
  await mongoose.disconnect();
  process.exit(0);
}

// Replace wholesale rather than upsert: the declaration is the source of truth, and
// a mapping REMOVED from it must disappear from the collection too. The set is
// tiny (tens of documents), so there is no reason to do this incrementally.
await collection.deleteMany({});
const result = await collection.insertMany(ATLAS_SYNONYM_MAPPINGS.map((m) => ({ ...m })));

console.log(`\n✅ Wrote ${result.insertedCount} synonym mapping(s).`);
console.log('   Atlas picks synonym-collection changes up without an index rebuild.');
console.log('   If the `synonyms` block is NOT yet on the index, run:');
console.log('     npm run audit-atlas-search-index');
console.log('     npm run create-atlas-search-index -- --apply');

await mongoose.disconnect();

/**
 * Create or update the Atlas Search index on the products collection.
 *
 * WHY THIS IS NOT PART OF A DEPLOY
 * --------------------------------
 * `createSearchIndex` NO-OPS when an index of that name already exists. It does
 * not merge, it does not error, it does not warn — the same failure shape that
 * let a corrected Elasticsearch `brand` mapping sit in the repo through several
 * deploys while the live index kept the broken one, silently matching 0 of 44
 * products. So this script distinguishes the two cases explicitly and uses
 * `updateSearchIndex` when the index is already there.
 *
 * Mirrors the house migration convention: dry-run by default, --apply to execute,
 * and a stated rollback path.
 *
 *   node scripts/create-atlas-search-index.js              # show what would change
 *   node scripts/create-atlas-search-index.js --apply      # create or update
 *   railway run npm run create-atlas-search-index -- --apply
 *
 * ROLLBACK
 *   The index is derived data — dropping it costs nothing but a rebuild, and the
 *   storefront falls back to MongoDB while it is gone (slow, but correct):
 *     db.products.dropSearchIndex("<name>")
 *   To roll back the ENGINE rather than the index, set SEARCH_ENGINE=elastic and
 *   restart. That is the faster remedy and needs no database operation at all.
 *
 * NOTE: an index build is asynchronous. The script reports the status it sees;
 * queries return ZERO HITS (not an error) until status is READY, which is exactly
 * why atlasSearchService gates on the status rather than on whether a query threw.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import {
  ATLAS_SEARCH_INDEX_NAME,
  ATLAS_SEARCH_INDEX_DEFINITION,
  diffDefinition,
} from '../config/atlasSearchIndex.js';

dotenv.config();

const apply = process.argv.includes('--apply');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error('❌ MONGODB_URI is not set.');
  process.exit(1);
}

// autoIndex: false is mandatory in any script that imports models. It defaults to
// TRUE, so merely connecting would build every declared schema index against
// whatever cluster this points at — which, with the local .env, is production.
await mongoose.connect(uri, { autoIndex: false });

try {
  const existing = await Product.collection.listSearchIndexes().toArray();
  const live = existing.find((i) => i.name === ATLAS_SEARCH_INDEX_NAME);

  if (!live) {
    console.log(`Index "${ATLAS_SEARCH_INDEX_NAME}" does not exist — it will be CREATED.`);
    if (!apply) {
      console.log('\nDry run. Re-run with --apply to create it.');
    } else {
      await Product.collection.createSearchIndex({
        name: ATLAS_SEARCH_INDEX_NAME,
        definition: ATLAS_SEARCH_INDEX_DEFINITION,
      });
      console.log('✅ Created. The build is asynchronous; poll status with:');
      console.log('   npm run audit-atlas-search-index');
    }
  } else {
    const { ok, drift } = diffDefinition(
      ATLAS_SEARCH_INDEX_DEFINITION.mappings.fields,
      live.latestDefinition?.mappings?.fields || {}
    );

    console.log(`Index "${ATLAS_SEARCH_INDEX_NAME}" exists — status: ${live.status}`);
    if (ok && drift.length === 0) {
      console.log('✅ Live definition already matches the declared one. Nothing to do.');
    } else {
      console.log('\nDrift between declared and live definition:');
      for (const d of drift) {
        console.log(
          `  ${d.issue.toUpperCase().padEnd(9)} ${d.path}` +
            (d.declared ? `  declared=[${d.declared}]` : '') +
            (d.live ? `  live=[${d.live}]` : '')
        );
      }
      if (!apply) {
        console.log('\nDry run. Re-run with --apply to push the declared definition.');
      } else {
        await Product.collection.updateSearchIndex(
          ATLAS_SEARCH_INDEX_NAME,
          ATLAS_SEARCH_INDEX_DEFINITION
        );
        console.log('\n✅ Updated. Atlas rebuilds the index in the background.');
        console.log('   Queries keep serving the OLD definition until the rebuild completes.');
      }
    }
  }
} finally {
  await mongoose.disconnect();
}

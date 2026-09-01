/**
 * Compare the declared Atlas Search index definition against the one the live
 * cluster actually holds, and report the difference.
 *
 * WHY THIS EXISTS
 * ---------------
 * This is the Atlas half of `audit-es-mapping`, and it exists for exactly the
 * same reason: a definition change in the repo does NOT reach the cluster on its
 * own. `createSearchIndex` no-ops on an existing index, so a corrected field type
 * can be merged, reviewed and deployed while the live index keeps the old one.
 *
 * The failure is silent in both directions. An unmapped field matches nothing and
 * facets to nothing — and searchService deliberately TRUSTS a zero-hit answer
 * from a populated index, so there is not even a MongoDB fallback to soften it.
 * It looks precisely like "we don't stock that."
 *
 *   npm run audit-atlas-search-index           # report (exit 1 on drift)
 *   npm run audit-atlas-search-index -- --json
 *   railway run npm run audit-atlas-search-index
 *
 * Remedy when it reports drift:
 *   railway run npm run create-atlas-search-index -- --apply
 *   railway run npm run flush-cache    # cached list/facet responses predate the fix
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import {
  ATLAS_SEARCH_INDEX_NAME,
  ATLAS_SEARCH_INDEX_DEFINITION,
  diffDefinition,
  diffSynonyms,
} from '../config/atlasSearchIndex.js';

dotenv.config();

const json = process.argv.includes('--json');

const report = (payload, exitCode) => {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else if (payload.error) {
    console.error(`❌ ${payload.error}`);
  }
  process.exit(exitCode);
};

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) report({ ok: false, error: 'MONGODB_URI is not set.' }, 1);

// See create-atlas-search-index.js: autoIndex defaults to true and would build
// every schema index against whatever cluster this connects to.
await mongoose.connect(uri, { autoIndex: false });

try {
  let live;
  try {
    const indexes = await Product.collection.listSearchIndexes().toArray();
    live = indexes.find((i) => i.name === ATLAS_SEARCH_INDEX_NAME);
  } catch (error) {
    report(
      {
        ok: false,
        error:
          'listSearchIndexes is unsupported on this deployment — Atlas Search is not ' +
          'available here. To audit production, run this through `railway run`.',
      },
      1
    );
  }

  if (!live) {
    report(
      { ok: false, indexExists: false, error: `Index "${ATLAS_SEARCH_INDEX_NAME}" does not exist. Create it with: npm run create-atlas-search-index -- --apply` },
      1
    );
  }

  const fieldDiff = diffDefinition(
    ATLAS_SEARCH_INDEX_DEFINITION.mappings.fields,
    live.latestDefinition?.mappings?.fields || {}
  );

  // Synonyms live at the TOP level of the definition, not under mappings.fields, so
  // diffDefinition cannot see them. Without this the audit would report a clean
  // index while every synonym silently did nothing — the Elasticsearch
  // brand-mapping failure repeated exactly.
  const synonymDiff = diffSynonyms(
    ATLAS_SEARCH_INDEX_DEFINITION.synonyms || [],
    live.latestDefinition?.synonyms || []
  );

  const ok = fieldDiff.ok && synonymDiff.ok;
  const drift = [...fieldDiff.drift, ...synonymDiff.drift];

  // A non-READY index answers queries with zero hits rather than an error, so it
  // is reported as loudly as a drifted definition.
  const ready = live.status === 'READY';
  const healthy = ok && ready;

  if (json) {
    report({ ok: healthy, indexExists: true, status: live.status, drift }, healthy ? 0 : 1);
  }

  console.log(`Index:  ${ATLAS_SEARCH_INDEX_NAME}`);
  console.log(`Status: ${live.status}${ready ? '' : '  ⚠ queries return ZERO HITS until READY'}`);

  if (drift.length === 0) {
    console.log('✅ Live definition matches the declared one.');
  } else {
    console.log('\nDrift:');
    for (const d of drift) {
      console.log(
        `  ${d.issue.toUpperCase().padEnd(9)} ${d.path}` +
          (d.declared ? `  declared=[${d.declared}]` : '') +
          (d.live ? `  live=[${d.live}]` : '')
      );
    }
    console.log('\nRemedy: railway run npm run create-atlas-search-index -- --apply');
  }

  process.exit(healthy ? 0 : 1);
} finally {
  await mongoose.disconnect();
}

/**
 * Compare the declared Elasticsearch mapping against the one the live cluster
 * actually holds, and report the difference.
 *
 * WHY THIS EXISTS
 * ---------------
 * `createIndex()` only applies PRODUCT_INDEX_MAPPING when the index does not
 * exist. Elasticsearch cannot change a field's type in place, so correcting the
 * mapping in code does nothing to a live index — the change lands only on the
 * next recreateIndex() + reindex. Nothing was checking, and it cost us the whole
 * brand filter:
 *
 *   - `brand` was created as a bare `keyword`. The code was later corrected to
 *     text + `fields.keyword`, merged, and deployed — and the live index kept the
 *     old shape. `brand.keyword` therefore did not exist, so `?brand=Auxbeam`
 *     matched 0 of 44 products and the brand facet returned 0 buckets across all
 *     930. Elasticsearch reports no error for either: an unmapped field matches
 *     nothing and aggregates to nothing, and SearchService deliberately TRUSTS a
 *     zero from a populated index, so there was not even a Mongo fallback to
 *     soften it. It looked exactly like "we don't stock that brand".
 *
 * This is the Elasticsearch half of `audit-index-drift`, which does the same job
 * for Mongo indexes under `autoIndex: false`. tests/elasticsearchMappingDrift.test.js
 * guards the complementary case (a query naming a field the mapping never
 * declared) but only ever sees code, never the cluster.
 *
 * There is no `--apply`: the only remedy is a full rebuild, which is a separate,
 * deliberate operation with its own downtime characteristics.
 *
 *   npm run audit-es-mapping          # report (exit 1 on drift)
 *   npm run audit-es-mapping -- --json
 *
 * Remedy when it reports drift:
 *   railway run npm run reindex-products   # drops, recreates, reindexes from Mongo
 *   railway run npm run flush-cache        # cached list/facet responses predate the fix
 */
import dotenv from 'dotenv';
import elasticsearchService from '../services/elasticsearchService.js';

dotenv.config();

const json = process.argv.includes('--json');

const fail = (message) => {
  if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error(`❌ ${message}`);
  process.exit(1);
};

if (!elasticsearchService.enabled) {
  fail('Elasticsearch is disabled (ELASTICSEARCH_ENABLED is not "true") — nothing to audit. ' +
       'To audit production, run this through `railway run`.');
}

if (!(await elasticsearchService.isConnected())) {
  fail('Elasticsearch is unreachable — cannot read the live mapping.');
}

const { ok, indexExists, drift } = await elasticsearchService.verifyMapping();

if (json) {
  console.log(JSON.stringify({ ok, indexExists, drift }, null, 2));
  process.exit(ok ? 0 : 1);
}

if (!indexExists) {
  fail(`Index "${elasticsearchService.indexName}" does not exist. Run reindex-products to build it.`);
}

if (ok) {
  console.log(`✅ Live mapping for "${elasticsearchService.indexName}" matches the declared mapping.`);
  process.exit(0);
}

console.error(`❌ Mapping drift in "${elasticsearchService.indexName}" — ${drift.length} field(s):\n`);
for (const d of drift) {
  console.error(`  ${d.path}`);
  console.error(`      declared: ${d.declared}`);
  console.error(`      live:     ${d.live}   (${d.issue})`);
}
console.error(
  '\nEvery filter or facet resolving against one of these silently matches nothing.\n' +
  'Remedy:  railway run npm run reindex-products   (drop + recreate + reindex from Mongo)\n' +
  '  then:  railway run npm run flush-cache        (cached responses predate the fix)\n'
);
process.exit(1);

/**
 * Run real queries through the Atlas Search adapter against a live cluster.
 *
 * WHY THIS EXISTS
 * ---------------
 * The query builders are pure functions, so unit tests can assert their output
 * in full detail and still be asserting a shape Atlas rejects. That is not
 * hypothetical — it shipped: every clause carried `score` as a SIBLING of its
 * operator instead of inside it, Atlas answered
 *
 *   "compound.should[0]" unrecognized field "score"
 *
 * on every single query, and searchService dutifully caught the error and served
 * the MongoDB fallback. The storefront looked completely normal while every
 * search ran a full collection scan.
 *
 * That is the failure this script closes: only a real cluster can tell you the
 * query PARSES. Run it before flipping SEARCH_ENGINE, and after any change to
 * the query builders.
 *
 *   node scripts/verify-atlas-search.js
 *   railway run npm run verify-atlas-search
 *
 * Read-only: it issues $search aggregations and writes nothing. Exits non-zero if
 * any query errors, so it can gate a deploy.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import atlasSearchService from '../services/atlasSearchService.js';

dotenv.config();

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error('❌ MONGODB_URI is not set.');
  process.exit(1);
}

// autoIndex defaults to true and would build every schema index against
// whatever cluster this points at — which, with the local .env, is production.
await mongoose.connect(uri, { autoIndex: false });

// Each case pins a distinct lane of the query builder, so a failure says WHICH
// part of the query Atlas rejected rather than just "search is broken".
const CASES = [
  { label: 'browse all (filters only)', params: {} },
  { label: 'single token', params: { q: 'spoiler' } },
  { label: 'multi token precision', params: { q: 'tailgate spoiler hilux' } },
  { label: 'vehicle recall (ObjectId lane)', params: { q: 'hilux' } },
  { label: 'brand filter (token normalizer)', params: { brand: 'Auxbeam' } },
  { label: 'price range + sort asc', params: { minPrice: 1000, maxPrice: 5000, sortBy: 'price', order: 'asc' } },
  { label: 'sort by price asc, no query', params: { sortBy: 'price', order: 'asc' } },
  { label: 'in-stock only', params: { inStock: 'true' } },
  { label: 'rating floor', params: { rating: '4' } },
  { label: 'no results', params: { q: 'zzzznonexistentproduct' } },
  { label: 'suggestions (autocomplete)', suggest: 'brak' },
];

let failures = 0;

const ready = await atlasSearchService.isConnected();
console.log(`Atlas Search index reachable: ${ready ? '✅ yes' : '❌ NO'}`);
if (!ready) {
  console.error('   Queries below would all fall back to MongoDB.');
  failures += 1;
}

for (const testCase of CASES) {
  const label = testCase.label.padEnd(34);
  try {
    if (testCase.suggest) {
      const result = await atlasSearchService.getSearchSuggestions(testCase.suggest, 5);
      const kinds = result.suggestions.map((s) => s.type).join(',');
      console.log(`✅ ${label} ${result.suggestions.length} suggestions [${kinds}]`);
      continue;
    }

    const result = await atlasSearchService.searchProducts(testCase.params);
    const first = result.products[0];
    const prices = result.products.slice(0, 3).map((p) => p.price).join(', ');
    console.log(
      `✅ ${label} total=${String(result.pagination.total).padEnd(5)} ` +
        `facets(b/c/v)=${result.facets.brands.length}/${result.facets.categories.length}/${result.facets.vehicleTypes.length} ` +
        `| ${(first?.name || '(none)').slice(0, 34)}${prices ? ` | ${prices}` : ''}`
    );
  } catch (error) {
    failures += 1;
    console.error(`❌ ${label} ${error.message}`);
  }
}

await mongoose.disconnect();

if (failures > 0) {
  console.error(`\n❌ ${failures} check(s) failed — do NOT flip SEARCH_ENGINE to atlas.`);
  process.exit(1);
}
console.log('\n✅ All queries parsed and returned. Atlas Search is serving correctly.');

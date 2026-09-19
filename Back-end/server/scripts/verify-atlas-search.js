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
  // The CONSTRAINED fitment lane: a vehicle word buried in a longer query builds a
  // nested compound (`must: [in, compound]`) inside the recall `should`. That shape
  // is new as of 2026-09-16 and is not exercised by the plain vehicle case above —
  // and Atlas rejecting it would be invisible, since searchService would quietly
  // serve the MongoDB fallback.
  { label: 'vehicle + part (constrained lane)', params: { q: 'hilux roof rails' } },
  { label: 'vehicle words only (bare fitment)', params: { q: 'hilux fortuner' } },
  { label: 'brand filter (token normalizer)', params: { brand: 'Auxbeam' } },
  { label: 'price range + sort asc', params: { minPrice: 1000, maxPrice: 5000, sortBy: 'price', order: 'asc' } },
  { label: 'sort by price asc, no query', params: { sortBy: 'price', order: 'asc' } },
  { label: 'in-stock only', params: { inStock: 'true' } },
  { label: 'rating floor', params: { rating: '4' } },
  { label: 'no results', params: { q: 'zzzznonexistentproduct' } },
  // Filters that were SILENTLY DROPPED by buildFilters until 2026-09-01: the query
  // parsed fine and returned the whole catalogue, so only a count assertion catches
  // it. `expectFewerThan` exists for exactly this class of bug.
  { label: 'isFeatured filter', params: { isFeatured: 'true' }, expectFewerThan: 100 },
  { label: 'productType filter', params: { productType: 'variable' }, expectFewerThan: 900 },
  // Relaxation: one real token, one nonsense token. Strict recall requires both, so
  // this returns nothing until the retry widens it.
  { label: 'zero-result relaxation', params: { q: 'spoiler zzzqqx' }, expectRelaxed: true },
  // The results path is where corrections are computed and where the search page
  // now reads them. Asserting the VALUE, not just presence: an empty-but-present
  // array is exactly how this feature was broken before.
  { label: 'did-you-mean probe', params: { q: 'wnich' }, expectCorrection: 'winch' },
  { label: 'sort by best selling', params: { sortBy: 'salesScore', order: 'desc' } },
  { label: 'explicit relevance sort', params: { q: 'winch', sortBy: 'relevance' } },
  { label: 'facets: data-derived price', facets: {} },
  { label: 'facets: disjunctive brand', facets: { brand: 'Auxbeam' } },
  // ⚠ The facet cases above assert only that the pipeline PARSED and produced a
  // non-degenerate price scale. Both passed happily while the sidebar counted the
  // entire catalogue on every search — 930 beside a 7-result grid — because a
  // facet query with no recall lanes parses perfectly. `matchesGrid` is what makes
  // these cases able to fail: it compares the sidebar total against the results
  // grid for the SAME params, which is the only assertion the 930 bug could not
  // have survived.
  { label: 'facets: honour the search term', facets: { q: 'winch' }, matchesGrid: true },
  { label: 'facets: multi-token search term', facets: { q: 'bmw steering wheel' }, matchesGrid: true },
  { label: 'facets: search + filter', facets: { q: 'spoiler', inStock: 'true' }, matchesGrid: true },
  { label: 'facets: vehicle filter reaches counts', facets: { vehicleMake: 'Toyota' }, matchesGrid: true },
  // ⚠ `matchesGrid` compares TOTALS, and both of the 2026-09-18 vehicle bugs lived
  // where the totals already agreed. These two carry the assertions that catch them.
  //
  // `makeCountsMatchGrid`: the make facet counted fitment SLOTS, so a product
  // fitting three BMW models counted three times — "BMW (59)" beside a grid of 39.
  // The sidebar total was right the whole time; only the per-make number lied.
  { label: 'facets: make counts are distinct products', facets: { q: 'bmw' },
    matchesGrid: true, makeCountsMatchGrid: ['BMW'] },
  { label: 'facets: make counts, unfiltered catalogue', facets: {},
    makeCountsMatchGrid: ['Toyota', 'Ford', 'Mahindra'] },
  // Lowercase: the vehicle index is keyed on lowercase so the GRID filters fine,
  // which is exactly why an exact-match comparison in the facet shaper went
  // unnoticed — it only emptied the model dropdown, never the results.
  { label: 'facets: lowercase make still scopes', facets: { vehicleMake: 'toyota' },
    matchesGrid: true, expectModelsScopedTo: 'Toyota' },
  // `expectEmpty`: an unresolvable vehicle filter must match NOTHING. It expressed
  // that as `mustNot: [{ exists: { path: '_id' } }]`, and `_id` is unmapped under
  // `dynamic: false`, so the clause matched nothing, mustNot excluded nothing, and
  // prod served all 928 products. It parses perfectly — only a count can catch it.
  { label: 'unknown make matches nothing', params: { vehicleMake: 'Ferrari' }, expectEmpty: true },
  { label: 'impossible make+model matches nothing',
    params: { vehicleMake: 'BMW', vehicleModel: 'Fortuner' }, expectEmpty: true },
  { label: 'suggestions (autocomplete)', suggest: 'brak' },
];

let failures = 0;

// ⚠ The facet cases call SearchService.getFacets, which dispatches on SEARCH_ENGINE
// rather than on whether Atlas is reachable. Unset, it answers from getMongoFacets —
// a different contract with no `total` — so the matchesGrid comparisons below would
// report "sidebar says null, grid says 42" and look exactly like the bug they exist
// to catch. Warn loudly rather than fail: the non-facet cases above still carry
// their full value, and this script's primary job is proving the query PARSES.
if (process.env.SEARCH_ENGINE !== 'atlas') {
  console.warn(
    `⚠  SEARCH_ENGINE is "${process.env.SEARCH_ENGINE ?? '(unset)'}" — the facet cases below go\n` +
    '   through the MongoDB fallback and their counts mean nothing. Re-run with\n' +
    '   SEARCH_ENGINE=atlas (the value production uses) to exercise them properly.\n'
  );
}

const ready = await atlasSearchService.isConnected();
console.log(`Atlas Search index reachable: ${ready ? '✅ yes' : '❌ NO'}`);
if (!ready) {
  console.error('   Queries below would all fall back to MongoDB.');
  failures += 1;
}

for (const testCase of CASES) {
  const label = testCase.label.padEnd(34);
  try {
    if (testCase.facets) {
      const { default: SearchService } = await import('../services/searchService.js');
      const f = await SearchService.getFacets(testCase.facets);
      // The price facet was calibrated in USD against an INR catalogue, putting
      // ALL 931 products in one bucket. A degenerate range or a single bucket means
      // it has regressed to carrying no information again.
      // Sidebar total vs results grid for identical params. They are two endpoints
      // built from two call sites, and this is the only check that notices when one
      // of them stops listening to the query.
      if (testCase.matchesGrid && process.env.SEARCH_ENGINE === 'atlas') {
        const grid = await atlasSearchService.searchProducts({ ...testCase.facets, limit: 1 });
        const gridTotal = grid.pagination.total;
        if (f.total !== gridTotal) {
          failures += 1;
          console.error(
            `❌ ${label} sidebar says ${f.total}, grid says ${gridTotal} — the facet query is ` +
            'ignoring part of the request (this is the "930 products" bug)'
          );
          continue;
        }
      }

      // Every offered model must belong to the selected make, or the pair a shopper
      // can assemble from this panel is impossible.
      if (testCase.expectModelsScopedTo && process.env.SEARCH_ENGINE === 'atlas') {
        const stray = f.vehicleModels.filter((m) => m.make !== testCase.expectModelsScopedTo);
        if (f.vehicleModels.length === 0 || stray.length > 0) {
          failures += 1;
          console.error(
            `❌ ${label} models not scoped to ${testCase.expectModelsScopedTo}: ` +
            `${f.vehicleModels.length} offered, ${stray.length} from other makes`
          );
          continue;
        }
      }

      // Per-make counts vs the grid you actually land on by picking that make.
      // Distinct from matchesGrid above, which only compares the sidebar TOTAL and
      // was green throughout the life of the inflated-make bug.
      if (testCase.makeCountsMatchGrid && process.env.SEARCH_ENGINE === 'atlas') {
        let mismatched = false;
        for (const make of testCase.makeCountsMatchGrid) {
          const shown = f.vehicleMakes.find((m) => m.value === make)?.count;
          if (shown === undefined) continue; // make absent from this result set
          const picked = await atlasSearchService.searchProducts({
            ...testCase.facets, vehicleMake: make, limit: 1,
          });
          if (shown !== picked.pagination.total) {
            failures += 1;
            mismatched = true;
            console.error(
              `❌ ${label} facet offers ${make} (${shown}) but picking it returns ` +
              `${picked.pagination.total} — the make count is not distinct products`
            );
          }
        }
        if (mismatched) continue;
      }

      // A degenerate price scale means the facet carries no information — but only
      // when the facet is supposed to span the catalogue. Any narrowing parameter
      // can legitimately reduce the set to a single price point, and the check must
      // not go red on a deploy gate for that.
      //
      // Keyed off `q` alone until 2026-09-16, which was fine only because the
      // vehicle filter was being silently ignored; now that `?vehicle=`/`vehicleMake`
      // actually filter, a narrow vehicle case could produce one bucket and fail.
      const narrow = Object.keys(testCase.facets).length > 0;
      const degenerate = !narrow && (!(f.price.max > f.price.min) || f.price.histogram.length < 2);
      if (degenerate) {
        failures += 1;
        console.error(`❌ ${label} price facet is degenerate: ${f.price.min}-${f.price.max}, ${f.price.histogram.length} buckets`);
      } else {
        console.log(
          `✅ ${label} total=${String(f.total).padEnd(5)} brands=${f.brands.length} ` +
          `price=${f.price.min}-${f.price.max} buckets=${f.price.histogram.length} makes=${f.vehicleMakes.length}`
        );
      }
      continue;
    }

    if (testCase.suggest) {
      const result = await atlasSearchService.getSearchSuggestions(testCase.suggest, 5);
      const kinds = result.suggestions.map((s) => s.type).join(',');
      console.log(`✅ ${label} ${result.suggestions.length} suggestions [${kinds}]`);
      continue;
    }

    const result = await atlasSearchService.searchProducts(testCase.params);
    const first = result.products[0];

    // Assertions that a "the query parsed" check cannot make. A dropped filter
    // still parses — it just answers with the entire catalogue.
    if (testCase.expectFewerThan && result.pagination.total >= testCase.expectFewerThan) {
      failures += 1;
      console.error(`❌ ${label} returned ${result.pagination.total} — filter looks DROPPED`);
      continue;
    }
    if (testCase.expectEmpty && result.pagination.total !== 0) {
      failures += 1;
      console.error(
        `❌ ${label} returned ${result.pagination.total} — an unresolvable vehicle filter ` +
        'was DROPPED instead of matching nothing (check MATCH_NOTHING_PATH is mapped)'
      );
      continue;
    }
    if (testCase.expectRelaxed && !result.relaxed) {
      failures += 1;
      console.error(`❌ ${label} did not relax (total=${result.pagination.total})`);
      continue;
    }
    if (testCase.expectCorrection) {
      const got = (result.corrections || []).map((c) => c.suggested);
      if (!got.includes(testCase.expectCorrection)) {
        failures += 1;
        console.error(`❌ ${label} expected correction "${testCase.expectCorrection}", got ${JSON.stringify(got)}`);
        continue;
      }
    }
    const prices = result.products.slice(0, 3).map((p) => p.price).join(', ');
    console.log(
      // The list response's `facets` block is deprecated and empty by design — the
      // sidebar reads /products/facets, exercised by the dedicated facet cases
      // below. Printing `relaxed` instead surfaces something that is live.
      `✅ ${label} total=${String(result.pagination.total).padEnd(5)} ` +
        `${result.relaxed ? 'relaxed ' : '        '}` +
        `| ${(first?.name || '(none)').slice(0, 40)}${prices ? ` | ${prices}` : ''}`
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

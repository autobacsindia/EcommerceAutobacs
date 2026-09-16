/**
 * Golden-query relevance harness — does search return the RIGHT things?
 *
 * WHY THIS EXISTS
 * ---------------
 * `verify-atlas-search.js` proves a query PARSES on the live cluster. It cannot
 * tell you the answer is any good: "bmw steering wheel" returning 38 results, 31
 * of them for other cars, parses perfectly and reports ✅.
 *
 * Relevance is not something unit tests can hold either — the builders are pure
 * functions with no catalogue behind them. So every change to recall has until
 * now been shipped on the strength of "it looked fine when I tried it", and a
 * regression in a query nobody happened to type stayed invisible.
 *
 * This pins a fixed set of real shopper queries to written-down expectations and
 * fails loudly when one drifts. Run it BEFORE and AFTER any recall change.
 *
 *   node scripts/verify-search-relevance.js
 *   railway run npm run verify-search-relevance
 *
 * Read-only: issues $search aggregations, writes nothing. Exits non-zero on any
 * failure, so it can gate a deploy.
 *
 * ⚠ Counts below are catalogue-dependent. They are deliberately loose ceilings
 * ("no more than"), not exact numbers, so ordinary merchandising does not turn
 * this red. If the catalogue grows a lot, raise a ceiling — but only after
 * checking the extra hits are genuinely relevant.
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

// autoIndex defaults to true and would build every schema index against whatever
// cluster this points at — which, with the local .env, is production.
await mongoose.connect(uri, { autoIndex: false });

/**
 * topMatches   — the FIRST result must match this. Ranking, not just recall.
 * allMatch     — every result on page 1 must match. Catches a leaky result set.
 * maxResults   — ceiling on the total. Catches over-recall.
 * minResults   — floor. Catches over-tightening, the risk this change carries.
 * expectRelaxLevel — which rung the search had to settle on.
 */
const GOLDEN = [
  {
    q: 'bmw steering wheel',
    topMatches: /bmw.*steering|steering.*bmw/i,
    allMatch: /bmw/i,
    maxResults: 12,
    minResults: 1,
    note: 'THE regression case: was 38 results, 31 of them other cars',
  },
  {
    q: 'bmw steering',
    topMatches: /bmw/i,
    allMatch: /bmw/i,
    maxResults: 12,
    minResults: 1,
    note: 'two tokens — was already correct, must stay correct',
  },
  {
    q: 'mercedes steering wheel',
    topMatches: /mercedes/i,
    maxResults: 12,
    minResults: 1,
    note: 'the same shape for a different make — proves it is not a BMW special case',
  },
  {
    q: 'steering wheel',
    topMatches: /steering/i,
    maxResults: 60,
    minResults: 10,
    note: 'the broad category query SHOULD be wide',
  },
  {
    q: 'bmw',
    maxResults: 80,
    minResults: 5,
    note: 'vehicle-only query keeps full fitment recall, including parts not named "BMW"',
  },
  {
    q: 'spoiler',
    topMatches: /spoiler/i,
    maxResults: 120,
    minResults: 5,
    note: 'single broad token — the 2026-07 "151 results" case',
  },
  {
    q: 'tailgate spoiler hilux',
    minResults: 1,
    note: 'the 2026-07 precision case; may relax, but must never be empty',
  },
  {
    q: 'carbon fiber steering wheel',
    allMatch: /steering|carbon/i,
    maxResults: 40,
    minResults: 1,
  },
  {
    q: 'zzzznonexistentproduct',
    maxResults: 0,
    expectRelaxLevel: 0,
    note: 'single-token miss: every rung is identical, so it must cost exactly ONE pass',
  },
  {
    q: 'zzzznonexistent aaaabogus qqqqfake',
    maxResults: 0,
    expectRelaxLevel: 2,
    note: 'multi-token miss: the ladder climbs every rung and still honestly returns nothing',
  },
];

/**
 * Adding a word must never ADD results — AT THE SAME RUNG.
 *
 * This is the bug stated as an invariant. Every extra token is a narrowing
 * instruction, so a superset query can only ever return a subset. Before the fix,
 * "bmw steering wheel" (38) beat "bmw steering" (10) — the ordering was inverted,
 * and that single comparison is the cheapest possible detector.
 *
 * ⚠ The subset relation holds only while both queries answer on the STRICT rung.
 * A longer query that finds nothing strictly falls to rung 2 (any-one-token),
 * which is a legitimate SUPERSET of the shorter query — so comparing totals
 * across different rungs would fail this deploy-gating script for a search that
 * behaved exactly as designed. `tailgate spoiler hilux` is one bad catalogue edit
 * away from exactly that. So a relaxed answer is reported and SKIPPED, never
 * failed: the invariant simply does not apply there.
 */
const MONOTONIC = [
  ['steering wheel', 'bmw steering wheel'],
  ['bmw steering', 'bmw steering wheel'],
  ['steering wheel', 'carbon fiber steering wheel'],
  ['spoiler', 'tailgate spoiler hilux'],
];

let failures = 0;
const fail = (msg) => { failures += 1; console.error(`   ❌ ${msg}`); };

const ready = await atlasSearchService.isConnected();
console.log(`Atlas Search index reachable: ${ready ? '✅ yes' : '❌ NO'}\n`);
if (!ready) {
  console.error('Relevance cannot be judged against the MongoDB fallback — its recall model differs.');
  await mongoose.disconnect();
  process.exit(1);
}

console.log('── Golden queries ' + '─'.repeat(52));

/** Every query measured in this run, reused by the monotonicity section below. */
const measured = new Map();

for (const c of GOLDEN) {
  const result = await atlasSearchService.searchProducts({ q: c.q, limit: 20 });
  const total = result.pagination.total;
  measured.set(c.q, { total, relaxLevel: result.relaxLevel });

  const names = result.products.map((p) => p.name || '');
  const top = names[0] || '(none)';
  const flag = result.relaxed ? ` relaxed(${result.relaxLevel})` : '';

  console.log(`\n"${c.q}" → ${total} results${flag}`);
  if (c.note) console.log(`   ${c.note}`);
  console.log(`   top: ${top.slice(0, 64)}`);

  if (c.maxResults !== undefined && total > c.maxResults) {
    fail(`over-recall: ${total} results, ceiling is ${c.maxResults}`);
    const offenders = names.filter((n) => (c.allMatch ? !c.allMatch.test(n) : false)).slice(0, 5);
    if (offenders.length) console.error(`      e.g. ${offenders.join(' | ').slice(0, 160)}`);
  }
  if (c.minResults !== undefined && total < c.minResults) {
    fail(`over-tightened: ${total} results, floor is ${c.minResults}`);
  }
  if (c.topMatches && !c.topMatches.test(top)) {
    fail(`wrong top result for "${c.q}": ${top}`);
  }
  if (c.allMatch) {
    const bad = names.filter((n) => !c.allMatch.test(n));
    if (bad.length) fail(`${bad.length} of ${names.length} on page 1 fail ${c.allMatch}: ${bad.slice(0, 3).join(' | ').slice(0, 160)}`);
  }
  // A total miss must exhaust the ladder rather than give up early — otherwise a
  // shopper gets an empty grid for a query that had related products available.
  if (c.expectRelaxLevel !== undefined && result.relaxLevel !== c.expectRelaxLevel) {
    fail(`expected the search to end on rung ${c.expectRelaxLevel}, it ended on ${result.relaxLevel}`);
  }
}

console.log('\n── Monotonicity: a longer query cannot return MORE ' + '─'.repeat(19));

const measure = async (q) => {
  if (!measured.has(q)) {
    const r = await atlasSearchService.searchProducts({ q, limit: 1 });
    measured.set(q, { total: r.pagination.total, relaxLevel: r.relaxLevel });
  }
  return measured.get(q);
};

for (const [shorter, longer] of MONOTONIC) {
  const a = await measure(shorter);
  const b = await measure(longer);

  // Only compare like with like. If either side widened, they are answering
  // different questions and the subset relation is not expected to hold.
  if (a.relaxLevel !== b.relaxLevel) {
    console.log(`   ⏭  "${shorter}" (${a.total}, rung ${a.relaxLevel}) vs "${longer}" ` +
      `(${b.total}, rung ${b.relaxLevel}) — different rungs, invariant does not apply`);
    continue;
  }

  const ok = b.total <= a.total;
  console.log(`   ${ok ? '✅' : '❌'} "${shorter}" (${a.total})  ≥  "${longer}" (${b.total})  [rung ${a.relaxLevel}]`);
  if (!ok) fail(`adding a word GREW the result set at the same rung: ${a.total} → ${b.total}. This is the over-recall bug.`);
}

console.log('\n' + '─'.repeat(70));
console.log(failures === 0
  ? '✅ Relevance checks passed.'
  : `❌ ${failures} relevance check(s) failed.`);

await mongoose.disconnect();
process.exit(failures === 0 ? 0 : 1);

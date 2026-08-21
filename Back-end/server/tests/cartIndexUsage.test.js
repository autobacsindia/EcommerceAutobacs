/**
 * Cart index-usage regression test.
 *
 * THE BUG THIS GUARDS
 * -------------------
 * `sessionId_1` / `user_1` are unique PARTIAL indexes scoped with `$type`.
 * MongoDB's planner does not infer that an equality predicate satisfies a
 * `$type` partial filter, so a bare `findOne({ sessionId })` silently discards
 * the index and scans the whole collection. Against production (59,638 carts)
 * that was 59,637 documents examined per cart read, ~31ms, returning 0-1 docs —
 * a 59,638:1 query-targeting ratio on the hottest guest route, and the cause of
 * the Atlas "Scanned Objects / Returned has gone above 1000" alert.
 *
 * Nothing about this is visible in the query result: both forms return the same
 * document. Only the plan differs, so only an explain() assertion can catch a
 * regression — which is why this test reads the winning plan rather than data.
 */

import mongoose from 'mongoose';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import * as dbHandler from './db-handler.js';
import Cart from '../models/Cart.js';
import { sessionCartFilter, userCartFilter } from '../repositories/cartRepository.js';

const SESSION_ID = 'sess-abc-123';
const USER_ID = new mongoose.Types.ObjectId();

/** Name of the index the planner chose, or 'COLLSCAN'. */
function chosenIndex(explain) {
  const plan = JSON.stringify(explain.queryPlanner.winningPlan);
  if (plan.includes('COLLSCAN')) return 'COLLSCAN';
  return (plan.match(/"indexName":"([^"]+)"/) || [])[1] || 'UNKNOWN';
}

beforeAll(async () => {
  await dbHandler.connect();
  // autoIndex is off in production by design, so build them explicitly here —
  // this test is meaningless against a collection with no indexes.
  await Cart.syncIndexes();
});

// The shared afterEach in tests/setup.js empties every collection, so fixtures
// are per-test. Indexes survive deleteMany, so syncIndexes stays in beforeAll.
beforeEach(async () => {
  await Cart.create([
    { sessionId: SESSION_ID, items: [] },
    { sessionId: 'sess-other', items: [] },
    { user: USER_ID, items: [] },
  ]);
});

afterAll(async () => {
  await dbHandler.closeDatabase();
});

describe('cart lookups use their partial indexes', () => {
  it('sessionCartFilter drives an IXSCAN on sessionId_1', async () => {
    const explain = await Cart.findOne(sessionCartFilter(SESSION_ID)).explain('executionStats');
    expect(chosenIndex(explain)).toBe('sessionId_1');
    expect(explain.executionStats.totalDocsExamined).toBeLessThanOrEqual(1);
  });

  it('userCartFilter drives an IXSCAN on user_1', async () => {
    const explain = await Cart.findOne(userCartFilter(USER_ID)).explain('executionStats');
    expect(chosenIndex(explain)).toBe('user_1');
    expect(explain.executionStats.totalDocsExamined).toBeLessThanOrEqual(1);
  });

  it('userCartFilter still works when the id is a string (Mongoose casts it)', async () => {
    const explain = await Cart.findOne(userCartFilter(USER_ID.toString())).explain('executionStats');
    expect(chosenIndex(explain)).toBe('user_1');
  });

  // The counter-example. If MongoDB ever learns to infer `$type` from equality
  // this will fail, and the helpers can be simplified away — that is a useful
  // signal, not a nuisance.
  it('the bare {sessionId} form COLLSCANs — this is why the helper exists', async () => {
    const explain = await Cart.findOne({ sessionId: SESSION_ID }).explain('executionStats');
    expect(chosenIndex(explain)).toBe('COLLSCAN');
  });
});

describe('the filters still select the right cart', () => {
  it('finds the guest cart by session', async () => {
    const cart = await Cart.findOne(sessionCartFilter(SESSION_ID));
    expect(cart.sessionId).toBe(SESSION_ID);
  });

  it('finds the user cart by id', async () => {
    const cart = await Cart.findOne(userCartFilter(USER_ID));
    expect(cart.user.toString()).toBe(USER_ID.toString());
  });

  it('returns null for an unknown session rather than another cart', async () => {
    expect(await Cart.findOne(sessionCartFilter('nope'))).toBeNull();
  });

  // A guest cart must never be reachable through the user filter, and vice
  // versa — the $type clause is what keeps the two owner axes disjoint.
  it('does not match a guest cart through userCartFilter(null)', async () => {
    expect(await Cart.findOne(userCartFilter(null))).toBeNull();
  });

  it('does not match a user cart through sessionCartFilter(null)', async () => {
    expect(await Cart.findOne(sessionCartFilter(null))).toBeNull();
  });
});

// Drift guard: the helpers only protect the call sites that actually use them.
describe('no cart route reintroduces a bare owner filter', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const files = ['../routes/cart.js', '../routes/cartSync.js', '../repositories/cartRepository.js'];

  it.each(files)('%s queries Cart only through the filter helpers', (rel) => {
    const src = readFileSync(path.join(dir, rel), 'utf8');
    // e.g. Cart.findOne({ sessionId }) or Cart.findOne({ user: req.user.id })
    const bare = src.match(/Cart\.(findOne|find|findOneAndUpdate)\(\s*\{\s*(sessionId|user)\b/g);
    expect(bare).toBeNull();
  });
});

/**
 * Autobacs Partner list + lookup queries, measured with explain() — the
 * optimization pass for the supplier API. What the numbers say:
 *   - "my listings" (keyset on updatedAt,_id) rides listing_owner_updated with NO
 *     in-memory sort, and examines only the page (+1), however many listings
 *     other suppliers or this supplier have
 *   - a page deep in the list also examines only its page (the keyset seek)
 *   - the pending price-review lookup is a single index hit on price_review_one_pending
 *   - a status-filtered page examines this owner's rows only (never other suppliers')
 */
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import SupplierListing from '../models/SupplierListing.js';
import SupplierPriceReview from '../models/SupplierPriceReview.js';
import listings from '../repositories/supplierListingRepository.js';

const plan = (e) => JSON.stringify(e.queryPlanner.winningPlan);
const indexOf = (e) => (plan(e).includes('COLLSCAN') ? 'COLLSCAN' : (plan(e).match(/"indexName":"([^"]+)"/) || [])[1]);
const sorts = (e) => plan(e).includes('"SORT"');

const me = new mongoose.Types.ObjectId();
const others = Array.from({ length: 5 }, () => new mongoose.Types.ObjectId());

beforeAll(async () => {
  await dbHandler.connect();
  await Promise.all([SupplierListing.syncIndexes(), SupplierPriceReview.syncIndexes()]);
});
// tests/setup.js clears the database after every test, so each test seeds its own rows.
beforeEach(async () => {
  const row = (owner, i, status) => ({
    supplierAccount: owner, title: `Item ${i}`, costPaise: 1000 + i, gstPct: 18, status, rev: 0, images: [],
    updatedAt: new Date(Date.now() - i * 1000), createdAt: new Date(),
  });
  // 600 mine (1 in 6 live), 2,000 other suppliers'.
  await SupplierListing.collection.insertMany([
    ...Array.from({ length: 600 }, (_, i) => row(me, i, i % 6 === 0 ? 'live' : 'draft')),
    ...others.flatMap((o) => Array.from({ length: 400 }, (_, i) => row(o, i, 'live'))),
  ]);
});
afterAll(async () => { await dbHandler.clearDatabase(); await dbHandler.closeDatabase(); });

const listQuery = (opts) => listings.listOwned(me, opts).explain('executionStats');

it('first page: owner index, no in-memory sort, only the page examined', async () => {
  const e = await listQuery({ limit: 21 });
  expect(indexOf(e)).toBe('listing_owner_updated');
  expect(sorts(e)).toBe(false);
  expect(e.executionStats.totalDocsExamined).toBe(21);
});

it('a deep page seeks with the keyset instead of walking the earlier pages', async () => {
  const [anchor] = await SupplierListing.find({ supplierAccount: me }).sort({ updatedAt: -1, _id: -1 }).skip(500).limit(1).lean();
  const e = await listQuery({ limit: 21, after: { updatedAt: anchor.updatedAt, id: anchor._id } });
  expect(indexOf(e)).toBe('listing_owner_updated');
  expect(sorts(e)).toBe(false);
  expect(e.executionStats.totalDocsExamined).toBeLessThanOrEqual(22);
  expect(e.executionStats.nReturned).toBe(21);
});

it('a status filter stays on the owner index and never reads other suppliers', async () => {
  const e = await listQuery({ status: 'live', limit: 21 });
  expect(indexOf(e)).toBe('listing_owner_updated');
  expect(sorts(e)).toBe(false);
  // 1 in 6 of mine is live → ~6 examined per row returned; bounded by my own rows.
  expect(e.executionStats.totalDocsExamined).toBeLessThanOrEqual(21 * 6 + 6);
});

it('the pending price review is one index hit', async () => {
  const listing = new mongoose.Types.ObjectId();
  await SupplierPriceReview.collection.insertMany(Array.from({ length: 50 }, (_, i) => ({
    listing: i === 0 ? listing : new mongoose.Types.ObjectId(), status: 'pending', product: new mongoose.Types.ObjectId(),
  })));
  const e = await SupplierPriceReview.find({ listing, status: 'pending' }).explain('executionStats');
  expect(indexOf(e)).toBe('price_review_one_pending');
  expect(e.executionStats.totalDocsExamined).toBe(1);
});

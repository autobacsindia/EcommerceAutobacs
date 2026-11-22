/**
 * Autobacs Partner (procurement side) — query budgets, measured.
 *
 *   - the review queues read their status index, never a collection scan, and
 *     examine only the page they return
 *   - a page of price reviews reads the margin rules ONCE, however many
 *     categories the products are in (no read per row)
 *   - the listing detail's "possible duplicates" runs a bounded number of
 *     product reads (the admin product search is a regex scan — run it once)
 */
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import SupplierAccount from '../models/SupplierAccount.js';
import SupplierListing from '../models/SupplierListing.js';
import SupplierPriceReview from '../models/SupplierPriceReview.js';
import MarginRule from '../models/MarginRule.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import repo from '../repositories/supplierPartnerAdminRepository.js';
import { sortSpec, and } from '../utils/listQuery.js';
import * as priceReviews from '../services/procurementPartners/priceReviews.js';
import * as listings from '../services/procurementPartners/listings.js';

const plan = (explain) => JSON.stringify(explain.queryPlanner.winningPlan);
const indexOf = (explain) => (plan(explain).includes('COLLSCAN') ? 'COLLSCAN' : (plan(explain).match(/"indexName":"([^"]+)"/) || [])[1]);
const admin = { _id: new mongoose.Types.ObjectId(), role: 'admin', name: 'Owner' };

/** Counts mongoose operations per collection while `fn` runs. */
async function countQueries(fn) {
  const counts = {};
  mongoose.set('debug', (coll, method) => { const k = `${coll}.${method}`; counts[k] = (counts[k] || 0) + 1; });
  const t = Date.now();
  try { await fn(); } finally { mongoose.set('debug', false); }
  return { counts, ms: Date.now() - t, total: (c) => Object.entries(counts).filter(([k]) => k.startsWith(c)).reduce((s, [, v]) => s + v, 0) };
}

beforeAll(async () => {
  await dbHandler.connect();
  await Promise.all([SupplierAccount.syncIndexes(), SupplierListing.syncIndexes(), SupplierPriceReview.syncIndexes(), Product.syncIndexes()]);
});
afterAll(async () => { await dbHandler.closeDatabase(); });

const account = () => SupplierAccount.create({
  email: `a${Math.random()}@x.in`, emailKey: `a${Math.random()}@x.in`, passwordHash: 'x'.repeat(60),
  companyName: 'Acme', contactName: 'R', phone: '9', status: 'approved', submittedAt: new Date(),
});

it('queues read the status index and examine only the page', async () => {
  const acc = await account();
  const t = Date.now();
  await SupplierListing.insertMany(Array.from({ length: 400 }, (_, i) => ({
    supplierAccount: acc._id, status: i < 40 ? 'submitted' : 'live', title: `Part ${i}`, costPaise: 1000, gstPct: 18,
    submittedAt: new Date(t - i * 1000),
  })));
  const sort = { field: 'submittedAt', dir: 1, type: 'date' };
  const ex = await repo.listingPage(and({ status: 'submitted', submittedAt: { $type: 'date' } }), { sort: sortSpec(sort), limit: 31 }).explain('executionStats');
  expect(indexOf(ex)).toBe('listing_status_submitted');
  expect(ex.executionStats.totalDocsExamined).toBe(31);
  expect(plan(ex)).not.toContain('"SORT"');

  await SupplierAccount.insertMany(Array.from({ length: 200 }, (_, i) => ({
    email: `q${i}@x.in`, emailKey: `q${i}@x.in`, passwordHash: 'x'.repeat(60), companyName: `C${i}`, contactName: 'R', phone: '9',
    status: i < 10 ? 'in_review' : 'approved', submittedAt: new Date(t - i * 1000),
  })));
  const ax = await repo.accountPage(and({ status: 'in_review', submittedAt: { $type: 'date' } }), { sort: sortSpec(sort), limit: 31 }).explain('executionStats');
  expect(indexOf(ax)).toBe('supplier_account_status_submitted');
  expect(ax.executionStats.totalDocsExamined).toBe(10);

  const rx = await repo.reviewPage({ status: 'pending' }, { sort: { createdAt: 1, _id: 1 }, limit: 31 }).explain('executionStats');
  expect(indexOf(rx)).toBe('price_review_status_created');
});

it('a page of price reviews reads the margin rules once, whatever the categories', async () => {
  const acc = await account();
  const cats = await Category.insertMany(Array.from({ length: 30 }, (_, i) => ({ name: `Cat ${i}`, slug: `cat-${i}` })));
  await MarginRule.create({ key: `category:${cats[3]._id}`, category: cats[3]._id, targetBp: 4000, floorBp: 1500 });
  for (let i = 0; i < 30; i += 1) {
    const p = await Product.create({ name: `Prod ${i}`, slug: `prod-${i}`, description: 'a product here', price: 3000, categories: [cats[i]._id] });
    const l = await SupplierListing.create({ supplierAccount: acc._id, status: 'live', productId: p._id, title: `P${i}`, costPaise: 150000, gstPct: 18 });
    await SupplierPriceReview.create({ listing: l._id, product: p._id, supplierAccount: acc._id, oldCostPaise: 140000, newCostPaise: 150000, gstPct: 18, priceAtRaise: 3000, suggestedPrice: 2530, marginBp: 3000 });
  }
  let page;
  const m = await countQueries(async () => { page = await priceReviews.list(admin, {}); });
  expect(page.items).toHaveLength(30);
  // The category rule applies to the product in that category only.
  expect(page.items.find((r) => r.productName === 'Prod 3').floorBp).toBe(1500);
  expect(page.items.find((r) => r.productName === 'Prod 4').floorBp).toBe(1000);
  expect(m.total('marginrules')).toBe(1);
});

it('listing detail: the duplicate search is bounded', async () => {
  const acc = await account();
  const cat = await Category.create({ name: 'Wipers', slug: 'wipers' });
  await Product.insertMany(Array.from({ length: 1500 }, (_, i) => ({
    name: `Wiper blade model ${i}`, slug: `wb-${i}`, description: 'a wiper blade for cars', price: 500 + i, sku: `SKU${i}`, categories: [cat._id], isActive: i % 5 !== 0,
  })));
  const l = await SupplierListing.create({ supplierAccount: acc._id, status: 'submitted', title: 'Wiper blade model 42', partNumber: 'SKU42', costPaise: 30000, gstPct: 18, submittedAt: new Date() });
  let detail;
  const m = await countQueries(async () => { detail = await listings.get(admin, String(l._id)); });
  expect(detail.duplicates[0].sku).toBe('SKU42');
  expect(m.total('products')).toBeLessThanOrEqual(4);
});

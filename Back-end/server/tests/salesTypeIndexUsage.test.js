/**
 * The B2B / B2C lists (services/salesTypeService.js), measured with explain on a
 * seeded collection of ordinary orders plus a few GTM orders carrying accounts'
 * check. Most orders never have a check (website orders, older GTM orders), and
 * approved ones pile up forever — so the lists must read only the checked orders,
 * via order_sales_type_check, and never walk the orders collection newest-first.
 */
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import Order from '../models/Order.js';
import { SALES_TYPE_VIEWS } from '../services/salesTypeService.js';

const ORDINARY = 3000;
const PENDING = 20;
const APPROVED = 400;
const stats = (e) => e.executionStats;
const plan = (e) => JSON.stringify(e.queryPlanner.winningPlan);

beforeAll(async () => {
  await dbHandler.connect();
  await Order.syncIndexes();
});
// tests/setup.js empties the collections after every test, so each test seeds its own.
beforeEach(async () => {
  const base = (i) => ({
    _id: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    items: [{ custom: true, name: 'Kit', price: 100, quantity: 1 }],
    shippingAddress: { fullName: `C${i}`, phone: '98', addressLine1: '1', city: 'Pune', state: 'MH', postalCode: '411001' },
    subtotal: 100, totalAmount: 100,
    // The checked GTM orders are the OLDEST here: the worst case for a newest-first walk.
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60000),
  });
  const pending = Array.from({ length: PENDING }, (_, i) => ({
    ...base(i), status: 'awaiting_payment', paymentStatus: 'pending', buyerTypeCheck: { status: 'pending', type: i % 2 ? 'b2b' : 'b2c' },
  }));
  const approved = Array.from({ length: APPROVED }, (_, i) => ({
    ...base(PENDING + i), status: 'delivered', paymentStatus: 'paid',
    ...(i % 40 === 0 && { status: 'awaiting_payment', paymentStatus: 'pending', buyer: { type: 'enterprise', legalName: 'ABC', gstin: '27AAPFU0939F1ZV' } }),
    buyerTypeCheck: { status: 'approved', type: i % 40 === 0 ? 'b2b' : 'b2c', note: 'ok' },
  }));
  const ordinary = Array.from({ length: ORDINARY }, (_, i) => ({
    ...base(PENDING + APPROVED + i), status: i % 3 ? 'processing' : 'awaiting_payment', paymentStatus: i % 3 ? 'paid' : 'pending',
  }));
  await Order.collection.insertMany([...pending, ...approved, ...ordinary]);
});
afterAll(async () => { await dbHandler.closeDatabase(); });

const firstPage = (view) => Order.find(SALES_TYPE_VIEWS[view]()).sort({ createdAt: -1, _id: -1 }).limit(26).explain('executionStats');

it('"to approve" reads only the orders waiting for accounts', async () => {
  const e = await firstPage('check');
  expect(plan(e)).toContain('order_sales_type_check');
  expect(plan(e)).not.toMatch(/"stage":"SORT"/);
  expect(stats(e).totalDocsExamined).toBeLessThanOrEqual(PENDING + 1);
});

it('"B2B not paid" reads only approved orders, newest first, no in-memory sort', async () => {
  const e = await firstPage('b2b_unpaid');
  expect(plan(e)).toContain('order_sales_type_check');
  expect(plan(e)).not.toMatch(/"stage":"SORT"/);
  // Walks the approved orders (not the 3,000 others); the B2B filter is applied on those.
  expect(stats(e).totalDocsExamined).toBeLessThanOrEqual(APPROVED);
  expect(stats(e).nReturned).toBe(APPROVED / 40);
});

it('"approved" (change B2B / B2C) reads one page of approved orders, no in-memory sort', async () => {
  const e = await firstPage('approved');
  expect(plan(e)).toContain('order_sales_type_check');
  expect(plan(e)).not.toMatch(/"stage":"SORT"/);
  // Index-only bounds on status: one page, never the 3,000 other orders.
  expect(stats(e).totalDocsExamined).toBeLessThanOrEqual(26);
  expect(stats(e).nReturned).toBe(26);
});

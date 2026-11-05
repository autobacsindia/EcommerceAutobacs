/**
 * The "link an expense to an order" picker (orderRepository.findForPaymentLink),
 * measured with explain on a seeded collection:
 *   - it walks team_workflow_paid_list_date (paid orders in the workflow, newest first) — never
 *     the whole orders collection, and never an unpaid order;
 *   - a hit stops at the page size: the newest matches, not a full read.
 * The short number ("#DD97FE16") has no index of its own (it is the end of _id), so
 * a search that matches nothing reads at most the paid workflow orders — bounded by
 * maxTimeMS. That is the known worst case, measured here.
 */
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import Order from '../models/Order.js';
import orderRepository from '../repositories/orderRepository.js';

const plan = (explain) => JSON.stringify(explain.queryPlanner.winningPlan);
const PAID = 400;
const UNPAID = 1600;
let newest;

beforeAll(async () => {
  await dbHandler.connect();
  await Order.syncIndexes();
});
beforeEach(async () => {
  await Order.deleteMany({});
  const row = (i, paid) => ({
    _id: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    items: [{ product: new mongoose.Types.ObjectId(), name: 'Kit', price: 100, quantity: 1 }],
    shippingAddress: { fullName: i % 10 === 0 ? 'Ravi Kumar' : `Customer ${i}`, phone: `98${String(i).padStart(8, '0')}`, addressLine1: '1', city: 'Kochi', state: 'Kerala', postalCode: '682001' },
    subtotal: 100, totalAmount: 100,
    status: paid ? 'processing' : 'awaiting_payment',
    paymentStatus: paid ? 'paid' : 'pending',
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60000),
    listDate: new Date(Date.UTC(2026, 0, 1) + i * 60000),
    ...(paid ? { workflow: { open: true, enteredAt: new Date(Date.UTC(2026, 0, 1) + i * 60000) } } : {}),
  });
  const docs = [...Array.from({ length: PAID }, (_, i) => row(i, true)), ...Array.from({ length: UNPAID }, (_, i) => row(PAID + i, false))];
  await Order.collection.insertMany(docs);
  newest = docs[PAID - 1];
});
afterAll(async () => { await dbHandler.closeDatabase(); });

it('walks team_workflow_paid, not the orders collection', async () => {
  const explain = await orderRepository.findForPaymentLink('ravi', { explain: true });
  expect(plan(explain)).not.toContain('COLLSCAN');
  expect(plan(explain)).toContain('team_workflow_paid_list_date');
  expect(plan(explain)).not.toMatch(/"stage":"SORT"/); // no blocking sort
  // A hit: stops once a page of matches is found (8), newest first.
  expect(explain.executionStats.nReturned).toBe(8);
  // 40 Ravi orders among 400 paid: the newest 8 are found within the newest ~80.
  expect(explain.executionStats.totalDocsExamined).toBeLessThanOrEqual(80);
});

it('still answers if the pinned index is missing (it is built by a script)', async () => {
  await Order.collection.dropIndex('team_workflow_paid_list_date');
  try {
    const rows = await orderRepository.findForPaymentLink('ravi');
    expect(rows).toHaveLength(8);
  } finally {
    await Order.syncIndexes();
  }
});

it('a short number finds the order; a miss reads only paid workflow orders (the bounded worst case)', async () => {
  const short = String(newest._id).slice(-8);
  const hit = await orderRepository.findForPaymentLink(`#${short.toUpperCase()}`);
  expect(hit.map((o) => String(o._id))).toEqual([String(newest._id)]);

  const miss = await orderRepository.findForPaymentLink('zzzz-nobody', { explain: true });
  expect(miss.executionStats.nReturned).toBe(0);
  expect(miss.executionStats.totalDocsExamined).toBeLessThanOrEqual(PAID);
  // eslint-disable-next-line no-console
  console.log(`[order lookup] miss examined ${miss.executionStats.totalDocsExamined} of ${PAID + UNPAID} orders in ${miss.executionStats.executionTimeMillis} ms`);
});

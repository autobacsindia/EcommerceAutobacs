/**
 * "Ship before payment" reads, measured with explain on a seeded collection of
 * ordinary orders plus a few pay-later ones. The bell count runs on every poll of
 * every accounts/admin panel, so it must read only the pay-later orders — via
 * order_pay_later — and never scan the orders collection.
 */
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import Order from '../models/Order.js';
import { payLaterDueFilter } from '../config/payLater.js';

const ORDINARY = 3000;
const PAY_LATER = 30;
const stats = (e) => e.executionStats;
const plan = (e) => JSON.stringify(e.queryPlanner.winningPlan);
let aCustomer;

beforeAll(async () => {
  await dbHandler.connect();
  await Order.syncIndexes();
  const base = (i) => ({
    _id: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    items: [{ custom: true, name: 'Kit', price: 100, quantity: 1 }],
    shippingAddress: { fullName: `C${i}`, phone: '98', addressLine1: '1', city: 'Pune', state: 'MH', postalCode: '411001' },
    subtotal: 100, totalAmount: 100, createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60000),
  });
  const ordinary = Array.from({ length: ORDINARY }, (_, i) => ({
    ...base(i), status: i % 3 ? 'processing' : 'awaiting_payment', paymentStatus: i % 3 ? 'paid' : 'pending',
  }));
  const later = Array.from({ length: PAY_LATER }, (_, i) => ({
    ...base(ORDINARY + i), status: 'shipped', paymentStatus: i % 2 ? 'pending' : 'paid',
    payLater: { approvedAt: new Date(Date.UTC(2026, 10, 1) + i * 60000), dispatchedAt: new Date(), dueAt: new Date(Date.UTC(2026, 10, 4) + i * 60000) },
  }));
  aCustomer = later[1].user;
  await Order.collection.insertMany([...ordinary, ...later]);
});
afterAll(async () => { await dbHandler.closeDatabase(); });

it('bell count (overdue) reads only pay-later orders', async () => {
  const e = await Order.find({ ...payLaterDueFilter(), 'payLater.dueAt': { $lt: new Date() } }).explain('executionStats');
  expect(plan(e)).toContain('order_pay_later');
  expect(plan(e)).not.toContain('COLLSCAN');
  expect(stats(e).totalDocsExamined).toBeLessThanOrEqual(PAY_LATER / 2);
});

it('the due list pages newest approval first with no in-memory sort', async () => {
  const e = await Order.find(payLaterDueFilter()).sort({ 'payLater.approvedAt': -1, _id: -1 }).limit(26).explain('executionStats');
  expect(plan(e)).toContain('order_pay_later');
  expect(plan(e)).not.toMatch(/"stage":"SORT"/);
  expect(stats(e).totalDocsExamined).toBeLessThanOrEqual(PAY_LATER / 2);
});

it('the paid list and the sweep stay on the index too', async () => {
  const paid = await Order.find({ 'payLater.approvedAt': { $type: 'date' }, paymentStatus: { $in: ['paid', 'refunded'] } })
    .sort({ 'payLater.approvedAt': -1, _id: -1 }).limit(26).explain('executionStats');
  expect(plan(paid)).toContain('order_pay_later');
  expect(stats(paid).totalDocsExamined).toBeLessThanOrEqual(PAY_LATER / 2);
  const sweep = await Order.find(payLaterDueFilter()).sort({ 'payLater.approvedAt': 1, _id: 1 }).limit(200).explain('executionStats');
  expect(plan(sweep)).not.toContain('COLLSCAN');
  expect(stats(sweep).totalDocsExamined).toBeLessThanOrEqual(PAY_LATER / 2);
});

it('the "customer has an overdue order" check does not scan', async () => {
  const e = await Order.find({ user: aCustomer, ...payLaterDueFilter(), 'payLater.dueAt': { $lt: new Date() } }).limit(1).explain('executionStats');
  expect(plan(e)).not.toContain('COLLSCAN');
  expect(stats(e).totalDocsExamined).toBeLessThanOrEqual(PAY_LATER / 2);
});

/**
 * The supplier directory and the admin's "to pay, by supplier" queue read with
 * indexes, not collection scans (measured with explain):
 *   - the picker's name search is a prefix range on supplier_active_name
 *   - the to-pay queue reads payment_request_status and examines only the
 *     approved / on-hold supplier rows, however many paid ones pile up
 */
import mongoose from 'mongoose';
import * as dbHandler from './db-handler.js';
import Supplier from '../models/Supplier.js';
import PaymentRequest from '../models/PaymentRequest.js';
import supplierRepository from '../repositories/supplierRepository.js';

const plan = (explain) => JSON.stringify(explain.queryPlanner.winningPlan);
const indexOf = (explain) => (plan(explain).includes('COLLSCAN') ? 'COLLSCAN' : (plan(explain).match(/"indexName":"([^"]+)"/) || [])[1]);

beforeAll(async () => {
  await dbHandler.connect();
  await Promise.all([Supplier.syncIndexes(), PaymentRequest.syncIndexes()]);
});
afterAll(async () => { await dbHandler.closeDatabase(); });

it('the supplier picker searches by name prefix on an index', async () => {
  await Supplier.insertMany(Array.from({ length: 300 }, (_, i) => ({
    name: `Supplier ${String(i).padStart(3, '0')}`, nameKey: `supplier ${String(i).padStart(3, '0')}`, active: i % 3 !== 0,
    payment: { method: 'upi', upiId: `s${i}@okaxis` },
  })));
  await Supplier.create({ name: 'Bosch Parts', nameKey: 'bosch parts', payment: { method: 'upi', upiId: 'bosch@okaxis' } });
  const explain = await supplierRepository.page({ prefix: 'bosch', active: true, limit: 51 }).explain('executionStats');
  expect(indexOf(explain)).toBe('supplier_active_name');
  expect(explain.executionStats.totalDocsExamined).toBe(1);
});

it('the to-pay queue examines only the open supplier rows, not the paid history', async () => {
  const base = (i, status) => ({
    number: `PR-${i}`, kind: 'supplier', status, team: 'procurement', requestedBy: new mongoose.Types.ObjectId(), requestedByName: 'P',
    amount: 100, category: 'supplier', payee: { name: 'ARB', method: 'upi', upiId: 'arb@okaxis' },
  });
  await PaymentRequest.insertMany([
    ...Array.from({ length: 400 }, (_, i) => base(i, 'paid')),
    ...Array.from({ length: 12 }, (_, i) => base(1000 + i, i % 4 === 0 ? 'on_hold' : 'approved')),
  ]);
  const explain = await PaymentRequest.find({ status: { $in: ['approved', 'on_hold'] }, kind: 'supplier' })
    .sort({ createdAt: 1, _id: 1 }).limit(500).explain('executionStats');
  expect(indexOf(explain)).toBe('payment_request_status');
  expect(explain.executionStats.totalDocsExamined).toBe(12);
});

/**
 * The slip reader's duplicate-UTR check (services/slipReader → findReferenceUse)
 * runs on every slip read. Each of its three lookups must be an index lookup,
 * never a scan — measured with explain() over 20,000 payments, 5,000 supplier
 * refunds and 5,000 bank transfers. Before the two indexes below, one read
 * examined 16,000 payments and 5,000 ledger rows.
 *
 * Pinned because prod runs with autoIndex off: these exist only because
 * config/db.js ensureCriticalIndexes builds them, and a lookup that drifts off
 * its index still "works" — by scanning everything.
 */
import { jest } from '@jest/globals';
import * as dbHandler from './db-handler.js';
import PaymentRequest from '../models/PaymentRequest.js';
import SupplierLedgerEntry from '../models/SupplierLedgerEntry.js';
import BankTransfer from '../models/BankTransfer.js';
import paymentRequestRepository from '../repositories/paymentRequestRepository.js';
import supplierLedgerRepository from '../repositories/supplierLedgerRepository.js';
import bankTransferRepository from '../repositories/bankTransferRepository.js';

jest.setTimeout(120000);

const planOf = (e) => JSON.stringify(e.queryPlanner?.winningPlan ?? e);
const indexesIn = (e) => [...new Set([...planOf(e).matchAll(/"indexName":"([^"]+)"/g)].map((m) => m[1]))];
const ref = (i) => String(400000000000 + i);

beforeAll(async () => {
  await dbHandler.connect();
  await Promise.all([PaymentRequest.syncIndexes(), SupplierLedgerEntry.syncIndexes(), BankTransfer.syncIndexes()]);
});
beforeEach(async () => {
  await PaymentRequest.collection.insertMany(Array.from({ length: 20000 }, (_, i) => ({
    number: `PR-${i}`, status: i % 5 ? 'paid' : 'approved', amount: 1000, createdAt: new Date(), payment: { reference: i % 7 ? ref(i) : '' },
  })));
  await SupplierLedgerEntry.collection.insertMany(Array.from({ length: 5000 }, (_, i) => ({
    key: `k${i}`, status: i % 3 ? 'approved' : 'declined', reference: i % 4 ? ref(100000 + i) : '', createdAt: new Date(),
  })));
  await BankTransfer.collection.insertMany(Array.from({ length: 5000 }, (_, i) => ({ referenceKey: ref(200000 + i), active: i % 2 === 0, orderNumber: `AB-${i}` })));
});

it.each([
  ['paid payments', () => paymentRequestRepository.findPaidByReference([ref(1), ref(1).toLowerCase()]), 'payment_request_paid_reference'],
  ['supplier refunds', () => supplierLedgerRepository.findLiveByReference([ref(100001)]), 'supplier_ledger_reference'],
  ['bank transfers', () => bankTransferRepository.findActiveByReference(ref(200002)), 'bank_transfer_utr_active'],
  ['a UTR used nowhere', () => paymentRequestRepository.findPaidByReference(['999999999999']), 'payment_request_paid_reference'],
])('%s: an index lookup reading at most a couple of rows', async (_label, query, index) => {
  const e = await query().explain('executionStats');
  expect(planOf(e)).not.toContain('COLLSCAN');
  expect(indexesIn(e)).toContain(index);
  expect(e.executionStats.totalDocsExamined).toBeLessThanOrEqual(2);
});

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as db from '../../db-handler.js';
import ReturnRequest from '../../../models/ReturnRequest.js';
import returnRequestRepository from '../../../repositories/returnRequestRepository.js';

/**
 * The once-only guarantees behind return refunds, against a REAL database — every one of
 * them is a query predicate or a unique index, and a mocked repository passes just as
 * happily against a predicate that matches nothing.
 *
 *   1. One payout per return, however many people press "Refund" at once.
 *   2. One refund per installation (service) line across ALL returns on the order — the
 *      unique_refunded_service_line index.
 *   3. One email per key (emailsSent).
 */

jest.setTimeout(120000);

beforeAll(async () => {
  await db.connect();
  // Build the declared indexes now: the guarantee under test IS an index.
  await ReturnRequest.createIndexes();
});
afterAll(async () => { await db.closeDatabase(); });
afterEach(async () => { await ReturnRequest.deleteMany({}); });

const oid = () => new mongoose.Types.ObjectId();

const makeReturn = (overrides = {}) => ReturnRequest.create({
  order: overrides.order || oid(),
  user: oid(),
  items: [{ product: oid(), quantity: 1, reason: 'wrong_item', unitPrice: 9000 }],
  problemDescription: 'Wrong model sent',
  status: 'received',
  inspection: { passed: true },
  ...overrides,
});

const claim = (id, extra = {}) => returnRequestRepository.claimForRefund(id, {
  productValue: 9000, listValue: 9000, discountShare: 0,
  shippingDeduction: 0, restockingDeduction: 0, finalAmount: 10200, initiatedBy: oid(),
  shippingShare: 200,
  ...extra,
});

describe('claimForRefund', () => {
  it('has exactly one winner when two people refund the same return at once', async () => {
    const rr = await makeReturn();
    const results = await Promise.all([claim(rr._id), claim(rr._id), claim(rr._id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('stores the fault-based breakdown in the same atomic write', async () => {
    const rr = await makeReturn();
    const fit = oid();
    await claim(rr._id, {
      serviceLines: [{ orderItemId: fit, name: 'Installation', netPaidPaise: 100000, amountPaise: 100000 }],
      creditNoteNo: 'CN-7',
    });
    const saved = await ReturnRequest.findById(rr._id).lean();
    expect(saved.refund).toMatchObject({
      status: 'processing', finalAmount: 10200, shippingShare: 200, creditNoteNo: 'CN-7', pickupDeduction: 0,
    });
    expect(String(saved.refund.serviceLines[0].orderItemId)).toBe(String(fit));
  });
});

describe('unique_refunded_service_line', () => {
  const fitLine = (id) => [{ orderItemId: id, name: 'Installation', netPaidPaise: 100000, amountPaise: 100000 }];

  it('lets only ONE of two returns refund the same installation line, even at the same moment', async () => {
    const order = oid();
    const fit = oid();
    const [a, b] = await Promise.all([makeReturn({ order }), makeReturn({ order })]);
    const outcomes = await Promise.allSettled([
      claim(a._id, { serviceLines: fitLine(fit) }),
      claim(b._id, { serviceLines: fitLine(fit) }),
    ]);
    const won = outcomes.filter((o) => o.status === 'fulfilled' && o.value);
    const lost = outcomes.filter((o) => o.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason.code).toBe(11000);
  });

  it('frees the line again when the refund that held it failed', async () => {
    const order = oid();
    const fit = oid();
    const a = await makeReturn({ order });
    const b = await makeReturn({ order });
    await claim(a._id, { serviceLines: fitLine(fit) });
    await ReturnRequest.updateOne({ _id: a._id }, { $set: { 'refund.status': 'failed' } });
    await expect(claim(b._id, { serviceLines: fitLine(fit) })).resolves.toBeTruthy();
  });

  it('never makes returns WITHOUT installation collide with each other', async () => {
    const order = oid();
    const [a, b, c] = await Promise.all([makeReturn({ order }), makeReturn({ order }), makeReturn({ order })]);
    const results = await Promise.all([claim(a._id), claim(b._id), claim(c._id)]);
    expect(results.every(Boolean)).toBe(true);
  });

  it('refundedServiceLineIds lists lines other committed returns refunded, not this one', async () => {
    const order = oid();
    const fit = oid();
    const a = await makeReturn({ order });
    const b = await makeReturn({ order });
    await claim(a._id, { serviceLines: fitLine(fit) });
    expect(await returnRequestRepository.refundedServiceLineIds(order, b._id)).toEqual([String(fit)]);
    expect(await returnRequestRepository.refundedServiceLineIds(order, a._id)).toEqual([]);
  });
});

describe('emailsSent', () => {
  it('records each key once, however many workers race', async () => {
    const rr = await makeReturn();
    const marks = await Promise.all([
      returnRequestRepository.markEmailed(rr._id, 'approved'),
      returnRequestRepository.markEmailed(rr._id, 'approved'),
      returnRequestRepository.markEmailed(rr._id, 'approved'),
    ]);
    expect(marks.filter(Boolean)).toHaveLength(1);
    expect(await returnRequestRepository.wasEmailed(rr._id, 'approved')).toBe(true);
    expect(await returnRequestRepository.wasEmailed(rr._id, 'refunded:1')).toBe(false);
    const saved = await ReturnRequest.findById(rr._id).lean();
    expect(saved.emailsSent).toHaveLength(1);
  });
});

describe('legacy rows', () => {
  it('an old return (no fault, no orderItemId, no new refund fields) still loads and saves', async () => {
    const id = oid();
    await ReturnRequest.collection.insertOne({
      _id: id,
      order: oid(),
      user: oid(),
      items: [{ product: oid(), quantity: 1, reason: 'transit_damage', unitPrice: 500 }],
      problemDescription: 'Cracked',
      type: 'return',
      origin: 'customer',
      status: 'pending',
      refund: { productValue: 500, finalAmount: 500, status: 'pending' },
      timeline: [],
    });
    const rr = await ReturnRequest.findById(id);
    rr.adminNotes = 'checked';
    await expect(rr.save()).resolves.toBeTruthy();
  });

  it('a staff-raised return for a guest order needs no customer account', async () => {
    await expect(ReturnRequest.create({
      order: oid(),
      origin: 'staff',
      raisedBy: oid(),
      items: [{ product: oid(), quantity: 1, reason: 'ordered_wrong', unitPrice: 500, fault: { claimed: 'customer' } }],
      problemDescription: 'Ordered the wrong size',
    })).resolves.toBeTruthy();
  });

  it('a customer-raised return still needs the customer', async () => {
    await expect(ReturnRequest.create({
      order: oid(),
      items: [{ product: oid(), quantity: 1, reason: 'wrong_item', unitPrice: 500 }],
      problemDescription: 'x',
    })).rejects.toThrow(/user/);
  });
});

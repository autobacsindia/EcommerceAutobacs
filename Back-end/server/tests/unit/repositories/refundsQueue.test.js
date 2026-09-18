import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import * as db from '../../db-handler.js';
import Order from '../../../models/Order.js';
import User from '../../../models/User.js';
import orderRepository from '../../../repositories/orderRepository.js';

/**
 * The admin refunds queue after the 2026-09 optimisation pass: bounded, cursor
 * paginated, projected, and searched on the server.
 *
 * Against a REAL database because the two things most likely to break are invisible to
 * a mocked repository:
 *   1. The PROJECTION. `.select()` returns whatever the database has; a mock returns
 *      whatever the test hands it, so a field dropped from the projection but still read
 *      by the controller's mapper would sail through a mocked suite and render `undefined`
 *      in production. Same reason tests/unit/repositories/orderReturnLoaders.test.js
 *      exists.
 *   2. The KEYSET predicate. It is a `$or` of two comparisons against real BSON values;
 *      only a real query can show it neither skips nor duplicates a row.
 */

jest.setTimeout(120000);

beforeAll(async () => { await db.connect(); });
afterAll(async () => { await db.closeDatabase(); });

// Every field controllers/orderController.js getRefunds reads off a row.
const MAPPER_FIELDS = ['_id', 'totalAmount', 'updatedAt', 'refundDetails', 'user'];

let userId;

const makeOrder = async (overrides = {}, createdAt = new Date()) => {
  const order = await Order.create({
    user: userId,
    items: [],
    totalAmount: 1500,
    subtotal: 1500,
    tax: 0,
    shippingCost: 0,
    status: 'cancelled',
    paymentStatus: 'paid',
    refundDetails: { status: 'pending', amount: 1500, requestedAt: new Date() },
    shippingAddress: {
      fullName: 'Test Buyer', phone: '9999999999', addressLine1: '1 Road',
      city: 'Kochi', state: 'Kerala', postalCode: '682001', country: 'India',
    },
    ...overrides,
  });
  // createdAt is set by timestamps, so it has to be forced afterwards to build a
  // deterministic ordering for the pagination assertions.
  await Order.collection.updateOne({ _id: order._id }, { $set: { createdAt } });
  return order;
};

beforeEach(async () => {
  const user = await User.create({
    name: 'Priya Menon', email: 'priya@example.com', passwordHash: 'x'.repeat(60),
  });
  userId = user._id;
});

describe('findWithRefunds — projection contract', () => {
  it('returns every field the controller mapper reads', async () => {
    await makeOrder();
    const { orders } = await orderRepository.findWithRefunds('all');

    expect(orders).toHaveLength(1);
    for (const field of MAPPER_FIELDS) {
      expect(orders[0]).toHaveProperty(field);
    }
    // The populated buyer, projected to what the row shows.
    expect(orders[0].user.name).toBe('Priya Menon');
    expect(orders[0].refundDetails.amount).toBe(1500);
  });

  it('carries the offline fields the queue now displays', async () => {
    await makeOrder({
      refundDetails: {
        status: 'completed', amount: 1500, refundType: 'full', refundMethod: 'offline',
        requestedAt: new Date(), offlineMethod: 'upi', offlineReference: 'UPI-77',
      },
    });

    const { orders } = await orderRepository.findWithRefunds('all');
    expect(orders[0].refundDetails.offlineMethod).toBe('upi');
    expect(orders[0].refundDetails.offlineReference).toBe('UPI-77');
  });

  it('returns lean objects, not hydrated documents', async () => {
    await makeOrder();
    const { orders } = await orderRepository.findWithRefunds('all');
    expect(orders[0]).not.toHaveProperty('save');
  });

  it('still surfaces a legacy order with no refundDetails at all', async () => {
    const order = await makeOrder();
    await Order.collection.updateOne({ _id: order._id }, { $unset: { refundDetails: '' } });

    const { orders } = await orderRepository.findWithRefunds('all');
    expect(orders).toHaveLength(1);
    // And under the `pending` filter, which is where an admin actually looks for it.
    expect((await orderRepository.findWithRefunds('pending')).orders).toHaveLength(1);
  });
});

describe('findWithRefunds — bounding and cursor pagination', () => {
  const seed = async (count) => {
    const base = Date.parse('2026-09-01T00:00:00.000Z');
    for (let i = 0; i < count; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- deterministic ordering needs sequence
      await makeOrder({ totalAmount: 100 + i }, new Date(base + i * 60_000));
    }
  };

  it('never returns more than the requested page', async () => {
    await seed(7);
    const { orders, nextCursor } = await orderRepository.findWithRefunds('all', { limit: 3 });

    expect(orders).toHaveLength(3);
    expect(nextCursor).toMatchObject({ id: expect.any(String) });
  });

  it('clamps an absurd limit rather than honouring it', async () => {
    await seed(5);
    const { orders } = await orderRepository.findWithRefunds('all', { limit: 100000 });
    expect(orders).toHaveLength(5);
  });

  it('walks every row exactly once, with no gaps and no repeats', async () => {
    // The property that actually matters. Offset pagination cannot promise it under
    // concurrent writes; a keyset on an immutable key can.
    await seed(10);

    const seen = [];
    let cursor = null;
    for (let page = 0; page < 10; page += 1) {
      // eslint-disable-next-line no-await-in-loop -- pagination is inherently sequential
      const res = await orderRepository.findWithRefunds('all', { limit: 3, cursor });
      seen.push(...res.orders.map((o) => String(o._id)));
      cursor = res.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
  });

  it('orders newest-first and pages in that order', async () => {
    await seed(6);
    const first = await orderRepository.findWithRefunds('all', { limit: 3 });
    const second = await orderRepository.findWithRefunds('all', { limit: 3, cursor: first.nextCursor });

    const amounts = [...first.orders, ...second.orders].map((o) => o.totalAmount);
    // Seeded with ascending createdAt and ascending totalAmount, so newest-first is
    // descending totalAmount.
    expect(amounts).toEqual([105, 104, 103, 102, 101, 100]);
  });

  it('reports no next cursor on the final page', async () => {
    await seed(3);
    const { orders, nextCursor } = await orderRepository.findWithRefunds('all', { limit: 3 });
    expect(orders).toHaveLength(3);
    // Exactly-full last page must not advertise another one.
    expect(nextCursor).toBeNull();
  });

  it('separates rows sharing an identical createdAt using the _id tiebreak', async () => {
    // Bulk-imported orders can share a timestamp to the millisecond. Without the _id
    // half of the keyset they would either repeat forever or be skipped.
    const sameInstant = new Date('2026-09-05T12:00:00.000Z');
    await makeOrder({ totalAmount: 1 }, sameInstant);
    await makeOrder({ totalAmount: 2 }, sameInstant);
    await makeOrder({ totalAmount: 3 }, sameInstant);

    const seen = [];
    let cursor = null;
    for (let page = 0; page < 5; page += 1) {
      // eslint-disable-next-line no-await-in-loop -- pagination is inherently sequential
      const res = await orderRepository.findWithRefunds('all', { limit: 1, cursor });
      seen.push(...res.orders.map((o) => String(o._id)));
      cursor = res.nextCursor;
      if (!cursor) break;
    }

    expect(new Set(seen).size).toBe(3);
  });
});

describe('findWithRefunds — server-side search', () => {
  it('finds by buyer name', async () => {
    await makeOrder();
    const other = await User.create({
      name: 'Rahul Nair', email: 'rahul@example.com', passwordHash: 'x'.repeat(60),
    });
    await makeOrder({ user: other._id, totalAmount: 999 });

    const { orders } = await orderRepository.findWithRefunds('all', { search: 'Rahul' });
    expect(orders).toHaveLength(1);
    expect(orders[0].totalAmount).toBe(999);
  });

  it('finds by buyer email', async () => {
    await makeOrder();
    const { orders } = await orderRepository.findWithRefunds('all', { search: 'priya@example.com' });
    expect(orders).toHaveLength(1);
  });

  it('finds by a trailing fragment of the order id, with or without the # prefix', async () => {
    const order = await makeOrder();
    await makeOrder({ totalAmount: 999 });
    const fragment = String(order._id).slice(-8);

    expect((await orderRepository.findWithRefunds('all', { search: fragment })).orders).toHaveLength(1);
    expect((await orderRepository.findWithRefunds('all', { search: `#${fragment}` })).orders).toHaveLength(1);
    expect((await orderRepository.findWithRefunds('all', { search: String(order._id) })).orders).toHaveLength(1);
  });

  it('returns NOTHING for a term that matches nothing', async () => {
    // An empty `$or` is rejected by MongoDB, and an omitted one would return the whole
    // queue — the failure that silently turns "no results" into "all results".
    await makeOrder();
    const { orders } = await orderRepository.findWithRefunds('all', { search: 'zzz-nobody-zzz' });
    expect(orders).toHaveLength(0);
  });

  it('does not let a search widen a status filter', async () => {
    // The status branches own a top-level `$or`; merging search into the same object
    // would replace it and quietly show rows the admin filtered out.
    await makeOrder({
      refundDetails: { status: 'completed', amount: 1500, requestedAt: new Date() },
    });
    const { orders } = await orderRepository.findWithRefunds('pending', { search: 'Priya' });
    expect(orders).toHaveLength(0);
  });

  it('combines search WITH the cursor without losing either', async () => {
    const base = Date.parse('2026-09-01T00:00:00.000Z');
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- deterministic ordering needs sequence
      await makeOrder({ totalAmount: 200 + i }, new Date(base + i * 60_000));
    }

    const first = await orderRepository.findWithRefunds('all', { search: 'Priya', limit: 2 });
    const second = await orderRepository.findWithRefunds('all', { search: 'Priya', limit: 2, cursor: first.nextCursor });

    expect([...first.orders, ...second.orders].map((o) => o.totalAmount)).toEqual([203, 202, 201, 200]);
  });
});

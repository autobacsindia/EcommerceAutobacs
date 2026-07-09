/**
 * Unit tests for userRepository.markPurchased — the single choke point that
 * denormalizes a paid order onto the User (CRM "customer" tag + net LTV).
 * Verifies: first purchase stamps firstPurchaseAt once, every purchase updates
 * lastOrderAt + increments paidOrderCount, and totalSpentPaise accumulates net
 * LTV in integer paise (rounded, never negative). See ADR-006.
 */

import { connect, closeDatabase, clearDatabase } from '../../db-handler.js';
import userRepository from '../../../repositories/userRepository.js';
import User from '../../../models/User.js';

beforeAll(async () => { await connect(); });
afterEach(async () => { await clearDatabase(); });
afterAll(async () => { await closeDatabase(); });

async function makeUser() {
  return User.create({ name: 'Ada', email: 'ada@example.com', passwordHash: 'x' });
}

describe('userRepository.markPurchased', () => {
  it('stamps the customer denorm + LTV on the first paid order', async () => {
    const user = await makeUser();
    const when = new Date('2026-07-01T10:00:00Z');

    const updated = await userRepository.markPurchased(user._id, { amountPaise: 149900, when });

    expect(updated.hasPurchased).toBe(true);
    expect(updated.paidOrderCount).toBe(1);
    expect(updated.totalSpentPaise).toBe(149900);
    expect(updated.firstPurchaseAt.toISOString()).toBe(when.toISOString());
    expect(updated.lastOrderAt.toISOString()).toBe(when.toISOString());
  });

  it('accumulates net LTV + count across orders, keeping firstPurchaseAt fixed', async () => {
    const user = await makeUser();
    const first = new Date('2026-07-01T10:00:00Z');
    const second = new Date('2026-07-05T10:00:00Z');

    await userRepository.markPurchased(user._id, { amountPaise: 100000, when: first });
    const updated = await userRepository.markPurchased(user._id, { amountPaise: 50050, when: second });

    expect(updated.paidOrderCount).toBe(2);
    expect(updated.totalSpentPaise).toBe(150050);
    expect(updated.firstPurchaseAt.toISOString()).toBe(first.toISOString()); // unchanged
    expect(updated.lastOrderAt.toISOString()).toBe(second.toISOString());    // advanced
  });

  it('rounds fractional paise and never adds a negative amount', async () => {
    const user = await makeUser();

    let updated = await userRepository.markPurchased(user._id, { amountPaise: 12345.6 });
    expect(updated.totalSpentPaise).toBe(12346); // rounded

    updated = await userRepository.markPurchased(user._id, { amountPaise: -999 });
    expect(updated.totalSpentPaise).toBe(12346); // negative floored to 0
    expect(updated.paidOrderCount).toBe(2);
  });

  it('is a no-op with no userId', async () => {
    await expect(userRepository.markPurchased(null, { amountPaise: 100 })).resolves.toBeNull();
  });
});

describe('userRepository.reversePurchase (PAY-2 refund/return reversal)', () => {
  it('subtracts net LTV and decrements the paid-order count', async () => {
    const user = await makeUser();
    await userRepository.markPurchased(user._id, { amountPaise: 100000 });
    await userRepository.markPurchased(user._id, { amountPaise: 50000 }); // count=2, LTV=150000

    const updated = await userRepository.reversePurchase(user._id, { amountPaise: 50000 });

    expect(updated.paidOrderCount).toBe(1);
    expect(updated.totalSpentPaise).toBe(100000);
    expect(updated.hasPurchased).toBe(true); // still 1 paid order
  });

  it('floors LTV at 0 when a refund exceeds the recorded spend', async () => {
    const user = await makeUser();
    await userRepository.markPurchased(user._id, { amountPaise: 30000 }); // count=1, LTV=30000

    const updated = await userRepository.reversePurchase(user._id, { amountPaise: 999999 });

    expect(updated.totalSpentPaise).toBe(0);   // never negative
    expect(updated.paidOrderCount).toBe(0);    // floored
    expect(updated.hasPurchased).toBe(false);  // no paid orders left
  });

  it('floors the count at 0 and clears hasPurchased on the last reversal', async () => {
    const user = await makeUser();
    await userRepository.markPurchased(user._id, { amountPaise: 20000 });

    const updated = await userRepository.reversePurchase(user._id, { amountPaise: 20000 });

    expect(updated.paidOrderCount).toBe(0);
    expect(updated.totalSpentPaise).toBe(0);
    expect(updated.hasPurchased).toBe(false);
  });

  it('rounds fractional paise and is a no-op with no userId', async () => {
    const user = await makeUser();
    await userRepository.markPurchased(user._id, { amountPaise: 10000 });

    const updated = await userRepository.reversePurchase(user._id, { amountPaise: 4999.6 });
    expect(updated.totalSpentPaise).toBe(5000); // 10000 - round(4999.6)=5000

    await expect(userRepository.reversePurchase(null, { amountPaise: 100 })).resolves.toBeNull();
  });
});

/**
 * Order display lines (frontend mirror of Back-end/server/utils/orderLines.js).
 *
 * These assertions are deliberately the SAME cases as the backend suite
 * (tests/unit/utils/orderLines.test.js). The two files encode one set of rules in two
 * languages, and the only thing stopping them drifting is that both are tested for the
 * same behaviour — a gift that is visible everywhere and priced nowhere.
 */

import { buildOrderLines, linesGoodsTotal, isPhysicalReward, owesGoodie } from './orderLines';
import type { SpinRewardSnapshot } from './orderLines';

const goodie = (over: Partial<SpinRewardSnapshot> = {}): SpinRewardSnapshot => ({
  name: 'Microfibre Cloth', sku: 'MF-1', kind: 'goodie',
  imageUrl: null, fulfilledAt: null, voidedAt: null, ...over,
});

const orderWith = (spinReward: SpinRewardSnapshot | null = null) => ({
  items: [
    { _id: 'i1', name: 'Wax', price: 500, quantity: 2 },
    { _id: 'i2', name: 'Polish', price: 250, quantity: 1 },
  ],
  spinReward,
});

const SUBTOTAL = 1250;

describe('buildOrderLines', () => {
  it('renders sale items unchanged when there is no reward', () => {
    const lines = buildOrderLines(orderWith(null));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kind: 'sale', name: 'Wax', quantity: 2, lineTotal: 1000 });
  });

  it('adds the goodie as a quantity-1, zero-priced line at the END of the list', () => {
    const lines = buildOrderLines(orderWith(goodie()));
    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatchObject({
      kind: 'reward', name: 'Microfibre Cloth', sku: 'MF-1',
      quantity: 1, unitPrice: 0, lineTotal: 0, isFree: true,
    });
  });

  // THE MONEY INVARIANT — a gift must never shift a rendered total.
  it('never moves the money — goods total with a gift equals the order subtotal', () => {
    expect(linesGoodsTotal(buildOrderLines(orderWith(goodie())))).toBe(SUBTOTAL);
    expect(linesGoodsTotal(buildOrderLines(orderWith(null)))).toBe(SUBTOTAL);
  });

  it('marks the gift neither returnable nor reviewable', () => {
    const gift = buildOrderLines(orderWith(goodie()))[2];
    expect(gift.returnable).toBe(false);
    expect(gift.reviewable).toBe(false);
  });

  it.each(['coupon', 'karma'])('excludes a %s prize — nothing physical to pack', (kind) => {
    const lines = buildOrderLines(orderWith(goodie({ kind })));
    expect(lines).toHaveLength(2);
  });

  describe('a voided reward (order cancelled or refunded)', () => {
    const voided = orderWith(goodie({ voidedAt: '2026-08-28T00:00:00.000Z' }));

    it('is hidden from the customer', () => {
      expect(buildOrderLines(voided, { audience: 'customer' })).toHaveLength(2);
    });

    it('is still shown to admins, flagged voided, so a packer is told to stop', () => {
      const lines = buildOrderLines(voided, { audience: 'admin' });
      expect(lines).toHaveLength(3);
      expect(lines[2].voided).toBe(true);
      expect(lines[2].lineTotal).toBe(0);
    });
  });

  it('reports packed state from fulfilledAt', () => {
    expect(buildOrderLines(orderWith(goodie()))[2].packed).toBe(false);
    expect(buildOrderLines(orderWith(goodie({ fulfilledAt: '2026-08-28' })))[2].packed).toBe(true);
  });

  it('survives an order with no items and no reward', () => {
    expect(buildOrderLines({ items: [] })).toEqual([]);
    expect(buildOrderLines({})).toEqual([]);
  });

  // The bug this catches: resolving the LIVE product name first. An order is an
  // immutable financial record — a post-sale rename or photo swap must not rewrite
  // what the customer sees they bought.
  it('prefers the order-line snapshot over the live product for name and image', () => {
    const lines = buildOrderLines({
      items: [{
        _id: 'i1', price: 100, quantity: 1,
        name: 'Name At Purchase', image: 'http://img/at-purchase.jpg',
        product: { name: 'Renamed Since', images: [{ url: 'http://img/new.jpg' }] },
      }],
    });
    expect(lines[0].name).toBe('Name At Purchase');
    expect(lines[0].image).toBe('http://img/at-purchase.jpg');
  });

  it('falls back to the populated product for name, image and sku', () => {
    const lines = buildOrderLines({
      items: [{
        _id: 'i1', price: 100, quantity: 1,
        product: { name: 'From Catalogue', sku: 'SKU-9', images: [{ url: 'http://img/1.jpg' }] },
      }],
    });
    expect(lines[0]).toMatchObject({ name: 'From Catalogue', sku: 'SKU-9', image: 'http://img/1.jpg' });
  });
});

describe('isPhysicalReward / owesGoodie', () => {
  it('only a goodie is physical', () => {
    expect(isPhysicalReward(goodie())).toBe(true);
    expect(isPhysicalReward(goodie({ kind: 'coupon' }))).toBe(false);
    expect(isPhysicalReward(null)).toBe(false);
  });

  it('an order owes a goodie only while it is physical, granted and not withdrawn', () => {
    expect(owesGoodie(orderWith(goodie()))).toBe(true);
    expect(owesGoodie(orderWith(goodie({ voidedAt: '2026-08-28' })))).toBe(false);
    expect(owesGoodie(orderWith(goodie({ kind: 'karma' })))).toBe(false);
    expect(owesGoodie(orderWith(null))).toBe(false);
  });

  it('still owes it after it has been packed — packing is not withdrawal', () => {
    expect(owesGoodie(orderWith(goodie({ fulfilledAt: '2026-08-28' })))).toBe(true);
  });
});

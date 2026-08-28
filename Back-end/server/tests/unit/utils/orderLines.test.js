/**
 * Order display lines — the goodie-in-the-item-list derivation.
 *
 * The invariants under test are the ones that cost real money or real goodies if they
 * break. A won gift must be VISIBLE (a packer who cannot see it ships an incomplete
 * parcel) while staying OUT of the financial record (a gift that reaches the money
 * corrupts refunds, the GST invoice and every revenue report).
 */

import {
  buildOrderLines,
  linesGoodsTotal,
  isPhysicalReward,
  owesGoodie,
  LINE_KIND,
} from '../../../utils/orderLines.js';

const goodie = (over = {}) => ({
  result: 'r1', prize: 'p1', name: 'Microfibre Cloth', sku: 'MF-1',
  kind: 'goodie', imageUrl: null, wonAt: new Date(),
  fulfilledAt: null, voidedAt: null, ...over,
});

const orderWith = (spinReward = null, items = null) => ({
  items: items ?? [
    { _id: 'i1', name: 'Wax', price: 500, quantity: 2 },
    { _id: 'i2', name: 'Polish', price: 250, quantity: 1 },
  ],
  subtotal: 1250,
  totalAmount: 1250,
  spinReward,
});

describe('buildOrderLines', () => {
  it('renders sale items unchanged when there is no reward', () => {
    const lines = buildOrderLines(orderWith(null));
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.kind === LINE_KIND.SALE)).toBe(true);
    expect(lines[0]).toMatchObject({ name: 'Wax', quantity: 2, unitPrice: 500, lineTotal: 1000 });
  });

  it('adds the goodie as a quantity-1, zero-priced line at the END of the list', () => {
    const lines = buildOrderLines(orderWith(goodie()));
    expect(lines).toHaveLength(3);
    const last = lines[2];
    expect(last).toMatchObject({
      kind: LINE_KIND.REWARD,
      name: 'Microfibre Cloth',
      sku: 'MF-1',
      quantity: 1,
      unitPrice: 0,
      lineTotal: 0,
      isFree: true,
    });
  });

  // ── THE MONEY INVARIANT ───────────────────────────────────────────────────
  // If this ever fails, a free gift has entered the financial record: the refund
  // proration base shifts, the GST invoice gains a phantom line, and Meta CAPI /
  // Google Ads report a conversion value the customer never paid.
  it('never moves the money — goods total with a gift equals the order subtotal', () => {
    const order = orderWith(goodie());
    const withGift = linesGoodsTotal(buildOrderLines(order));
    const withoutGift = linesGoodsTotal(buildOrderLines(orderWith(null)));

    expect(withGift).toBe(withoutGift);
    expect(withGift).toBe(order.subtotal);
  });

  it('marks the gift neither returnable nor reviewable — it was never charged for', () => {
    const [, , gift] = buildOrderLines(orderWith(goodie()));
    expect(gift.returnable).toBe(false);
    expect(gift.reviewable).toBe(false);
    // ...while the paid goods stay both.
    const [sale] = buildOrderLines(orderWith(goodie()));
    expect(sale.returnable).toBe(true);
    expect(sale.reviewable).toBe(true);
  });

  it.each(['coupon', 'karma'])(
    'excludes a %s prize — nothing physical to pack, and it must never block fulfilment',
    (kind) => {
      const lines = buildOrderLines(orderWith(goodie({ kind })));
      expect(lines).toHaveLength(2);
      expect(lines.some((l) => l.kind === LINE_KIND.REWARD)).toBe(false);
    },
  );

  describe('a voided reward (order cancelled or refunded)', () => {
    const voided = orderWith(goodie({ voidedAt: new Date() }));

    it('is hidden from the customer — the gift is withdrawn, do not dangle it', () => {
      const lines = buildOrderLines(voided, { audience: 'customer' });
      expect(lines.some((l) => l.kind === LINE_KIND.REWARD)).toBe(false);
    });

    it('is still shown to admins, flagged voided, so a packer is told to stop', () => {
      const lines = buildOrderLines(voided, { audience: 'admin' });
      const gift = lines.find((l) => l.kind === LINE_KIND.REWARD);
      expect(gift).toBeDefined();
      expect(gift.voided).toBe(true);
      // Even shown, it is still worth nothing.
      expect(gift.lineTotal).toBe(0);
    });

    it('costs nothing either way — a voided gift cannot shift the goods total', () => {
      expect(linesGoodsTotal(buildOrderLines(voided, { audience: 'admin' })))
        .toBe(linesGoodsTotal(buildOrderLines(voided, { audience: 'customer' })));
    });
  });

  it('reports packed state from fulfilledAt so the row can show ✓ instead of a button', () => {
    const [, , unpacked] = buildOrderLines(orderWith(goodie()));
    expect(unpacked.packed).toBe(false);
    const [, , packed] = buildOrderLines(orderWith(goodie({ fulfilledAt: new Date() })));
    expect(packed.packed).toBe(true);
  });

  it('survives an order with no items and no reward', () => {
    expect(buildOrderLines({ items: [] })).toEqual([]);
    expect(buildOrderLines({})).toEqual([]);
    expect(linesGoodsTotal(buildOrderLines({}))).toBe(0);
  });

  // The bug this catches: resolving the LIVE product name first. An order is an
  // immutable financial record — a post-sale rename or photo swap must not rewrite
  // what the customer sees they bought.
  it('prefers the order-line snapshot over the live product for name and image', () => {
    const lines = buildOrderLines(orderWith(null, [{
      _id: 'i1', price: 100, quantity: 1,
      name: 'Name At Purchase', image: 'http://img/at-purchase.jpg',
      product: { name: 'Renamed Since', images: [{ url: 'http://img/new.jpg' }] },
    }]));
    expect(lines[0].name).toBe('Name At Purchase');
    expect(lines[0].image).toBe('http://img/at-purchase.jpg');
  });

  it('falls back to the populated product for name, image and sku', () => {
    const lines = buildOrderLines(orderWith(null, [{
      _id: 'i1', price: 100, quantity: 1,
      product: { name: 'From Catalogue', sku: 'SKU-9', images: [{ url: 'http://img/1.jpg' }] },
    }]));
    expect(lines[0]).toMatchObject({
      name: 'From Catalogue', sku: 'SKU-9', image: 'http://img/1.jpg',
    });
  });
});

describe('isPhysicalReward / owesGoodie', () => {
  it('only a goodie is physical', () => {
    expect(isPhysicalReward(goodie())).toBe(true);
    expect(isPhysicalReward(goodie({ kind: 'coupon' }))).toBe(false);
    expect(isPhysicalReward(null)).toBe(false);
    expect(isPhysicalReward(undefined)).toBe(false);
  });

  // Phase 1 makes this the gate on order completion, so a wrong answer here either
  // ships an incomplete parcel or leaves the order un-completable for ever.
  it('an order owes a goodie only while it is physical, granted and not withdrawn', () => {
    expect(owesGoodie(orderWith(goodie()))).toBe(true);
    expect(owesGoodie(orderWith(goodie({ voidedAt: new Date() })))).toBe(false);
    expect(owesGoodie(orderWith(goodie({ kind: 'karma' })))).toBe(false);
    expect(owesGoodie(orderWith(null))).toBe(false);
    expect(owesGoodie({})).toBe(false);
  });

  it('still owes it after it has been packed — packing is not withdrawal', () => {
    expect(owesGoodie(orderWith(goodie({ fulfilledAt: new Date() })))).toBe(true);
  });
});

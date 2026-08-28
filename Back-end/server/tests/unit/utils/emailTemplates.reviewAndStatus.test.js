/**
 * Smoke tests for the fulfillment status + review-request email templates.
 * Pure functions — assert they render without throwing and include the key content
 * (delivered lists products; review email links each product to /products/<slug>?review=1).
 */

import { orderStatusEmail, reviewRequestEmail, orderConfirmationEmail } from '../../../utils/emailTemplates.js';

const order = {
  _id: '0123456789abcdef01234567',
  shippingAddress: { fullName: 'Asha K' },
  items: [
    { name: 'Ceramic Wax', quantity: 2, image: 'http://img/wax.jpg' },
    { name: 'Microfibre Cloth', quantity: 1, image: '' },
  ],
};
const company = { name: 'Autobacs India', email: 'support@autobacsindia.com' };

describe('orderStatusEmail', () => {
  test.each(['shipped', 'delivered', 'cancelled', 'refunded'])(
    'renders a subject/text/html for status %s',
    (status) => {
      const { subject, text, html } = orderStatusEmail({ order, status, company });
      expect(subject).toBeTruthy();
      expect(text).toContain('Asha K');
      expect(html).toContain('<!DOCTYPE html>');
    }
  );

  test('delivered variant lists the ordered products', () => {
    const { text, html } = orderStatusEmail({ order, status: 'delivered', company });
    expect(html).toContain('Ceramic Wax');
    expect(html).toContain('Microfibre Cloth');
    expect(text).toContain('Ceramic Wax');
  });

  test('non-delivered variant does NOT list products', () => {
    const { html } = orderStatusEmail({ order, status: 'shipped', company });
    expect(html).not.toContain('Ceramic Wax');
  });

  test('tolerates an unknown status without throwing', () => {
    expect(() => orderStatusEmail({ order, status: 'weird', company })).not.toThrow();
  });
});

describe('reviewRequestEmail', () => {
  const products = [
    { name: 'Ceramic Wax', slug: 'ceramic-wax', image: 'http://img/wax.jpg' },
    { name: 'Microfibre Cloth', slug: 'microfibre-cloth', image: '' },
  ];

  test('links each product to /products/<slug>?review=1', () => {
    const { subject, text, html } = reviewRequestEmail({ order, products, company });
    expect(subject).toBeTruthy();
    for (const p of products) {
      expect(html).toContain(`/products/${p.slug}?review=1`);
      expect(text).toContain(`/products/${p.slug}?review=1`);
      expect(html).toContain(p.name);
    }
  });
});

/**
 * The won Spin-to-Win goodie appears in customer email as a line in the item list —
 * clearly a gift, priced FREE — without ever touching the money in the same email.
 * See utils/orderLines.js for why it is a display line and not an `Order.items` entry.
 */
describe('goodie lines in customer emails', () => {
  const goodieOrder = {
    ...order,
    subtotal: 1000,
    totalAmount: 1000,
    shippingCost: 0,
    spinReward: {
      name: 'Dashboard Camera', sku: 'DC-1', kind: 'goodie',
      imageUrl: null, fulfilledAt: null, voidedAt: null,
    },
  };

  test('delivered email lists the gift and labels it as won, not bought', () => {
    const { text, html } = orderStatusEmail({ order: goodieOrder, status: 'delivered', company });
    expect(text).toContain('Dashboard Camera');
    expect(text).toContain('free gift you won');
    expect(html).toContain('Dashboard Camera');
    expect(html).toContain('free gift you won');
  });

  test('a voided gift is never mentioned — it was withdrawn with the order', () => {
    const voided = { ...goodieOrder, spinReward: { ...goodieOrder.spinReward, voidedAt: new Date() } };
    const { text, html } = orderStatusEmail({ order: voided, status: 'delivered', company });
    expect(text).not.toContain('Dashboard Camera');
    expect(html).not.toContain('Dashboard Camera');
  });

  test.each(['coupon', 'karma'])('a %s prize is not listed as a packable item', (kind) => {
    const nonPhysical = { ...goodieOrder, spinReward: { ...goodieOrder.spinReward, kind } };
    const { text } = orderStatusEmail({ order: nonPhysical, status: 'delivered', company });
    expect(text).not.toContain('Dashboard Camera');
  });

  test('confirmation email shows the gift as FREE and leaves the total untouched', () => {
    const { text } = orderConfirmationEmail({ order: goodieOrder, company });
    expect(text).toContain('Dashboard Camera');
    expect(text).toContain('FREE');
    // The money the customer actually owes is unchanged by the gift.
    expect(text).toContain('₹1,000.00');
    const without = orderConfirmationEmail({
      order: { ...goodieOrder, spinReward: null }, company,
    }).text;
    const totalLine = (t) => t.split('\n').find((l) => l.startsWith('Total'));
    expect(totalLine(text)).toBe(totalLine(without));
  });
});

/**
 * Partial-shipment emails. An order going out in several boxes must tell the customer
 * WHICH box this is, what is in it, and what is still coming — otherwise parcel 2 of 3
 * reads as a duplicate of parcel 1, and a short delivery reads as a theft in transit.
 */
describe('partial-shipment emails', () => {
  const splitOrder = {
    ...order,
    items: [
      { _id: 'a', name: 'Ceramic Wax', quantity: 2, price: 500 },
      { _id: 'b', name: 'Microfibre Cloth', quantity: 1, price: 250 },
    ],
    shipments: [
      {
        _id: 's1', sequence: 1, status: 'shipped', includesReward: false,
        lines: [{ itemId: 'a', quantity: 2 }],
        trackingNumber: 'AWB-ONE', carrier: { name: 'Delhivery', trackingUrl: 'http://track/1' },
      },
      {
        _id: 's2', sequence: 2, status: 'packed', includesReward: false,
        lines: [{ itemId: 'b', quantity: 1 }],
        trackingNumber: 'AWB-TWO', carrier: { name: 'BlueDart', trackingUrl: 'http://track/2' },
      },
    ],
  };
  const parcelOne = splitOrder.shipments[0];
  const parcelTwo = splitOrder.shipments[1];

  test('names the parcel in the subject so two emails are not mistaken for duplicates', () => {
    const { subject } = orderStatusEmail({ order: splitOrder, status: 'shipped', shipment: parcelOne, company });
    expect(subject).toContain('Parcel 1 of 2');
  });

  test('lists only THIS parcel’s contents — never items still in the warehouse', () => {
    const { text } = orderStatusEmail({ order: splitOrder, status: 'shipped', shipment: parcelOne, company });
    expect(text).toContain('Ceramic Wax');
    // Microfibre Cloth is in parcel 2; listing it here would have the customer open
    // the box and think something was stolen.
    const itemsBlock = text.split('Items:')[1].split('Still to come')[0];
    expect(itemsBlock).not.toContain('Microfibre Cloth');
  });

  test('tells the customer what is still to come', () => {
    const { text, html } = orderStatusEmail({ order: splitOrder, status: 'shipped', shipment: parcelOne, company });
    expect(text).toContain('Still to come in a separate parcel');
    expect(text).toContain('Microfibre Cloth');
    expect(html).toContain('Still to come');
  });

  test('uses THIS parcel’s tracking number, not the order’s or another parcel’s', () => {
    const { text } = orderStatusEmail({ order: splitOrder, status: 'shipped', shipment: parcelTwo, company });
    expect(text).toContain('AWB-TWO');
    expect(text).not.toContain('AWB-ONE');
  });

  test('does not say "Parcel 1 of 1" for an ordinary single-parcel order', () => {
    const single = { ...splitOrder, shipments: [{ ...parcelOne, lines: [{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 1 }] }] };
    const { subject } = orderStatusEmail({ order: single, status: 'shipped', shipment: single.shipments[0], company });
    expect(subject).not.toContain('Parcel');
    expect(subject).toBe(`Your order is on its way — AB-${order._id.slice(-8).toUpperCase()}`);
  });

  test('an order-level email (no parcel) is unchanged', () => {
    const { subject, text } = orderStatusEmail({ order, status: 'shipped', company });
    expect(subject).not.toContain('Parcel');
    expect(text).not.toContain('Still to come');
  });

  test('the gift is listed as still-to-come until its parcel goes out', () => {
    const withGift = {
      ...splitOrder,
      spinReward: { name: 'Dashcam', sku: 'D1', kind: 'goodie', imageUrl: null, fulfilledAt: null, voidedAt: null },
      shipments: [splitOrder.shipments[0], { ...parcelTwo, includesReward: true }],
    };
    const { text } = orderStatusEmail({ order: withGift, status: 'shipped', shipment: withGift.shipments[0], company });
    expect(text).toContain('Still to come');
    expect(text).toContain('Dashcam');
    expect(text).toContain('free gift you won');
  });
});

/**
 * Review regressions in the parcel email.
 */
describe('partial-shipment email regressions', () => {
  const base = {
    ...order,
    items: [
      { _id: 'a', name: 'Ceramic Wax', quantity: 2, price: 500 },
      { _id: 'b', name: 'Polish', quantity: 1, price: 250 },
    ],
  };

  /*
    The first parcel of a split order is created BEFORE the second exists, so a
    "more than one parcel" test was false at exactly the moment the customer most needed
    telling: they got the standard "your order has shipped", a short item list, and no
    explanation for the missing item.
  */
  test('the FIRST parcel of a split order still reads as partial', () => {
    const withOneParcel = {
      ...base,
      shipments: [{
        _id: 's1', sequence: 1, status: 'shipped', includesReward: false,
        lines: [{ itemId: 'a', quantity: 2 }], trackingNumber: 'AWB-1',
      }],
    };
    const { subject, text } = orderStatusEmail({
      order: withOneParcel, status: 'shipped', shipment: withOneParcel.shipments[0], company,
    });
    expect(subject).toContain('Parcel 1');
    expect(text).toContain('Still to come in a separate parcel');
    expect(text).toContain('Polish');
  });

  test('a single parcel covering the WHOLE order is not called a parcel at all', () => {
    const whole = {
      ...base,
      shipments: [{
        _id: 's1', sequence: 1, status: 'shipped', includesReward: false,
        lines: [{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 1 }], trackingNumber: 'AWB-1',
      }],
    };
    const { subject, text } = orderStatusEmail({
      order: whole, status: 'shipped', shipment: whole.shipments[0], company,
    });
    expect(subject).not.toContain('Parcel');
    expect(text).not.toContain('Still to come');
  });

  // "Parcel 2 of 1" — sequence is a permanent id, so once a parcel is written off the
  // stored number outruns the count of live boxes.
  test('numbers parcels by live position, never producing "of 1" nonsense', () => {
    const withLost = {
      ...base,
      shipments: [
        { _id: 's0', sequence: 1, status: 'lost', includesReward: false, lines: [{ itemId: 'a', quantity: 2 }] },
        { _id: 's1', sequence: 2, status: 'shipped', includesReward: false, lines: [{ itemId: 'a', quantity: 2 }], trackingNumber: 'AWB-2' },
        { _id: 's2', sequence: 3, status: 'shipped', includesReward: false, lines: [{ itemId: 'b', quantity: 1 }], trackingNumber: 'AWB-3' },
      ],
    };
    const { subject } = orderStatusEmail({
      order: withLost, status: 'shipped', shipment: withLost.shipments[2], company,
    });
    // Third by sequence, but the SECOND live parcel of two.
    expect(subject).toContain('Parcel 2 of 2');
    expect(subject).not.toContain('of 1');
  });
});

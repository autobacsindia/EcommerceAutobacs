/**
 * A quotation's % discount on the order confirmation email: the customer sees
 * "Discount (5%) -₹500" so the rows add up — never the reason or who gave it.
 */
import { orderConfirmationEmail } from '../../../utils/emailTemplates.js';

const order = (over = {}) => ({
  _id: '64b7f0c2a1b2c3d4e5f60719',
  subtotal: 10000,
  discount: 500,
  totalAmount: 9500,
  shippingCost: 0,
  shippingAddress: { fullName: 'Rohit Shah' },
  statusHistory: [],
  items: [{ _id: 'a', name: 'Installation', price: 10000, quantity: 1 }],
  spinReward: null,
  ...over,
});

it('prints the percent and the amount, and nothing staff-only', () => {
  const { text, html } = orderConfirmationEmail({
    order: order({ salesDiscount: { percent: 5, amount: 500, reason: 'Repeat customer', byName: 'Asha' } }),
    company: { name: 'Autobacs India' },
  });
  expect(text).toMatch(/Subtotal: ₹10,000\.00\nDiscount \(5%\): -₹500\.00\n/);
  expect(text).toMatch(/₹9,500\.00/);
  expect(html).toContain('Discount (5%)');
  for (const out of [text, html]) {
    expect(out).not.toContain('Repeat customer');
    expect(out).not.toContain('Asha');
  }
});

it('an order without one is unchanged', () => {
  const { text } = orderConfirmationEmail({ order: order({ discount: 0, totalAmount: 10000 }), company: {} });
  expect(text).not.toMatch(/Discount \(/);
});

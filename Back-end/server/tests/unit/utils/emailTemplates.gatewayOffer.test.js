/**
 * A Razorpay offer at checkout: the confirmation email must say what the customer
 * actually PAID (₹2,076), not the order total (₹2,176), and name the offer.
 */
import { orderConfirmationEmail } from '../../../utils/emailTemplates.js';

const company = { name: 'Autobacs India' };
const order = (over = {}) => ({
  _id: '64b7f0c2a1b2c3d4e5f60718',
  subtotal: 2176,
  totalAmount: 2176,
  shippingCost: 0,
  shippingAddress: { fullName: 'Asha Rao' },
  statusHistory: [],
  items: [{ _id: 'a', name: 'Ford Endeavour Premium Keycase', price: 2176, quantity: 1 }],
  spinReward: null,
  ...over,
});

it('shows the offer and the amount actually paid', () => {
  const { text, html } = orderConfirmationEmail({
    order: order({ gatewayOffer: { offerIds: ['offer_1'], name: 'Flat ₹100 off on Amex', discount: 100, amountPaid: 2076, paymentId: 'pay_1' } }),
    company,
  });
  expect(text).toMatch(/Order total: ₹2,176\.00/);
  expect(text).toMatch(/Razorpay offer \(Flat ₹100 off on Amex\): -₹100\.00/);
  // Shipping here is "extra, paid on delivery", so the label reads "Total (excl. shipping)".
  expect(text).toMatch(/Total \(excl\. shipping\): ₹2,076\.00/);
  expect(html).toContain('Razorpay offer (Flat ₹100 off on Amex)');
});

it('an order without an offer is unchanged', () => {
  const { text } = orderConfirmationEmail({ order: order(), company });
  expect(text).toMatch(/Total \(excl\. shipping\): ₹2,176\.00/);
  expect(text).not.toContain('Razorpay offer');
  expect(text).not.toContain('Order total:');
});

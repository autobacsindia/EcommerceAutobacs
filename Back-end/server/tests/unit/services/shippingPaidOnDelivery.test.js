/**
 * Shipping is never charged online: the customer pays the courier on delivery,
 * by cash or GPay / UPI. The confirmation email and the PDF invoice must say so —
 * never "free", never a confident ₹0.00 — and still print the ₹ figure on the
 * rare order that does carry a shipping charge.
 *
 * The invoice is checked by recording the strings pdfkit is asked to draw
 * (extracted PDF text is unreliable: pdfkit subsets its embedded font).
 */

import { jest } from '@jest/globals';
import PDFDocument from 'pdfkit';

const mockOrderRepo = { findById: jest.fn(), save: jest.fn(), claimInvoiceEmail: jest.fn() };
jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepo }));
jest.unstable_mockModule('../../../services/emailHandler.js', () => ({ default: { sendOrderConfirmation: jest.fn() } }));
jest.unstable_mockModule('../../../repositories/counterRepository.js', () => ({ default: { next: jest.fn().mockResolvedValue(59) } }));

const { generateInvoicePdf } = await import('../../../services/invoiceService.js');
const { orderConfirmationEmail } = await import('../../../utils/emailTemplates.js');

const originalFetch = global.fetch;
beforeAll(() => { global.fetch = jest.fn().mockRejectedValue(new Error('network disabled in tests')); });
afterAll(() => { global.fetch = originalFetch; });

const order = (over = {}) => ({
  _id: '64b7f0c2a1b2c3d4e5f60718',
  status: 'confirmed',
  createdAt: new Date('2026-10-30T10:00:00Z'),
  items: [{ _id: 'a', name: 'Bosch Wiper Blade', price: 899, quantity: 1 }],
  shippingAddress: {
    fullName: 'Asha Rao', phone: '9999999999', addressLine1: '1 Test St',
    city: 'Kochi', state: 'KL', postalCode: '682001', country: 'India',
  },
  subtotal: 899, tax: 137.14, discount: 0, shippingCost: 0, totalAmount: 899,
  statusHistory: [],
  spinReward: null,
  ...over,
});

/** Every string the invoice draws, in order. */
const invoiceStrings = async (o) => {
  const originalText = PDFDocument.prototype.text;
  const drawn = [];
  PDFDocument.prototype.text = function patched(text, ...rest) {
    if (typeof text === 'string') drawn.push(text);
    return originalText.call(this, text, ...rest);
  };
  try {
    await generateInvoicePdf(o, null);
  } finally {
    PDFDocument.prototype.text = originalText;
  }
  return drawn;
};

describe('confirmation email', () => {
  it('says shipping is extra and paid on delivery, by cash or GPay / UPI', () => {
    const { text, html } = orderConfirmationEmail({ order: order(), company: { name: 'Autobacs India' } });
    expect(text).toMatch(/Shipping: Extra — paid on delivery/);
    expect(text).toMatch(/You pay it to the courier on delivery, by cash or GPay \/ UPI\./);
    expect(html).toContain('Extra — paid on delivery');
    expect(html).toContain('by cash or GPay / UPI.');
    for (const out of [text, html]) {
      expect(out).not.toMatch(/\bfree shipping\b|\bfree delivery\b|Calculated at delivery/i);
      expect(out).not.toMatch(/Shipping[^\n<]*₹0\.00/);
    }
  });

  it('still prints the amount when an order carries a shipping charge', () => {
    const { text } = orderConfirmationEmail({
      order: order({ shippingCost: 150, totalAmount: 1049 }),
      company: { name: 'Autobacs India' },
    });
    expect(text).toMatch(/Shipping: ₹150\.00/);
    expect(text).not.toContain('paid on delivery');
  });
});

describe('invoice PDF', () => {
  it('shows shipping as paid on delivery, not ₹0.00', async () => {
    const drawn = await invoiceStrings(order());
    const label = drawn.indexOf('Shipping Charges (Extra):');
    expect(label).toBeGreaterThan(-1);
    expect(drawn[label + 1]).toBe('Paid on delivery');
    expect(drawn.join(' ')).not.toMatch(/Calculated at delivery|free shipping|free delivery/i);
  });

  it('still prints the amount when an order carries a shipping charge', async () => {
    const drawn = await invoiceStrings(order({ shippingCost: 150, totalAmount: 1049 }));
    const label = drawn.indexOf('Shipping Charges (Extra):');
    expect(drawn[label + 1]).toMatch(/150\.00/);
  });
});

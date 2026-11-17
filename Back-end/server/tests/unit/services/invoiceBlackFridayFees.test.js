/**
 * Invoice PDF + confirmation email: which delivery fees were ₹0 (Black Friday offer)
 * and which were payable — read only from the order's `deliveryFees` snapshot.
 *
 *  - Offer applied → every fee shown at full price, struck through, as
 *    "₹0 (Black Friday offer)", plus "You saved ₹X". The waived fees are NOT rows of
 *    the invoice total (they were never supplied for a price).
 *  - No offer → each fee is a normal payable row; nothing is struck through.
 *
 * The PDF is checked by recording what pdfkit is asked to draw (extracted PDF text is
 * unreliable: pdfkit subsets its embedded font).
 */
import { jest } from '@jest/globals';
import PDFDocument from 'pdfkit';

const mockOrderRepo = { findById: jest.fn(), save: jest.fn(), claimInvoiceEmail: jest.fn() };
jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepo }));
jest.unstable_mockModule('../../../services/emailHandler.js', () => ({ default: { sendOrderConfirmation: jest.fn() } }));
jest.unstable_mockModule('../../../repositories/counterRepository.js', () => ({ default: { next: jest.fn().mockResolvedValue(59) } }));

const { generateInvoicePdf } = await import('../../../services/invoiceService.js');
const { orderConfirmationEmail } = await import('../../../utils/emailTemplates.js');
const { deliveryFeeBreakdown } = await import('../../../utils/deliveryFeeBreakdown.js');

const originalFetch = global.fetch;
beforeAll(() => { global.fetch = jest.fn().mockRejectedValue(new Error('network disabled in tests')); });
afterAll(() => { global.fetch = originalFetch; });

const LINES = [
  { code: 'shipping', label: 'Shipping fee', amount: 4416 },
  { code: 'packing', label: 'Packing', amount: 1500 },
  { code: 'payment', label: 'Payment fee', amount: 999 },
];
const FEES_TOTAL = 6915;

const snapshot = (applied) => ({
  pin: '682019', mode: 'freight', chargedKg: 276, lines: LINES,
  total: FEES_TOTAL, charged: applied ? 0 : FEES_TOTAL,
  offer: { code: 'blackfriday', applied, saving: applied ? FEES_TOTAL : 0 },
});

const order = (applied) => ({
  _id: '64b7f0c2a1b2c3d4e5f60718',
  status: 'confirmed',
  createdAt: new Date('2026-11-28T10:00:00Z'),
  items: [{ _id: 'a', name: 'Maybach W223 Conversion Kit', price: 505000, quantity: 1 }],
  shippingAddress: {
    fullName: 'Asha Rao', phone: '9999999999', addressLine1: '1 Test St',
    city: 'Kochi', state: 'KL', postalCode: '682019', country: 'India',
  },
  subtotal: 505000, tax: 77033.9, discount: 0,
  shippingCost: applied ? 0 : FEES_TOTAL,
  totalAmount: applied ? 505000 : 505000 + FEES_TOTAL,
  deliveryFees: snapshot(applied),
  statusHistory: [],
  spinReward: null,
});

/** Every string the invoice draws, with its options. */
const drawCalls = async (o) => {
  const originalText = PDFDocument.prototype.text;
  const drawn = [];
  PDFDocument.prototype.text = function patched(text, ...rest) {
    if (typeof text === 'string') {
      const opts = rest.find((r) => r && typeof r === 'object') || {};
      drawn.push({ text, strike: Boolean(opts.strike) });
    }
    return originalText.call(this, text, ...rest);
  };
  try {
    await generateInvoicePdf(o, null);
  } finally {
    PDFDocument.prototype.text = originalText;
  }
  return drawn;
};

describe('deliveryFeeBreakdown', () => {
  it('no snapshot → null (older orders keep their single Shipping row)', () => {
    expect(deliveryFeeBreakdown({ totalAmount: 100 })).toBeNull();
  });

  it('offer applied: nothing charged, full saving, products are the whole total', () => {
    const b = deliveryFeeBreakdown(order(true));
    expect(b).toMatchObject({ waived: true, charged: 0, saving: FEES_TOTAL, couponSaving: 0 });
    expect(b.payable).toEqual({ products: 505000, gst: 77033.9, fees: 0, total: 505000 });
  });

  it('no offer: fees are payable and split out of the total', () => {
    const b = deliveryFeeBreakdown(order(false));
    expect(b).toMatchObject({ waived: false, charged: FEES_TOTAL, saving: 0, couponSaving: 0 });
    expect(b.payable).toEqual({ products: 505000, gst: 77033.9, fees: FEES_TOTAL, total: 505000 + FEES_TOTAL });
  });

  it('free-delivery coupon (no offer) reports the coupon reduction', () => {
    const o = order(false);
    o.deliveryFees.charged = 0;
    o.totalAmount = 505000;
    expect(deliveryFeeBreakdown(o)).toMatchObject({ waived: false, charged: 0, couponSaving: FEES_TOTAL });
  });
});

describe('invoice PDF', () => {
  it('Black Friday: each fee struck through as ₹0, "You saved", and no fee row in the total', async () => {
    const drawn = await drawCalls(order(true));
    const texts = drawn.map((d) => d.text);

    for (const l of LINES) {
      const amount = drawn.find((d) => d.text === `Rs. ${l.amount.toLocaleString('en-IN')}.00` || d.text.endsWith(`${l.amount.toLocaleString('en-IN')}.00`));
      expect(amount).toBeDefined();
      expect(amount.strike).toBe(true);
      // The label appears once, in the savings box — never as a "Label:" total row.
      expect(texts).toContain(l.label);
      expect(texts).not.toContain(`${l.label}:`);
    }
    expect(texts.filter((t) => /\(Black Friday offer\)$/.test(t)).length).toBeGreaterThanOrEqual(LINES.length);
    expect(texts.some((t) => /^You saved .*6,915\.00 with the Black Friday offer$/.test(t))).toBe(true);
    expect(texts.some((t) => /These fees were not charged and are not part of the invoice total/.test(t))).toBe(true);
    expect(texts.some((t) => /^Payable: products .*5,05,000\.00 \(GST .*77,033\.90 included\) \+ delivery fees .*0\.00 = .*5,05,000\.00$/.test(t))).toBe(true);
    // The old "- ₹X" deduction row is gone.
    expect(texts).not.toContain('Black Friday offer (delivery fees waived):');
  });

  it('no offer: fees are normal payable rows, nothing struck through, no savings box', async () => {
    const drawn = await drawCalls(order(false));
    const texts = drawn.map((d) => d.text);
    for (const l of LINES) expect(texts).toContain(`${l.label}:`);
    expect(drawn.some((d) => d.strike)).toBe(false);
    expect(texts.some((t) => /You saved/.test(t))).toBe(false);
    expect(texts.some((t) => /Black Friday/.test(t))).toBe(false);
    expect(texts.some((t) => /^Payable: .*\+ delivery fees .*6,915\.00 = .*5,11,915\.00$/.test(t))).toBe(true);
  });
});

describe('confirmation email', () => {
  const company = { name: 'Autobacs India' };

  it('Black Friday: lists every fee struck through as ₹0 and the saving', () => {
    const { text, html } = orderConfirmationEmail({ order: order(true), company });
    expect(text).toMatch(/Shipping fee: ₹4,416\.00 → ₹0\.00 \(Black Friday offer\)/);
    expect(text).toMatch(/Packing: ₹1,500\.00 → ₹0\.00 \(Black Friday offer\)/);
    expect(text).toMatch(/Payment fee: ₹999\.00 → ₹0\.00 \(Black Friday offer\)/);
    expect(text).toMatch(/You saved ₹6,915\.00 with the Black Friday offer/);
    expect(text).toMatch(/You paid: products ₹5,05,000\.00 \(GST ₹77,033\.90 included\) \+ delivery fees ₹0\.00/);
    expect(html).toContain('<s style="color:#999;">₹4,416.00</s>');
    expect(html).toContain('You saved ₹6,915.00 with the Black Friday offer');
    expect(text).not.toMatch(/paid on delivery/);
  });

  it('no offer: every fee is a payable line, nothing struck through', () => {
    const { text, html } = orderConfirmationEmail({ order: order(false), company });
    expect(text).toMatch(/Shipping fee: ₹4,416\.00\n/);
    expect(text).toMatch(/Payment fee: ₹999\.00/);
    expect(text).toMatch(/\+ delivery fees ₹6,915\.00/);
    expect(text).not.toMatch(/Black Friday|You saved|→/);
    expect(html).not.toContain('<s ');
  });
});

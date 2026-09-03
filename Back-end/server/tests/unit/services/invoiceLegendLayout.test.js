/**
 * The "not a tax invoice" legend must never paint over the totals.
 *
 * REGRESSION. The legend was first drawn as an OPAQUE rounded rect at a hardcoded
 * y=742. Measured on a 13-item order carrying a coupon and karma, the grand-total
 * row lands at y=766 — inside that box — so the legend covered the total and the
 * customer's emailed receipt lost the only number that matters.
 *
 * What made it nasty: 12 items cleared the box and 14 spilled onto a second page,
 * so only a narrow band of order sizes was damaged. No fixed-size fixture would
 * have found it, and the PDF still opened cleanly.
 *
 * Asserting on extracted PDF text is unreliable (pdfkit subsets its embedded
 * font), so this measures the actual draw COORDINATES by instrumenting pdfkit,
 * across a sweep of order sizes that crosses both page breaks.
 */

import { jest } from '@jest/globals';
import PDFDocument from 'pdfkit';

const mockOrderRepo = { findById: jest.fn(), save: jest.fn(), claimInvoiceEmail: jest.fn() };
jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepo }));
jest.unstable_mockModule('../../../services/emailHandler.js', () => ({ default: { sendOrderConfirmation: jest.fn() } }));
jest.unstable_mockModule('../../../repositories/counterRepository.js', () => ({ default: { next: jest.fn().mockResolvedValue(59) } }));

const { generateInvoicePdf, NOT_A_TAX_INVOICE_TITLE } = await import('../../../services/invoiceService.js');

const originalFetch = global.fetch;
beforeAll(() => { global.fetch = jest.fn().mockRejectedValue(new Error('network disabled in tests')); });
afterAll(() => { global.fetch = originalFetch; });

/** Height of the legend box in invoiceService — keep in sync with LEGEND_H there. */
const LEGEND_H = 44;

const orderWith = (itemCount) => ({
  _id: 'abcdef1234567890',
  status: 'confirmed',
  createdAt: new Date('2026-07-03T10:00:00Z'),
  items: Array.from({ length: itemCount }, (_, i) => ({
    name: `Line item number ${i + 1} with a reasonably long product name`,
    quantity: 2,
    price: 499,
  })),
  shippingAddress: {
    fullName: 'Test Buyer', phone: '9999999999', addressLine1: '1 Test St',
    city: 'Mumbai', state: 'MH', postalCode: '400001', country: 'India',
  },
  subtotal: 499 * 2 * itemCount,
  couponDiscount: 100, couponCode: 'SAVE100',
  karmaDiscount: 50, karmaPointsUsed: 50,
  tax: 400, shippingCost: 0, discount: 150,
  totalAmount: 499 * 2 * itemCount - 150,
});

/** Render an order, recording where the grand total and the legend were drawn. */
const measure = async (itemCount) => {
  const originalText = PDFDocument.prototype.text;
  const originalAddPage = PDFDocument.prototype.addPage;
  let page = 0;
  const seen = { total: null, legend: null };

  PDFDocument.prototype.addPage = function patched(...args) {
    page += 1;
    return originalAddPage.apply(this, args);
  };
  PDFDocument.prototype.text = function patched(text, x, y, ...rest) {
    const drawY = typeof y === 'number' ? y : this.y;
    if (typeof text === 'string') {
      if (/^Total/.test(text)) seen.total = { page, y: drawY };
      if (text.startsWith(NOT_A_TAX_INVOICE_TITLE)) seen.legend = { page, y: drawY };
    }
    return originalText.call(this, text, x, y, ...rest);
  };

  try {
    await generateInvoicePdf(orderWith(itemCount), null);
  } finally {
    PDFDocument.prototype.text = originalText;
    PDFDocument.prototype.addPage = originalAddPage;
  }
  return seen;
};

describe('invoice legend layout', () => {
  // Crosses both page breaks. 13 is the size that reproduced the original bug.
  const SIZES = [1, 3, 5, 8, 10, 11, 12, 13, 14, 15, 20, 25, 30, 40];

  it.each(SIZES)('never overlaps the grand total (%i items)', async (itemCount) => {
    const { total, legend } = await measure(itemCount);

    expect(total).not.toBeNull();
    expect(legend).not.toBeNull();

    // Only a collision on the SAME page matters.
    if (total.page === legend.page) {
      const boxTop = legend.y - 8;               // title sits 8pt inside the box
      const boxBottom = boxTop + LEGEND_H;
      const totalInsideBox = total.y > boxTop && total.y < boxBottom;
      expect({ itemCount, totalY: Math.round(total.y), boxTop: Math.round(boxTop), overlaps: totalInsideBox })
        .toEqual({ itemCount, totalY: Math.round(total.y), boxTop: Math.round(boxTop), overlaps: false });
    }
  });

  it('draws the legend BELOW the total whenever both share a page', async () => {
    // Ordering matters independently of overlap: a legend above the totals would
    // read as a caveat on the items rather than on the document.
    for (const itemCount of SIZES) {
      const { total, legend } = await measure(itemCount);
      if (total.page === legend.page) {
        expect({ itemCount, below: legend.y > total.y }).toEqual({ itemCount, below: true });
      }
    }
  });

  it('never places the legend where the signature line is drawn', async () => {
    // The signature is drawn at y=790; the A4 text area ends at 791.9.
    for (const itemCount of SIZES) {
      const { legend } = await measure(itemCount);
      expect({ itemCount, endsBy: Math.round(legend.y - 8 + LEGEND_H) <= 782 })
        .toEqual({ itemCount, endsBy: true });
    }
  });
});

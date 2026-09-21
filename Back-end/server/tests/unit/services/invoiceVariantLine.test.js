/**
 * The invoice must say WHICH MODEL was bought.
 *
 * For a variable product the snapshotted line `name` is the PARENT product's name, and
 * that name routinely enumerates every option it was sold in — a real paid order reads
 * "Lightforce BEAST 230 Filter Cover (Amber / Black)" against the variant "Black". The
 * invoice printed the parent name alone, so the document did not record what was sold.
 *
 * This matters more here than on any screen: INVOICE_STORE_CLOUDINARY is off, so the
 * emailed PDF is the customer's ONLY copy, and it is the document a return, a warranty
 * claim or a chargeback is argued from.
 *
 * WHY THIS MOCKS pdfkit. The finished PDF is not greppable: pdfkit Flate-compresses the
 * content stream, and inflating it yields subset-font GLYPH INDICES (`<00010002>`), not
 * text — so there is no honest way to assert page content from the buffer. Asserting at
 * the doc.text boundary tests exactly the line this change touched. The companion suite
 * (invoiceService.test.js) still proves a real PDF is produced.
 */

import { jest } from '@jest/globals';

/** Every string handed to the PDF, in order. */
const drawn = [];

/**
 * A chainable pdfkit stand-in. Every method returns the document (pdfkit's own fluent
 * API) so the renderer runs unmodified; we record only the strings it draws.
 *
 * The Proxy must hand back the PROXY, not the raw target — pdfkit is chained
 * (`doc.font(x).fontSize(9).text(...)`) and returning the target breaks the second hop.
 */
function FakeDoc() {
  const handlers = {};
  const target = {
    page: {
      width: 595.28, height: 841.89,
      margins: { left: 50, right: 50, top: 50, bottom: 50 },
    },
    y: 50,
    on(event, cb) { (handlers[event] ||= []).push(cb); return proxy; },
    text(str) { if (typeof str === 'string') drawn.push(str); return proxy; },
    heightOfString: () => 12,
    widthOfString: () => 40,
    end() { (handlers.end || []).forEach((cb) => cb()); return proxy; },
  };
  const proxy = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return () => proxy;          // unknown method → chainable no-op
    },
  });
  return proxy;
}

jest.unstable_mockModule('pdfkit', () => ({ default: FakeDoc }));
jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: {} }));
jest.unstable_mockModule('../../../services/emailHandler.js', () => ({ default: {} }));
jest.unstable_mockModule('../../../config/cloudinary.js', () => ({ default: { uploader: {} } }));
jest.unstable_mockModule('../../../repositories/counterRepository.js', () => ({
  default: { next: jest.fn().mockResolvedValue(59) },
}));

const { generateInvoicePdf } = await import('../../../services/invoiceService.js');

const originalFetch = global.fetch;
beforeAll(() => { global.fetch = jest.fn().mockRejectedValue(new Error('network disabled in tests')); });
afterAll(() => { global.fetch = originalFetch; });
beforeEach(() => { drawn.length = 0; });

const PARENT = 'Lightforce BEAST 230 Filter Cover (Amber / Black)';

const orderWith = (items) => ({
  _id: 'abcdef1234567890',
  status: 'confirmed',
  createdAt: new Date('2026-09-20T10:00:00Z'),
  items,
  shippingAddress: {
    fullName: 'Asha Rao', addressLine1: '1 Road', city: 'Kochi',
    state: 'Kerala', postalCode: '682001', phone: '9000000000',
  },
  subtotal: 2499,
  totalAmount: 2499,
});

describe('invoice product column', () => {
  it('prints the variant beside the parent name', async () => {
    await generateInvoicePdf(
      orderWith([{ name: PARENT, quantity: 1, price: 2499, variantLabel: 'Black' }]),
      null,
    );
    expect(drawn).toContain(`${PARENT} — Black`);
    // The old, ambiguous output must be gone — not merely accompanied.
    expect(drawn).not.toContain(PARENT);
  });

  /*
    The case the invoice previously made unanswerable: one product, two models, one
    order. Both lines printed the identical string, so the document could not say what
    the customer had been charged for.
  */
  it('distinguishes two models of the same product on one invoice', async () => {
    await generateInvoicePdf(
      orderWith([
        { name: PARENT, quantity: 1, price: 2499, variantLabel: 'Black' },
        { name: PARENT, quantity: 2, price: 2499, variantLabel: 'Amber' },
      ]),
      null,
    );
    expect(drawn).toContain(`${PARENT} — Black`);
    expect(drawn).toContain(`${PARENT} — Amber`);
  });

  // The overwhelming majority of orders: the line must render exactly as it always has.
  it('leaves a simple product unchanged', async () => {
    await generateInvoicePdf(
      orderWith([{ name: 'Carnauba Wax', quantity: 1, price: 2499, variantLabel: null }]),
      null,
    );
    expect(drawn).toContain('Carnauba Wax');
    expect(drawn.some((s) => s.startsWith('Carnauba Wax —'))).toBe(false);
  });

  // A legacy WooCommerce line can carry no name at all; it must not print "undefined".
  it('falls back to "Item" when the snapshot has no name', async () => {
    await generateInvoicePdf(orderWith([{ quantity: 1, price: 2499 }]), null);
    expect(drawn).toContain('Item');
  });
});

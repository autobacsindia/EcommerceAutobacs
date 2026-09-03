import { jest } from '@jest/globals';

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockOrderRepo = {
  findById: jest.fn(),
  save: jest.fn().mockResolvedValue(true),
  // BE-2: atomic send-slot claim; default to winning the claim.
  claimInvoiceEmail: jest.fn().mockResolvedValue(true),
};
const mockEmailHandler = { sendOrderConfirmation: jest.fn() };
const mockCloudinary = { uploader: { upload_stream: jest.fn() } };
// Sequential invoice counter — mocked so the service never touches Mongoose here.
const mockCounter = { next: jest.fn().mockResolvedValue(59) };

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepo }));
jest.unstable_mockModule('../../../services/emailHandler.js', () => ({ default: mockEmailHandler }));
jest.unstable_mockModule('../../../config/cloudinary.js', () => ({ default: mockCloudinary }));
jest.unstable_mockModule('../../../repositories/counterRepository.js', () => ({ default: mockCounter }));

const {
  generateInvoicePdf, emailOrderInvoice, invoiceNumber, orderNumber, assignInvoiceNumber,
  buildBillToLines, TAX_ROW_LABEL, NOT_A_TAX_INVOICE_LEGEND, NOT_A_TAX_INVOICE_TITLE,
} = await import(
  '../../../services/invoiceService.js'
);

// Keep the suite hermetic: the service fetches the company logo over HTTP. By
// default we fail that fetch (the service degrades to a text-only header), so no
// test touches the network. Individual tests can override global.fetch.
const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network disabled in tests'));
});
afterAll(() => {
  global.fetch = originalFetch;
});

const baseOrder = () => ({
  _id: 'abcdef1234567890',
  status: 'confirmed',
  createdAt: new Date('2026-07-03T10:00:00Z'),
  items: [
    { name: 'Car Wax', quantity: 2, price: 499 },
    { name: 'Microfiber Cloth', quantity: 1, price: 199 },
  ],
  shippingAddress: {
    fullName: 'Test Buyer',
    phone: '9999999999',
    addressLine1: '1 Test St',
    city: 'Mumbai',
    state: 'MH',
    postalCode: '400001',
    country: 'India',
  },
  subtotal: 1197,
  couponDiscount: 100,
  couponCode: 'SAVE100',
  karmaDiscount: 0,
  shippingCost: 50,
  tax: 0,
  totalAmount: 1147,
  guestEmail: 'buyer@example.com',
});

describe('invoiceService.generateInvoicePdf', () => {
  test('returns a non-empty PDF buffer', async () => {
    const pdf = await generateInvoicePdf(baseOrder(), null);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(500);
    // PDF magic number
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('invoiceNumber is derived from the order id', () => {
    expect(invoiceNumber(baseOrder())).toBe('AB-34567890');
  });

  test('orderNumber uses the WooCommerce number when present, else the _id suffix', () => {
    expect(orderNumber(baseOrder())).toBe('#34567890');
    expect(orderNumber({ ...baseOrder(), wpId: 28105 })).toBe('#28105');
  });

  test('invoiceNumber shows the sequential number once assigned, else the AB- fallback', () => {
    expect(invoiceNumber(baseOrder())).toBe('AB-34567890'); // no invoiceNo yet
    expect(invoiceNumber({ ...baseOrder(), invoiceNo: 59 })).toBe('59');
  });

  test('assignInvoiceNumber pulls from the counter once, then is idempotent', async () => {
    mockCounter.next.mockClear();
    mockCounter.next.mockResolvedValue(59);
    const order = baseOrder();
    expect(await assignInvoiceNumber(order)).toBe(59);
    expect(order.invoiceNo).toBe(59);
    // Already assigned → does not consume another counter value.
    expect(await assignInvoiceNumber(order)).toBe(59);
    expect(mockCounter.next).toHaveBeenCalledTimes(1);
  });

  test('still produces a PDF when the logo fetch fails (degrades to text header)', async () => {
    // global.fetch is rejecting (see beforeAll) — the invoice must still generate.
    const pdf = await generateInvoicePdf(baseOrder(), null);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('embeds the logo when the fetch returns a PNG', async () => {
    const onePxPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQBpbBc1AAAAAElFTkSuQmCC',
      'base64'
    );
    global.fetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => onePxPng.buffer.slice(onePxPng.byteOffset, onePxPng.byteOffset + onePxPng.byteLength),
    });
    const pdf = await generateInvoicePdf(baseOrder(), null);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(500);
  });
});

describe('invoiceService.emailOrderInvoice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.INVOICE_STORE_CLOUDINARY;
    mockOrderRepo.save.mockResolvedValue(true);
    mockOrderRepo.claimInvoiceEmail.mockResolvedValue(true); // win the claim by default (BE-2)
    mockEmailHandler.sendOrderConfirmation.mockResolvedValue({ success: true });
    mockCounter.next.mockResolvedValue(59);
  });

  const stubFindById = (orderDoc) => {
    mockOrderRepo.findById.mockResolvedValue(orderDoc);
  };

  test('generates + emails the invoice, then marks the order as emailed', async () => {
    const orderDoc = { ...baseOrder(), user: { name: 'Test Buyer', email: 'user@example.com' } };
    stubFindById(orderDoc);

    const result = await emailOrderInvoice('abcdef1234567890');

    expect(result.status).toBe('sent');
    expect(mockEmailHandler.sendOrderConfirmation).toHaveBeenCalledTimes(1);
    const arg = mockEmailHandler.sendOrderConfirmation.mock.calls[0][0];
    expect(arg.to).toBe('user@example.com');
    expect(Array.isArray(arg.attachments)).toBe(true);
    expect(arg.attachments[0].ContentType).toBe('application/pdf');
    expect(arg.attachments[0].Content).toEqual(expect.any(String)); // base64
    // A sequential invoice number is issued and the attachment is named for it.
    expect(orderDoc.invoiceNo).toBe(59);
    expect(arg.attachments[0].Name).toBe('invoice-59.pdf');
    expect(orderDoc.invoiceEmailedAt).toBeInstanceOf(Date);
    expect(mockOrderRepo.save).toHaveBeenCalledWith(orderDoc);
  });

  test('is idempotent — skips when already emailed', async () => {
    const orderDoc = { ...baseOrder(), invoiceEmailedAt: new Date() };
    stubFindById(orderDoc);

    const result = await emailOrderInvoice('abcdef1234567890');

    expect(result.status).toBe('skipped');
    expect(mockEmailHandler.sendOrderConfirmation).not.toHaveBeenCalled();
  });

  test('falls back to guestEmail when there is no user account', async () => {
    const orderDoc = { ...baseOrder(), user: null };
    stubFindById(orderDoc);

    await emailOrderInvoice('abcdef1234567890');

    expect(mockEmailHandler.sendOrderConfirmation.mock.calls[0][0].to).toBe('buyer@example.com');
  });

  test('returns no-recipient when neither user nor guestEmail is present', async () => {
    const orderDoc = { ...baseOrder(), user: null, guestEmail: undefined };
    stubFindById(orderDoc);

    const result = await emailOrderInvoice('abcdef1234567890');

    expect(result.status).toBe('no-recipient');
    expect(mockEmailHandler.sendOrderConfirmation).not.toHaveBeenCalled();
  });

  test('returns not-found when the order does not exist', async () => {
    stubFindById(null);
    const result = await emailOrderInvoice('missing');
    expect(result.status).toBe('not-found');
  });

  test('does NOT mark emailed and throws when the provider rejects (lets BullMQ retry)', async () => {
    const orderDoc = { ...baseOrder(), user: { email: 'user@example.com' } };
    stubFindById(orderDoc);
    mockEmailHandler.sendOrderConfirmation.mockResolvedValue({ success: false, error: 'boom' });

    await expect(emailOrderInvoice('abcdef1234567890')).rejects.toThrow(/Invoice email failed/);
    // BE-2: the atomic claim is RELEASED (set null) on failure so BullMQ can retry.
    expect(orderDoc.invoiceEmailedAt).toBeNull();
  });
});

// ── Buyer GSTIN on the receipt ────────────────────────────────────────────────
describe('buildBillToLines', () => {
  const enterpriseOrder = (overrides = {}) => ({
    ...baseOrder(),
    buyer: {
      type: 'enterprise',
      legalName: 'Roavion Motors Private Limited',
      gstin: '27AAPFU0939F1ZV',
      stateCode: '27',
      billingAddress: {
        addressLine1: '12 Marine Drive', city: 'Kochi', state: 'Maharashtra',
        stateCode: '27', postalCode: '682011', country: 'India',
      },
    },
    ...overrides,
  });

  it('bills an individual order to the shipping address, exactly as before', () => {
    const result = buildBillToLines(baseOrder(), { name: 'U', email: 'u@x.com' });
    expect(result.name).toBe('Test Buyer');
    expect(result.lines).toContain('1 Test St');
    expect(result.shipTo).toBeNull();
    // The critical negative: no GSTIN line on a consumer receipt.
    expect(result.lines.join(' ')).not.toMatch(/GSTIN/);
  });

  it('bills a LEGACY order (no buyer key at all) unchanged', () => {
    // ~1,500 production orders look exactly like this. Reading `buyer.type` on
    // them must not throw and must not change the document.
    const legacy = baseOrder();
    delete legacy.buyer;
    const result = buildBillToLines(legacy, null);
    expect(result.name).toBe('Test Buyer');
    expect(result.shipTo).toBeNull();
    expect(result.lines.join(' ')).not.toMatch(/GSTIN/);
  });

  it('bills an enterprise order to the registered entity and prints its GSTIN', () => {
    const result = buildBillToLines(enterpriseOrder(), { email: 'ap@roavion.com' });
    expect(result.name).toBe('Roavion Motors Private Limited');
    expect(result.lines).toContain('GSTIN: 27AAPFU0939F1ZV');
    expect(result.lines).toContain('12 Marine Drive');
    // The state that appears is the one derived from the GSTIN, not the
    // shipping state ('MH' on the base order).
    expect(result.lines).toContain('Maharashtra');
  });

  it('prints a separate DELIVERED TO block when billing and shipping differ', () => {
    // The ordinary B2B case: registered office in one state, workshop in another.
    const result = buildBillToLines(enterpriseOrder(), null);
    expect(result.shipTo).toEqual(expect.arrayContaining(['Test Buyer', '1 Test St', 'Mumbai 400001']));
  });

  it('omits the DELIVERED TO block when the two addresses match', () => {
    // Otherwise the same address prints twice on every same-address B2B order.
    // baseOrder ships to state 'MH', which statesMatch resolves to Maharashtra —
    // the same state the 27… GSTIN derives — so this really is one address.
    const order = enterpriseOrder();
    order.buyer.billingAddress = {
      ...order.buyer.billingAddress,
      addressLine1: '1 Test St', city: 'Mumbai', postalCode: '400001',
    };
    expect(buildBillToLines(order, null).shipTo).toBeNull();
  });

  it('shows DELIVERED TO when only the STATE differs', () => {
    // REGRESSION. "Billing same as delivery" sends the delivery street/city/PIN
    // and the server overwrites the state from the GSTIN, so a Kerala delivery on
    // a Maharashtra registration printed as "Kochi 682011 / Maharashtra" — an
    // address that exists nowhere — and the old comparison (street/city/PIN only)
    // saw no difference, so nothing explained it.
    const order = enterpriseOrder();
    order.shippingAddress = {
      ...order.shippingAddress, addressLine1: '9 Beach Rd', city: 'Kochi', state: 'Kerala', postalCode: '682011',
    };
    order.buyer.billingAddress = {
      addressLine1: '9 Beach Rd', city: 'Kochi', postalCode: '682011',
      state: 'Maharashtra', stateCode: '27',
    };
    expect(buildBillToLines(order, null).shipTo).toEqual(
      expect.arrayContaining(['9 Beach Rd', 'Kochi 682011', 'Kerala']),
    );
  });

  it('treats a state abbreviation as the same state', () => {
    // "MH" must not be read as different from "Maharashtra", or every B2B order
    // whose addresses genuinely match would print a redundant delivery block.
    const order = enterpriseOrder();
    order.shippingAddress = { ...order.shippingAddress, addressLine1: '1 Test St', city: 'Mumbai', state: 'MH', postalCode: '400001' };
    order.buyer.billingAddress = {
      addressLine1: '1 Test St', city: 'Mumbai', postalCode: '400001',
      state: 'Maharashtra', stateCode: '27',
    };
    expect(buildBillToLines(order, null).shipTo).toBeNull();
  });

  it('falls back gracefully when an enterprise order has no billing address', () => {
    // Should not be reachable (buyerService requires one), but a receipt must
    // never fail to render over a missing optional field.
    const order = enterpriseOrder();
    delete order.buyer.billingAddress;
    const result = buildBillToLines(order, null);
    expect(result.name).toBe('Roavion Motors Private Limited');
    expect(result.lines).toContain('GSTIN: 27AAPFU0939F1ZV');
  });

  it('still renders a PDF for an enterprise order', () => {
    // The pure function is asserted above; this only proves the drawing code
    // downstream of it does not blow up on the new shape.
    return generateInvoicePdf(enterpriseOrder(), null).then((pdf) => {
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    });
  });
});

describe('the "not a tax invoice" legend', () => {
  it('says input tax credit is not claimable, and names the Act', () => {
    // This wording is what stands between a buyer GSTIN on the document and a
    // B2B customer treating it as an ITC-claimable tax invoice. See the long
    // note in invoiceService.js — the document is not GST-compliant (blended
    // hardcoded 18%, no CGST/SGST vs IGST split, no HSN codes).
    expect(NOT_A_TAX_INVOICE_TITLE).toMatch(/not a gst tax invoice/i);
    expect(NOT_A_TAX_INVOICE_LEGEND).toMatch(/input tax credit is not claimable/i);
    expect(NOT_A_TAX_INVOICE_LEGEND).toMatch(/CGST Act, 2017/);
  });

  it('labels the tax row as indicative rather than as a computed tax', () => {
    expect(TAX_ROW_LABEL).toMatch(/indicative/i);
    expect(TAX_ROW_LABEL).not.toMatch(/^Tax \(incl\.\)/);
  });
});

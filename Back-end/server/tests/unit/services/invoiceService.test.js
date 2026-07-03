import { jest } from '@jest/globals';

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockOrderRepo = { findById: jest.fn(), save: jest.fn().mockResolvedValue(true) };
const mockEmailHandler = { sendOrderConfirmation: jest.fn() };
const mockCloudinary = { uploader: { upload_stream: jest.fn() } };

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepo }));
jest.unstable_mockModule('../../../services/emailHandler.js', () => ({ default: mockEmailHandler }));
jest.unstable_mockModule('../../../config/cloudinary.js', () => ({ default: mockCloudinary }));

const { generateInvoicePdf, emailOrderInvoice, invoiceNumber } = await import(
  '../../../services/invoiceService.js'
);

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
});

describe('invoiceService.emailOrderInvoice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.INVOICE_STORE_CLOUDINARY;
    mockOrderRepo.save.mockResolvedValue(true);
    mockEmailHandler.sendOrderConfirmation.mockResolvedValue({ success: true });
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
    expect(orderDoc.invoiceEmailedAt).toBeUndefined();
  });
});

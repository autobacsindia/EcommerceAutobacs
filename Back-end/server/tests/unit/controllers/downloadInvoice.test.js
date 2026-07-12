import { jest } from '@jest/globals';

const mockOrderRepo = { findById: jest.fn(), save: jest.fn().mockResolvedValue(true) };
const mockInvoiceSvc = {
  generateInvoicePdf: jest.fn(),
  invoiceFileName: jest.fn((o) => `invoice-${o.invoiceNo}.pdf`),
  // Lazy assignment used for paid orders without a number yet.
  assignInvoiceNumber: jest.fn(async (o) => { o.invoiceNo = 59; return 59; }),
};

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepo }));
jest.unstable_mockModule('../../../services/invoiceService.js', () => ({
  generateInvoicePdf: mockInvoiceSvc.generateInvoicePdf,
  invoiceFileName: mockInvoiceSvc.invoiceFileName,
  assignInvoiceNumber: mockInvoiceSvc.assignInvoiceNumber,
}));
// Avoid loading unrelated heavy deps pulled in by the controller module.
jest.unstable_mockModule('../../../repositories/userRepository.js', () => ({ default: {} }));
jest.unstable_mockModule('../../../services/orderService.js', () => ({ default: {} }));
jest.unstable_mockModule('../../../services/orderStatusService.js', () => ({ default: {} }));
jest.unstable_mockModule('../../../services/orderTrackingService.js', () => ({ default: {} }));
jest.unstable_mockModule('../../../queue/queues.js', () => ({ getNotificationsQueue: jest.fn() }));

const { downloadInvoice } = await import('../../../controllers/orderController.js');

const makeRes = () => {
  const res = {};
  res.statusCode = 200;
  res.headers = {};
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; });
  res.send = jest.fn((b) => { res.sent = b; return res; });
  return res;
};

const paidOrder = (over = {}) => ({
  _id: 'abcdef1234567890',
  status: 'processing',
  paymentStatus: 'paid', // invoices are gated on the payment axis now
  user: { _id: 'user-1', name: 'Buyer', email: 'buyer@example.com' },
  ...over,
});

describe('orderController.downloadInvoice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInvoiceSvc.generateInvoicePdf.mockResolvedValue(Buffer.from('%PDF-1.3 test'));
    mockInvoiceSvc.invoiceFileName.mockImplementation((o) => `invoice-${o.invoiceNo}.pdf`);
    mockInvoiceSvc.assignInvoiceNumber.mockImplementation(async (o) => { o.invoiceNo = 59; return 59; });
  });

  test('404 when the order does not exist', async () => {
    mockOrderRepo.findById.mockResolvedValue(null);
    const res = makeRes();
    await downloadInvoice({ params: { id: 'x' }, user: { id: 'user-1', role: 'user' } }, res);
    expect(res.statusCode).toBe(404);
    expect(mockInvoiceSvc.generateInvoicePdf).not.toHaveBeenCalled();
  });

  test('403 when the requester is neither owner nor admin', async () => {
    mockOrderRepo.findById.mockResolvedValue(paidOrder());
    const res = makeRes();
    await downloadInvoice({ params: { id: 'x' }, user: { id: 'someone-else', role: 'user' } }, res);
    expect(res.statusCode).toBe(403);
    expect(mockInvoiceSvc.generateInvoicePdf).not.toHaveBeenCalled();
  });

  test('409 when the order is still unpaid (no invoice yet)', async () => {
    mockOrderRepo.findById.mockResolvedValue(paidOrder({ status: 'awaiting_payment', paymentStatus: 'pending' }));
    const res = makeRes();
    await downloadInvoice({ params: { id: 'x' }, user: { id: 'user-1', role: 'user' } }, res);
    expect(res.statusCode).toBe(409);
    expect(mockInvoiceSvc.generateInvoicePdf).not.toHaveBeenCalled();
  });

  test('streams the PDF to the order owner, lazily assigning an invoice number', async () => {
    mockOrderRepo.findById.mockResolvedValue(paidOrder()); // no invoiceNo yet
    const res = makeRes();
    await downloadInvoice({ params: { id: 'x' }, user: { id: 'user-1', role: 'user' } }, res);
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(mockInvoiceSvc.assignInvoiceNumber).toHaveBeenCalled();
    expect(mockOrderRepo.save).toHaveBeenCalled();
    expect(res.headers['Content-Disposition']).toContain('invoice-59.pdf');
    expect(Buffer.isBuffer(res.sent)).toBe(true);
  });

  test('reuses an already-assigned invoice number (no re-issue on re-download)', async () => {
    mockOrderRepo.findById.mockResolvedValue(paidOrder({ invoiceNo: 42 }));
    const res = makeRes();
    await downloadInvoice({ params: { id: 'x' }, user: { id: 'user-1', role: 'user' } }, res);
    expect(mockInvoiceSvc.assignInvoiceNumber).not.toHaveBeenCalled();
    expect(mockOrderRepo.save).not.toHaveBeenCalled();
    expect(res.headers['Content-Disposition']).toContain('invoice-42.pdf');
  });

  test('streams the PDF to an admin for any order', async () => {
    mockOrderRepo.findById.mockResolvedValue(paidOrder({ user: { _id: 'other', name: 'X' } }));
    const res = makeRes();
    await downloadInvoice({ params: { id: 'x' }, user: { id: 'admin-9', role: 'admin' } }, res);
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.sent).toBeDefined();
  });
});

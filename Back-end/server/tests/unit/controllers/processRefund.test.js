import { jest } from '@jest/globals';

// The refund controller works entirely through the repositories + razorpayService, so we
// mock those three and exercise the guard matrix + money path in isolation (no DB, no gateway).
const mockOrderRepository = {
  findById: jest.fn(),
  markRefundProcessing: jest.fn(),
  recordRefundResult: jest.fn(),
  markRefundFailed: jest.fn(),
  save: jest.fn(),
};
const mockPaymentRepository = {
  findById: jest.fn(),
  save: jest.fn(),
};
const mockRazorpayService = {
  refundPayment: jest.fn(),
};

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepository }));
jest.unstable_mockModule('../../../repositories/paymentRepository.js', () => ({ default: mockPaymentRepository }));
jest.unstable_mockModule('../../../services/razorpayService.js', () => ({ default: mockRazorpayService }));

const { processRefund } = await import('../../../controllers/orderController.js');

// Build a cancelled+paid order in a refundable state, overridable per-test.
function makeOrder(overrides = {}) {
  return {
    _id: 'order-1',
    status: 'cancelled',
    paymentStatus: 'paid',
    totalAmount: 1500,
    payment: 'payment-1',
    refundDetails: { status: 'pending', amount: 1500 },
    ...overrides,
  };
}

describe('processRefund controller', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { params: { id: 'order-1' }, user: { id: 'admin-1', role: 'admin' } };
    res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    // Sensible defaults (resetMocks wipes impls each test).
    mockOrderRepository.markRefundProcessing.mockResolvedValue(true);
    mockOrderRepository.recordRefundResult.mockResolvedValue(true);
    mockOrderRepository.markRefundFailed.mockResolvedValue(true);
    mockOrderRepository.save.mockResolvedValue(undefined);
    mockPaymentRepository.findById.mockResolvedValue({ _id: 'payment-1', gatewayPaymentId: 'pay_abc', status: 'completed' });
    mockPaymentRepository.save.mockResolvedValue(undefined);
  });

  it('rejects a non-cancelled order', async () => {
    mockOrderRepository.findById.mockResolvedValue(makeOrder({ status: 'processing' }));
    await processRefund(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockRazorpayService.refundPayment).not.toHaveBeenCalled();
  });

  it('rejects an unpaid order', async () => {
    mockOrderRepository.findById.mockResolvedValue(makeOrder({ paymentStatus: 'pending' }));
    await processRefund(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockRazorpayService.refundPayment).not.toHaveBeenCalled();
  });

  it('rejects an already-refunded order (409) without touching the gateway', async () => {
    mockOrderRepository.findById.mockResolvedValue(makeOrder({ paymentStatus: 'paid', refundDetails: { status: 'completed' } }));
    await processRefund(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockRazorpayService.refundPayment).not.toHaveBeenCalled();
    expect(mockOrderRepository.markRefundProcessing).not.toHaveBeenCalled();
  });

  it('rejects a ₹0 order (400) before claiming — nothing to refund', async () => {
    mockOrderRepository.findById.mockResolvedValue(makeOrder({ totalAmount: 0, refundDetails: { status: 'pending', amount: 0 } }));
    await processRefund(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockOrderRepository.markRefundProcessing).not.toHaveBeenCalled();
    expect(mockRazorpayService.refundPayment).not.toHaveBeenCalled();
  });

  it('refunds a legacy cancelled+paid order that has no refundDetails yet', async () => {
    mockOrderRepository.findById.mockResolvedValue(makeOrder({ refundDetails: undefined }));
    mockRazorpayService.refundPayment.mockResolvedValue({ success: true, refundId: 'rfnd_legacy', status: 'pending', amount: 150000 });

    await processRefund(req, res);

    expect(mockRazorpayService.refundPayment).toHaveBeenCalledWith('pay_abc', 150000, expect.objectContaining({ orderId: 'order-1' }));
    expect(mockOrderRepository.recordRefundResult).toHaveBeenCalledWith('order-1', { refundId: 'rfnd_legacy', completed: false });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('rejects when no gateway payment id is on file (422)', async () => {
    mockOrderRepository.findById.mockResolvedValue(makeOrder());
    mockPaymentRepository.findById.mockResolvedValue({ _id: 'payment-1', gatewayPaymentId: undefined });
    await processRefund(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(mockRazorpayService.refundPayment).not.toHaveBeenCalled();
  });

  it('is idempotent under a race: losing the claim returns 409 and never calls the gateway', async () => {
    mockOrderRepository.findById.mockResolvedValue(makeOrder());
    mockOrderRepository.markRefundProcessing.mockResolvedValue(false); // another request won
    await processRefund(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockRazorpayService.refundPayment).not.toHaveBeenCalled();
  });

  it('refunds the full captured amount in paise and records "processing" (not completed) for a normal-speed refund', async () => {
    mockOrderRepository.findById.mockResolvedValue(makeOrder());
    mockRazorpayService.refundPayment.mockResolvedValue({ success: true, refundId: 'rfnd_1', status: 'pending', amount: 150000 });

    await processRefund(req, res);

    expect(mockRazorpayService.refundPayment).toHaveBeenCalledWith('pay_abc', 150000, expect.objectContaining({ orderId: 'order-1' }));
    // Persisted via the conditional (anti-clobber) update, NOT completed, no Payment write.
    expect(mockOrderRepository.recordRefundResult).toHaveBeenCalledWith('order-1', { refundId: 'rfnd_1', completed: false });
    expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      refund: expect.objectContaining({ status: 'processing' }),
    }));
  });

  it('marks completed and refunds the Payment when the gateway returns "processed" (instant speed)', async () => {
    mockOrderRepository.findById.mockResolvedValue(makeOrder());
    mockRazorpayService.refundPayment.mockResolvedValue({ success: true, refundId: 'rfnd_2', status: 'processed', amount: 150000 });

    await processRefund(req, res);

    expect(mockOrderRepository.recordRefundResult).toHaveBeenCalledWith('order-1', { refundId: 'rfnd_2', completed: true });
    expect(mockPaymentRepository.save).toHaveBeenCalledTimes(1);
    const savedPayment = mockPaymentRepository.save.mock.calls[0][0];
    expect(savedPayment.status).toBe('refunded');
    expect(savedPayment.refundAmount).toBe(1500); // paise → rupees
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      refund: expect.objectContaining({ status: 'completed' }),
    }));
  });

  it('rolls the refund back to "failed" (conditional) and returns 502 when the gateway throws', async () => {
    mockOrderRepository.findById.mockResolvedValue(makeOrder());
    mockRazorpayService.refundPayment.mockRejectedValue(new Error('gateway down'));

    await processRefund(req, res);

    expect(mockOrderRepository.markRefundFailed).toHaveBeenCalledWith('order-1', 'gateway down');
    expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(502);
  });
});

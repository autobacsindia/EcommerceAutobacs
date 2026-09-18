import { jest } from '@jest/globals';

// The refund controller works entirely through the repositories + razorpayService, so we
// mock those three and exercise the guard matrix + money path in isolation (no DB, no gateway).
const mockOrderRepository = {
  findById: jest.fn(),
  markRefundProcessing: jest.fn(),
  recordRefundResult: jest.fn(),
  markRefundFailed: jest.fn(),
  // Once-only guard for the cumulative Payment.refundAmount $inc.
  claimRefundPaymentRecord: jest.fn(),
  save: jest.fn(),
};
const mockPaymentRepository = {
  findById: jest.fn(),
  save: jest.fn(),
  recordRefund: jest.fn(),
};
const mockRazorpayService = {
  refundPayment: jest.fn(),
};
// Cancellation refunds now consult the order's returns to work out how much of the
// capture is still refundable (a return refund may already have drawn against it).
const mockReturnRequestRepository = { find: jest.fn() };
// The `method: 'offline'` fork delegates wholesale to this service; the service's own
// behaviour is covered in tests/unit/services/offlineRefundService.test.js.
const mockOfflineRefundService = {
  markOrderRefundOffline: jest.fn(),
  revertOrderRefund: jest.fn(),
  markCancellationRefundOffline: jest.fn(),
  revertCancellationRefund: jest.fn(),
};

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepository }));
jest.unstable_mockModule('../../../repositories/paymentRepository.js', () => ({ default: mockPaymentRepository }));
jest.unstable_mockModule('../../../repositories/returnRequestRepository.js', () => ({ default: mockReturnRequestRepository }));
jest.unstable_mockModule('../../../services/razorpayService.js', () => ({ default: mockRazorpayService }));
jest.unstable_mockModule('../../../services/offlineRefundService.js', () => ({ default: mockOfflineRefundService }));

const { processRefund, revertOfflineRefund } = await import('../../../controllers/orderController.js');

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

describe('processRefund — the offline fork and the dashboard-refund dead end', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { params: { id: 'order-1' }, body: {}, user: { id: 'admin-1', _id: 'admin-1', role: 'admin' } };
    res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    mockOrderRepository.findById.mockResolvedValue(makeOrder());
    mockPaymentRepository.findById.mockResolvedValue({ _id: 'payment-1', gatewayPaymentId: 'pay_abc' });
    mockOrderRepository.markRefundProcessing.mockResolvedValue(true);
    mockOrderRepository.markRefundFailed.mockResolvedValue(true);
    mockReturnRequestRepository.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([]) }) });
    mockOfflineRefundService.markOrderRefundOffline.mockResolvedValue({
      amountRupees: 1500, isFull: true, notified: true, warnings: [], message: 'Recorded ₹1500 refunded by bank transfer.',
    });
  });

  it('routes method:"offline" to the service and never touches the gateway', async () => {
    req.body = {
      method: 'offline', offlineMethod: 'bank_transfer', reference: 'UTR-991',
      paidAt: '2026-09-10T10:00:00.000Z',
    };

    await processRefund(req, res);

    expect(mockRazorpayService.refundPayment).not.toHaveBeenCalled();
    expect(mockOfflineRefundService.markOrderRefundOffline).toHaveBeenCalledWith(
      req,
      expect.objectContaining({
        offlineMethod: 'bank_transfer', reference: 'UTR-991', notifyCustomer: true,
      }),
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      refund: expect.objectContaining({ status: 'completed', method: 'offline', amount: 1500 }),
    }));
  });

  it('passes notifyCustomer:false through', async () => {
    req.body = { method: 'offline', offlineMethod: 'cash', reference: 'R-1', notifyCustomer: false };
    await processRefund(req, res);
    expect(mockOfflineRefundService.markOrderRefundOffline)
      .toHaveBeenCalledWith(req, expect.objectContaining({ notifyCustomer: false }));
  });

  it('forks BEFORE the gateway preconditions, so a legacy order with no Razorpay id works', async () => {
    // The whole point: an imported/legacy order has no gatewayPaymentId, which the
    // gateway path refuses with a 422. Offline recording must not inherit that.
    mockOrderRepository.findById.mockResolvedValue(makeOrder({ payment: null }));
    mockPaymentRepository.findById.mockResolvedValue(null);
    req.body = { method: 'offline', offlineMethod: 'cash', reference: 'R-1' };

    await processRefund(req, res);

    expect(res.status).not.toHaveBeenCalledWith(422);
    expect(mockOfflineRefundService.markOrderRefundOffline).toHaveBeenCalled();
  });

  it('turns the "already fully refunded" gateway rejection into an actionable 409', async () => {
    /*
      THE BUG THIS FEATURE EXISTS FOR. An admin refunds in the Razorpay dashboard, which
      writes nothing here; the button then claims the order, calls the gateway, is
      rejected, and lands on `failed` — showing "Retry Refund" for ever.

      It still lands on `failed` (the money genuinely cannot be sent), but the response
      now names the way out instead of echoing an opaque gateway error.
    */
    mockRazorpayService.refundPayment.mockRejectedValue(
      new Error('The payment has been fully refunded already'),
    );

    await processRefund(req, res);

    expect(mockOrderRepository.markRefundFailed).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      offlineSettlementSuggested: true,
      gatewayError: 'The payment has been fully refunded already',
    }));
  });

  it('still returns a plain 502 for an unrelated gateway failure', async () => {
    mockRazorpayService.refundPayment.mockRejectedValue(new Error('Network timeout'));

    await processRefund(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(expect.not.objectContaining({ offlineSettlementSuggested: true }));
  });
});

describe('revertOfflineRefund controller', () => {
  it('delegates to the service and returns its message', async () => {
    jest.clearAllMocks();
    mockOfflineRefundService.revertOrderRefund.mockResolvedValue({
      amountRupees: 1500, warnings: [], message: 'Withdrew the ₹1500 offline refund record.',
    });
    const req = { params: { id: 'order-1' }, body: { reason: 'wrong order' }, user: { _id: 'admin-1' } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    await revertOfflineRefund(req, res);

    expect(mockOfflineRefundService.revertOrderRefund)
      .toHaveBeenCalledWith(req, { orderId: 'order-1', reason: 'wrong order' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, amount: 1500 }));
  });
});

describe('processRefund controller', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { params: { id: 'order-1' }, body: {}, user: { id: 'admin-1', role: 'admin' } };
    res = { json: jest.fn(), status: jest.fn().mockReturnThis() };

    // Sensible defaults (resetMocks wipes impls each test).
    mockOrderRepository.markRefundProcessing.mockResolvedValue(true);
    mockOrderRepository.recordRefundResult.mockResolvedValue(true);
    mockOrderRepository.markRefundFailed.mockResolvedValue(true);
    mockOrderRepository.claimRefundPaymentRecord.mockResolvedValue(true); // uncontended
    mockOrderRepository.save.mockResolvedValue(undefined);
    mockPaymentRepository.findById.mockResolvedValue({ _id: 'payment-1', gatewayPaymentId: 'pay_abc', status: 'completed' });
    mockPaymentRepository.save.mockResolvedValue(undefined);
    mockPaymentRepository.recordRefund.mockResolvedValue({});
    // repo.find(...).select(...).lean() — no prior returns on the order by default.
    mockReturnRequestRepository.find.mockReturnValue({ select: () => ({ lean: async () => [] }) });
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
    // recordRefund ($inc + conditional status flip) replaces the old read-modify-write,
    // which overwrote refundAmount and so erased any earlier partial refund.
    expect(mockPaymentRepository.recordRefund).toHaveBeenCalledWith('payment-1', 1500, 'order_cancelled');
    expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      refund: expect.objectContaining({ status: 'completed' }),
    }));
  });

  it('does NOT write to the Payment row when the webhook already claimed the record', async () => {
    // The $inc in recordRefund is not idempotent. For an instant refund the
    // refund.processed webhook can land before recordRefundResult persists, claim the
    // record, and write it — this path must then stay out of the way entirely.
    mockOrderRepository.findById.mockResolvedValue(makeOrder());
    mockRazorpayService.refundPayment.mockResolvedValue({ success: true, refundId: 'rfnd_3', status: 'processed', amount: 150000 });
    mockOrderRepository.claimRefundPaymentRecord.mockResolvedValue(false); // webhook won

    await processRefund(req, res);

    expect(mockPaymentRepository.recordRefund).not.toHaveBeenCalled();
    // The refund itself still succeeded — only the duplicate accounting write is skipped.
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('never claims the payment record for a refund that is only `processing`', async () => {
    mockOrderRepository.findById.mockResolvedValue(makeOrder());
    mockRazorpayService.refundPayment.mockResolvedValue({ success: true, refundId: 'rfnd_4', status: 'pending', amount: 150000 });

    await processRefund(req, res);

    expect(mockOrderRepository.claimRefundPaymentRecord).not.toHaveBeenCalled();
    expect(mockPaymentRepository.recordRefund).not.toHaveBeenCalled();
  });

  it('counts money the Payment row already knows about when capping the refund', async () => {
    // A refund recorded against the payment but absent from our own return records
    // (e.g. reconciled by webhook) must still shrink the headroom.
    mockOrderRepository.findById.mockResolvedValue(makeOrder());
    mockPaymentRepository.findById.mockResolvedValue({ _id: 'payment-1', gatewayPaymentId: 'pay_abc', refundAmount: 900 });

    await processRefund(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(mockRazorpayService.refundPayment).not.toHaveBeenCalled();
  });

  it('refuses to over-draw an order that a return refund already drew against', async () => {
    // ₹1500 captured, ₹1000 already refunded via a return → a full cancellation refund
    // would exceed the capture and be rejected by the gateway with an opaque error.
    mockOrderRepository.findById.mockResolvedValue(makeOrder());
    mockReturnRequestRepository.find.mockReturnValue({
      select: () => ({ lean: async () => [{ _id: 'ret-9', refund: { status: 'completed', finalAmount: 1000 } }] }),
    });

    await processRefund(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(mockOrderRepository.markRefundProcessing).not.toHaveBeenCalled();
    expect(mockRazorpayService.refundPayment).not.toHaveBeenCalled();
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

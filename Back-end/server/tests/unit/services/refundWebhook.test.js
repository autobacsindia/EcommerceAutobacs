import { jest } from '@jest/globals';

// Exercise razorpayService.applyRefundWebhook — the async completion path that flips a
// refund to its terminal state when Razorpay confirms. Repositories are mocked (no DB).
const mockOrderRepository = {
  findById: jest.fn(),
  findOneByRefundId: jest.fn(),
  save: jest.fn(),
  // Once-only guard for the cumulative Payment.refundAmount $inc.
  claimRefundPaymentRecord: jest.fn(),
};
const mockPaymentRepository = {
  findById: jest.fn(),
  save: jest.fn(),
  // Cumulative $inc + conditional status flip; replaces the read-modify-write that
  // overwrote refundAmount and lost earlier partial refunds.
  recordRefund: jest.fn(),
};
// Return refunds (notes.returnId present) reconcile the authoritative ReturnRequest.
const mockReturnRequestRepository = {
  findById: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  // Once-only guard for the cumulative Payment.refundAmount $inc.
  claimPaymentRecord: jest.fn(),
};

// Post-save notification enqueue is gated on REDIS_URL and fans out through the
// notifications queue — mock it so we can assert what gets enqueued on each outcome.
const mockNotificationsAdd = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepository }));
jest.unstable_mockModule('../../../repositories/paymentRepository.js', () => ({ default: mockPaymentRepository }));
jest.unstable_mockModule('../../../repositories/returnRequestRepository.js', () => ({ default: mockReturnRequestRepository }));
jest.unstable_mockModule('../../../queue/queues.js', () => ({
  getNotificationsQueue: () => ({ add: mockNotificationsAdd }),
  getOrderQueue: () => ({ add: jest.fn().mockResolvedValue(undefined) }),
  getSearchSyncQueue: () => ({ add: jest.fn().mockResolvedValue(undefined) }),
  enqueueNotification: jest.fn(),
}));

const razorpayService = (await import('../../../services/razorpayService.js')).default;

function makeOrder(overrides = {}) {
  return {
    _id: 'order-1',
    paymentStatus: 'paid',
    payment: 'payment-1',
    refundDetails: { status: 'processing', transactionId: 'rfnd_1' },
    ...overrides,
  };
}

describe('razorpayService.applyRefundWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrderRepository.save.mockResolvedValue(undefined);
    mockPaymentRepository.save.mockResolvedValue(undefined);
    mockPaymentRepository.recordRefund.mockResolvedValue({});
    mockOrderRepository.claimRefundPaymentRecord.mockResolvedValue(true);
    mockReturnRequestRepository.claimPaymentRecord.mockResolvedValue({ _id: 'ret-1' });
    mockPaymentRepository.findById.mockResolvedValue({ _id: 'payment-1', status: 'completed' });
    mockOrderRepository.findOneByRefundId.mockResolvedValue(null);
  });

  it('marks the order refunded and flips the Payment on refund.processed', async () => {
    const order = makeOrder();
    mockOrderRepository.findById.mockResolvedValue(order);

    await razorpayService.applyRefundWebhook(
      { id: 'rfnd_1', amount: 150000, notes: { orderId: 'order-1' } },
      'completed'
    );

    expect(order.refundDetails.status).toBe('completed');
    expect(order.paymentStatus).toBe('refunded');
    // Cumulative, via the repository — not a read-modify-write on a loaded doc.
    expect(mockPaymentRepository.recordRefund).toHaveBeenCalledWith('payment-1', 1500, 'order_cancelled');
    expect(mockPaymentRepository.save).not.toHaveBeenCalled();
    expect(mockOrderRepository.save).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: a replayed webhook for an already-completed refund is a no-op', async () => {
    mockOrderRepository.findById.mockResolvedValue(makeOrder({ refundDetails: { status: 'completed', transactionId: 'rfnd_1' } }));

    await razorpayService.applyRefundWebhook({ id: 'rfnd_1', amount: 150000, notes: { orderId: 'order-1' } }, 'completed');

    expect(mockOrderRepository.save).not.toHaveBeenCalled();
    expect(mockPaymentRepository.save).not.toHaveBeenCalled();
  });

  it('records the failure reason on refund.failed without touching the Payment', async () => {
    const order = makeOrder();
    mockOrderRepository.findById.mockResolvedValue(order);

    await razorpayService.applyRefundWebhook(
      { id: 'rfnd_1', amount: 150000, notes: { orderId: 'order-1' }, error: { description: 'insufficient balance' } },
      'failed'
    );

    expect(order.refundDetails.status).toBe('failed');
    expect(order.refundDetails.failureReason).toBe('insufficient balance');
    expect(order.paymentStatus).toBe('paid'); // unchanged
    expect(mockPaymentRepository.save).not.toHaveBeenCalled();
  });

  it('ignores a webhook whose refund id does not match the stored one', async () => {
    mockOrderRepository.findById.mockResolvedValue(makeOrder({ refundDetails: { status: 'processing', transactionId: 'rfnd_OTHER' } }));

    await razorpayService.applyRefundWebhook({ id: 'rfnd_1', amount: 150000, notes: { orderId: 'order-1' } }, 'completed');

    expect(mockOrderRepository.save).not.toHaveBeenCalled();
  });

  describe('notifications (REDIS_URL set)', () => {
    const OLD_REDIS = process.env.REDIS_URL;
    // The outer beforeEach runs jest.clearAllMocks(), which strips the resolved-value
    // implementation — re-apply it so `.add(...).catch(...)` has a promise to chain.
    beforeEach(() => {
      mockNotificationsAdd.mockResolvedValue(undefined);
      process.env.REDIS_URL = 'redis://localhost:6379';
    });
    afterEach(() => { if (OLD_REDIS === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = OLD_REDIS; });

    it('enqueues the customer refunded email on refund.processed', async () => {
      mockOrderRepository.findById.mockResolvedValue(makeOrder());

      await razorpayService.applyRefundWebhook({ id: 'rfnd_1', amount: 150000, notes: { orderId: 'order-1' } }, 'completed');

      expect(mockNotificationsAdd).toHaveBeenCalledWith('send-order-status-email', {
        orderId: 'order-1',
        status: 'refunded',
      });
    });

    it('enqueues the support refund-failed alert on refund.failed', async () => {
      mockOrderRepository.findById.mockResolvedValue(makeOrder());

      await razorpayService.applyRefundWebhook(
        { id: 'rfnd_1', amount: 150000, notes: { orderId: 'order-1' }, error: { description: 'insufficient balance' } },
        'failed'
      );

      expect(mockNotificationsAdd).toHaveBeenCalledWith('send-admin-refund-failed-alert', {
        orderId: 'order-1',
      });
    });

    it('does not enqueue on a replayed (no-op) webhook', async () => {
      mockOrderRepository.findById.mockResolvedValue(makeOrder({ refundDetails: { status: 'completed', transactionId: 'rfnd_1' } }));

      await razorpayService.applyRefundWebhook({ id: 'rfnd_1', amount: 150000, notes: { orderId: 'order-1' } }, 'completed');

      expect(mockNotificationsAdd).not.toHaveBeenCalled();
    });
  });
});

describe('razorpayService.applyRefundWebhook — return refunds (notes.returnId)', () => {
  function makeReturn(overrides = {}) {
    return {
      _id: 'ret-1',
      order: 'order-1',
      refund: { status: 'processing', razorpayRefundId: 'rfnd_1', finalAmount: 1000 },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockOrderRepository.save.mockResolvedValue(undefined);
    mockPaymentRepository.save.mockResolvedValue(undefined);
    mockPaymentRepository.recordRefund.mockResolvedValue({});
    mockOrderRepository.claimRefundPaymentRecord.mockResolvedValue(true);
    mockReturnRequestRepository.claimPaymentRecord.mockResolvedValue({ _id: 'ret-1' });
    mockPaymentRepository.findById.mockResolvedValue({ _id: 'payment-1', status: 'completed' });
    mockReturnRequestRepository.save.mockResolvedValue(undefined);
    mockReturnRequestRepository.findOne.mockResolvedValue(null);
  });

  it('reconciles the authoritative ReturnRequest, not order.refundDetails', async () => {
    const rr = makeReturn();
    mockReturnRequestRepository.findById.mockResolvedValue(rr);
    // A DIFFERENT return owns the order summary — proving we do NOT key off it.
    mockOrderRepository.findById.mockResolvedValue(makeOrder({ totalAmount: 1500, refundDetails: { status: 'processing', transactionId: 'rfnd_OTHER' } }));

    await razorpayService.applyRefundWebhook({ id: 'rfnd_1', amount: 100000, notes: { orderId: 'order-1', returnId: 'ret-1' } }, 'completed');

    expect(rr.refund.status).toBe('completed');
    expect(mockReturnRequestRepository.save).toHaveBeenCalledWith(rr);
  });

  it('leaves the order `paid` on a PARTIAL return refund (finalAmount < order total)', async () => {
    mockReturnRequestRepository.findById.mockResolvedValue(makeReturn({ refund: { status: 'processing', razorpayRefundId: 'rfnd_1', finalAmount: 1000 } }));
    const order = makeOrder({ totalAmount: 1500 });
    mockOrderRepository.findById.mockResolvedValue(order);

    await razorpayService.applyRefundWebhook({ id: 'rfnd_1', amount: 100000, notes: { orderId: 'order-1', returnId: 'ret-1' } }, 'completed');

    expect(order.paymentStatus).toBe('paid'); // partial — NOT flipped to refunded
    expect(order.refundDetails.status).toBe('completed');
    expect(order.refundDetails.transactionId).toBe('rfnd_1');
    // ...but the money MUST still be recorded on the payment row. It previously was
    // not, so a partially-refunded order read ₹0 refunded and the headroom check that
    // now guards the gateway would have had nothing to subtract.
    expect(mockPaymentRepository.recordRefund).toHaveBeenCalledWith('payment-1', 1000, 'return_refund');
  });

  it('marks the order refunded when a single return refund covers the whole order', async () => {
    mockReturnRequestRepository.findById.mockResolvedValue(makeReturn({ refund: { status: 'processing', razorpayRefundId: 'rfnd_1', finalAmount: 1500 } }));
    const order = makeOrder({ totalAmount: 1500 });
    mockOrderRepository.findById.mockResolvedValue(order);

    await razorpayService.applyRefundWebhook({ id: 'rfnd_1', amount: 150000, notes: { orderId: 'order-1', returnId: 'ret-1' } }, 'completed');

    expect(order.paymentStatus).toBe('refunded');
    expect(mockPaymentRepository.recordRefund).toHaveBeenCalledWith('payment-1', 1500, 'return_refund');
  });

  it('is idempotent when the return refund is already terminal', async () => {
    mockReturnRequestRepository.findById.mockResolvedValue(makeReturn({ refund: { status: 'completed', razorpayRefundId: 'rfnd_1', finalAmount: 1000 } }));

    await razorpayService.applyRefundWebhook({ id: 'rfnd_1', amount: 100000, notes: { orderId: 'order-1', returnId: 'ret-1' } }, 'completed');

    expect(mockReturnRequestRepository.save).not.toHaveBeenCalled();
    expect(mockOrderRepository.findById).not.toHaveBeenCalled();
  });

  it('ignores a webhook whose refund id does not match the stored return refund', async () => {
    mockReturnRequestRepository.findById.mockResolvedValue(makeReturn({ refund: { status: 'processing', razorpayRefundId: 'rfnd_OTHER', finalAmount: 1000 } }));

    await razorpayService.applyRefundWebhook({ id: 'rfnd_1', amount: 100000, notes: { orderId: 'order-1', returnId: 'ret-1' } }, 'completed');

    expect(mockReturnRequestRepository.save).not.toHaveBeenCalled();
    expect(mockOrderRepository.findById).not.toHaveBeenCalled();
  });
});

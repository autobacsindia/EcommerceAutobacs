import { jest } from '@jest/globals';

// Exercise razorpayService.applyRefundWebhook — the async completion path that flips a
// refund to its terminal state when Razorpay confirms. Repositories are mocked (no DB).
const mockOrderRepository = {
  findById: jest.fn(),
  findOneByRefundId: jest.fn(),
  save: jest.fn(),
};
const mockPaymentRepository = {
  findById: jest.fn(),
  save: jest.fn(),
};

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepository }));
jest.unstable_mockModule('../../../repositories/paymentRepository.js', () => ({ default: mockPaymentRepository }));

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
    expect(mockPaymentRepository.save).toHaveBeenCalledTimes(1);
    const payment = mockPaymentRepository.save.mock.calls[0][0];
    expect(payment.status).toBe('refunded');
    expect(payment.refundAmount).toBe(1500); // paise → rupees
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
});

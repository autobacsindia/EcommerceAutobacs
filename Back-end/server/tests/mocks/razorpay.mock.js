/**
 * Razorpay Mock for Testing
 * 
 * Prevents actual Razorpay API calls during tests
 * Provides predictable mock responses for payment flows
 */

const mockOrderResult = {
  id: 'order_test_123456',
  entity: 'order',
  amount: 299900, // Amount in paise
  amount_paid: 0,
  amount_due: 299900,
  currency: 'INR',
  receipt: 'receipt_test_001',
  status: 'created',
  attempts: 0,
  created_at: Math.floor(Date.now() / 1000)
};

const mockPaymentResult = {
  id: 'pay_test_123456',
  entity: 'payment',
  amount: 299900,
  currency: 'INR',
  status: 'captured',
  order_id: 'order_test_123456',
  method: 'card',
  created_at: Math.floor(Date.now() / 1000)
};

const mockRefundResult = {
  id: 'rfnd_test_123456',
  entity: 'refund',
  amount: 299900,
  currency: 'INR',
  payment_id: 'pay_test_123456',
  status: 'processed',
  created_at: Math.floor(Date.now() / 1000)
};

export const razorpayMock = jest.fn().mockImplementation(() => ({
  orders: {
    create: jest.fn().mockResolvedValue(mockOrderResult),
    fetch: jest.fn().mockResolvedValue(mockOrderResult),
    fetchPayments: jest.fn().mockResolvedValue({
      count: 1,
      items: [mockPaymentResult]
    })
  },
  payments: {
    fetch: jest.fn().mockResolvedValue(mockPaymentResult),
    capture: jest.fn().mockResolvedValue(mockPaymentResult),
    refund: jest.fn().mockResolvedValue(mockRefundResult)
  },
  refunds: {
    fetch: jest.fn().mockResolvedValue(mockRefundResult)
  }
}));

/**
 * Reset mock state between tests
 */
export const resetRazorpayMocks = () => {
  const instance = razorpayMock();
  instance.orders.create.mockClear();
  instance.orders.fetch.mockClear();
  instance.orders.fetchPayments.mockClear();
  instance.payments.fetch.mockClear();
  instance.payments.capture.mockClear();
  instance.payments.refund.mockClear();
};

/**
 * Simulate payment failure
 */
export const simulatePaymentFailure = (errorMessage = 'Payment failed') => {
  const instance = razorpayMock();
  instance.payments.capture.mockRejectedValueOnce(
    new Error(errorMessage)
  );
};

/**
 * Simulate order creation failure
 */
export const simulateOrderFailure = (errorMessage = 'Order creation failed') => {
  const instance = razorpayMock();
  instance.orders.create.mockRejectedValueOnce(
    new Error(errorMessage)
  );
};

/**
 * Simulate refund failure
 */
export const simulateRefundFailure = (errorMessage = 'Refund failed') => {
  const instance = razorpayMock();
  instance.payments.refund.mockRejectedValueOnce(
    new Error(errorMessage)
  );
};

export default razorpayMock;

/**
 * Unit tests for adminNotificationService.
 * DB + provider are mocked; asserts recipient resolution, content, the
 * email-disabled skip, and the provider-failure throw (so BullMQ retries).
 */

import { jest } from '@jest/globals';

const mockReviewFindById = jest.fn();
const mockConsultFindById = jest.fn();
const mockOrderFindById = jest.fn();
const mockSendEmail = jest.fn();

/** Fake Mongoose query: chainable .populate(), awaitable to `result`. */
const query = (result) => ({
  populate() { return this; },
  then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
});

jest.unstable_mockModule('../../../repositories/reviewRepository.js', () => ({
  default: { findById: mockReviewFindById },
}));
jest.unstable_mockModule('../../../repositories/consultationRepository.js', () => ({
  default: { findById: mockConsultFindById },
}));
jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({
  default: { findById: mockOrderFindById },
}));
// Stubbed so the suite doesn't pull in pdfkit/cloudinary just for the order ref.
jest.unstable_mockModule('../../../services/invoiceService.js', () => ({
  orderNumber: (order) =>
    order.wpId ? `#${order.wpId}` : `#${order._id.toString().slice(-8).toUpperCase()}`,
}));
jest.unstable_mockModule('../../../services/emailHandler.js', () => ({
  default: { sendEmail: mockSendEmail },
}));
jest.unstable_mockModule('../../../config/company.js', () => ({
  default: { name: 'Autobacs India', email: 'support@autobacsindia.com' },
}));

const {
  emailAdminReviewAlert,
  emailAdminConsultationAlert,
  emailAdminOrderPlacedAlert,
  emailAdminOrderCancelledAlert,
  emailAdminRefundFailedAlert,
} = await import('../../../services/adminNotificationService.js');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ADMIN_NOTIFICATION_EMAIL;
  delete process.env.ADMIN_NOTIFICATION_EMAILS;
  process.env.FRONTEND_URL = 'https://autobacsindia.com';
});

describe('emailAdminReviewAlert', () => {
  const makeReview = (over = {}) => ({
    _id: 'rev1',
    rating: 4,
    title: 'Great fit',
    comment: 'Bolted right on.',
    isVerifiedPurchase: true,
    product: { _id: 'p1', name: 'Brake Pads', slug: 'brake-pads' },
    user: { _id: 'u1', name: 'Asha', email: 'asha@example.com' },
    ...over,
  });

  test('sends to the support inbox with product + rating in the subject', async () => {
    mockReviewFindById.mockReturnValue(query(makeReview()));
    mockSendEmail.mockResolvedValue({ success: true });

    const result = await emailAdminReviewAlert('rev1');

    expect(result).toEqual({ status: 'sent' });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const arg = mockSendEmail.mock.calls[0][0];
    expect(arg.to).toBe('support@autobacsindia.com');
    expect(arg.subject).toContain('Brake Pads');
    expect(arg.subject).toContain('4');
    expect(arg.text).toContain('asha@example.com');
    expect(arg.html).toContain('/admin/reviews');
  });

  test('honours ADMIN_NOTIFICATION_EMAIL override', async () => {
    process.env.ADMIN_NOTIFICATION_EMAIL = 'ops@autobacsindia.com';
    mockReviewFindById.mockReturnValue(query(makeReview()));
    mockSendEmail.mockResolvedValue({ success: true });

    await emailAdminReviewAlert('rev1');
    expect(mockSendEmail.mock.calls[0][0].to).toBe('ops@autobacsindia.com');
  });

  test('fans out to every recipient in ADMIN_NOTIFICATION_EMAILS (deduped)', async () => {
    process.env.ADMIN_NOTIFICATION_EMAILS = 'support@autobacsindia.com, sales@autobacsindia.com , support@autobacsindia.com';
    mockReviewFindById.mockReturnValue(query(makeReview()));
    mockSendEmail.mockResolvedValue({ success: true });

    const result = await emailAdminReviewAlert('rev1');

    expect(result).toEqual({ status: 'sent' });
    expect(mockSendEmail).toHaveBeenCalledTimes(2); // deduped from 3
    expect(mockSendEmail.mock.calls.map((c) => c[0].to)).toEqual([
      'support@autobacsindia.com',
      'sales@autobacsindia.com',
    ]);
  });

  test('returns not-found when the review is missing', async () => {
    mockReviewFindById.mockReturnValue(query(null));
    expect(await emailAdminReviewAlert('missing')).toEqual({ status: 'not-found' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  test('skips without error when email is disabled (no retry storm)', async () => {
    mockReviewFindById.mockReturnValue(query(makeReview()));
    mockSendEmail.mockResolvedValue({ success: false, fallbackToConsole: true });

    expect(await emailAdminReviewAlert('rev1')).toEqual({ status: 'skipped-disabled' });
  });

  test('throws on a transient provider failure so BullMQ retries', async () => {
    mockReviewFindById.mockReturnValue(query(makeReview()));
    mockSendEmail.mockResolvedValue({ success: false, error: 'postmark down' });

    await expect(emailAdminReviewAlert('rev1')).rejects.toThrow(/postmark down/);
  });
});

describe('emailAdminConsultationAlert', () => {
  const makeConsult = (over = {}) => ({
    _id: 'c1',
    name: 'Ravi',
    whatsapp: '+91 98952 57905',
    city: 'Kochi',
    makeModel: 'Toyota Fortuner',
    vehicleNumber: 'KL07AB1234',
    upgrades: ['Suspension Setup', 'Wheels & Tyres'],
    usage: 'Highway',
    drivingStyle: 'Spirited',
    mode: 'In-Person',
    preferredDate: new Date('2026-07-10T00:00:00Z'),
    preferredTime: '11:00',
    notes: 'Weekend track use.',
    ...over,
  });

  test('sends with name + vehicle in the subject and a wa.me link in the HTML', async () => {
    mockConsultFindById.mockResolvedValue(makeConsult());
    mockSendEmail.mockResolvedValue({ success: true });

    const result = await emailAdminConsultationAlert('c1');

    expect(result).toEqual({ status: 'sent' });
    const arg = mockSendEmail.mock.calls[0][0];
    expect(arg.to).toBe('support@autobacsindia.com');
    expect(arg.subject).toContain('Ravi');
    expect(arg.subject).toContain('Toyota Fortuner');
    expect(arg.text).toContain('Suspension Setup');
    expect(arg.html).toContain('https://wa.me/919895257905');
    expect(arg.html).toContain('/admin/consultation');
  });

  test('returns not-found when the consultation is missing', async () => {
    mockConsultFindById.mockResolvedValue(null);
    expect(await emailAdminConsultationAlert('missing')).toEqual({ status: 'not-found' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

/** Order fixture. `_id` is long enough for the #xxxxxxxx order-number slice. */
const makeOrder = (over = {}) => ({
  _id: '64b7f1c2a9e4d3b100ff01ab',
  totalAmount: 12499.5,
  status: 'processing',
  paymentStatus: 'paid',
  items: [
    { name: 'Brake Pads', quantity: 2 },
    { name: 'Wiper Blade', quantity: 1 },
  ],
  shippingAddress: {
    fullName: 'Asha Menon',
    phone: '+91 98952 57905',
    city: 'Kochi',
    state: 'Kerala',
    postalCode: '682001',
  },
  user: { _id: 'u1', name: 'Asha', email: 'asha@example.com' },
  ...over,
});

describe('emailAdminOrderPlacedAlert', () => {
  test('alerts the support inbox with the order ref, total and items', async () => {
    mockOrderFindById.mockResolvedValue(makeOrder());
    mockSendEmail.mockResolvedValue({ success: true });

    expect(await emailAdminOrderPlacedAlert('o1')).toEqual({ status: 'sent' });

    const arg = mockSendEmail.mock.calls[0][0];
    expect(arg.to).toBe('support@autobacsindia.com');
    expect(arg.subject).toContain('#00FF01AB');
    expect(arg.subject).toContain('12,499.50');
    expect(arg.text).toContain('asha@example.com');
    expect(arg.text).toContain('Brake Pads × 2');
    expect(arg.text).toContain('Kochi, Kerala, 682001');
    expect(arg.html).toContain('/admin/orders/64b7f1c2a9e4d3b100ff01ab');
  });

  test('falls back to the shipping address when there is no user doc', async () => {
    mockOrderFindById.mockResolvedValue(makeOrder({ user: null, guestEmail: 'guest@example.com' }));
    mockSendEmail.mockResolvedValue({ success: true });

    await emailAdminOrderPlacedAlert('o1');
    const arg = mockSendEmail.mock.calls[0][0];
    expect(arg.text).toContain('Asha Menon');
    expect(arg.text).toContain('guest@example.com');
  });

  test('returns not-found when the order is missing', async () => {
    mockOrderFindById.mockResolvedValue(null);
    expect(await emailAdminOrderPlacedAlert('missing')).toEqual({ status: 'not-found' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe('emailAdminOrderCancelledAlert', () => {
  const cancelled = (over = {}) =>
    makeOrder({
      status: 'cancelled',
      cancelledBy: 'customer',
      cancelledAt: new Date('2026-07-10T09:30:00Z'),
      cancellationReason: 'customer_request',
      ...over,
    });

  test('flags the pending refund in the subject and body when the order was paid', async () => {
    mockOrderFindById.mockResolvedValue(
      cancelled({
        refundDetails: { status: 'pending', amount: 12499.5, refundMethod: 'original_payment' },
      })
    );
    mockSendEmail.mockResolvedValue({ success: true });

    expect(await emailAdminOrderCancelledAlert('o1')).toEqual({ status: 'sent' });

    const arg = mockSendEmail.mock.calls[0][0];
    expect(arg.to).toBe('support@autobacsindia.com');
    expect(arg.subject).toContain('REFUND DUE');
    expect(arg.subject).toContain('12,499.50');
    expect(arg.subject).toContain('#00FF01AB');
    expect(arg.text).toContain('REFUND DUE: ₹12,499.50');
    expect(arg.text).toContain('customer_request');
    expect(arg.html).toContain('Process refund');
  });

  test('says nothing to refund when no payment was captured', async () => {
    mockOrderFindById.mockResolvedValue(cancelled({ paymentStatus: 'pending', refundDetails: undefined }));
    mockSendEmail.mockResolvedValue({ success: true });

    await emailAdminOrderCancelledAlert('o1');
    const arg = mockSendEmail.mock.calls[0][0];
    expect(arg.subject).not.toContain('REFUND DUE');
    expect(arg.subject).toContain('Order cancelled by customer');
    expect(arg.html).toContain('None — order was unpaid');
  });

  test('alerts on an admin-initiated cancel and names the actor', async () => {
    mockOrderFindById.mockResolvedValue(cancelled({ cancelledBy: 'admin', refundDetails: undefined }));
    mockSendEmail.mockResolvedValue({ success: true });

    expect(await emailAdminOrderCancelledAlert('o1')).toEqual({ status: 'sent' });
    const arg = mockSendEmail.mock.calls[0][0];
    expect(arg.subject).toContain('Order cancelled by admin');
    expect(arg.text).toContain('Cancelled by: admin');
  });

  test.each(['system', undefined])('does not alert on a %s-initiated cancel', async (by) => {
    mockOrderFindById.mockResolvedValue(cancelled({ cancelledBy: by }));

    expect(await emailAdminOrderCancelledAlert('o1')).toEqual({ status: 'skipped-system-cancel' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  test('does not alert when the order is not actually cancelled', async () => {
    mockOrderFindById.mockResolvedValue(makeOrder({ cancelledBy: 'customer' }));

    expect(await emailAdminOrderCancelledAlert('o1')).toEqual({ status: 'skipped-not-cancelled' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  test('returns not-found when the order is missing', async () => {
    mockOrderFindById.mockResolvedValue(null);
    expect(await emailAdminOrderCancelledAlert('missing')).toEqual({ status: 'not-found' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe('emailAdminRefundFailedAlert', () => {
  const failed = (over = {}) =>
    makeOrder({
      paymentStatus: 'paid',
      refundDetails: {
        status: 'failed',
        amount: 12499.5,
        refundMethod: 'original_payment',
        failureReason: 'insufficient balance',
        transactionId: 'rfnd_1',
      },
      ...over,
    });

  test('alerts support with the amount owed, gateway error and a retry link', async () => {
    mockOrderFindById.mockResolvedValue(failed());
    mockSendEmail.mockResolvedValue({ success: true });

    expect(await emailAdminRefundFailedAlert('o1')).toEqual({ status: 'sent' });

    const arg = mockSendEmail.mock.calls[0][0];
    expect(arg.to).toBe('support@autobacsindia.com');
    expect(arg.subject).toContain('REFUND FAILED');
    expect(arg.subject).toContain('12,499.50');
    expect(arg.text).toContain('insufficient balance');
    expect(arg.text).toContain('rfnd_1');
    expect(arg.html).toContain('Retry refund');
    expect(arg.html).toContain('/admin/orders/64b7f1c2a9e4d3b100ff01ab');
  });

  test('falls back to the order total and a generic reason when refund details are sparse', async () => {
    mockOrderFindById.mockResolvedValue(failed({ refundDetails: { status: 'failed' } }));
    mockSendEmail.mockResolvedValue({ success: true });

    await emailAdminRefundFailedAlert('o1');
    const arg = mockSendEmail.mock.calls[0][0];
    expect(arg.subject).toContain('12,499.50'); // order total
    expect(arg.text).toContain('Unknown gateway error');
  });

  test('returns not-found when the order is missing', async () => {
    mockOrderFindById.mockResolvedValue(null);
    expect(await emailAdminRefundFailedAlert('missing')).toEqual({ status: 'not-found' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  test.each(['completed', 'processing', 'pending', undefined])(
    'does not alert when the refund is not in a failed state (%s) — no false "money owed" alarm',
    async (refundStatus) => {
      mockOrderFindById.mockResolvedValue(failed({ refundDetails: { status: refundStatus } }));

      expect(await emailAdminRefundFailedAlert('o1')).toEqual({ status: 'skipped-not-failed' });
      expect(mockSendEmail).not.toHaveBeenCalled();
    }
  );
});

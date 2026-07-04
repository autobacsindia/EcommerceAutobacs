/**
 * Unit tests for reviewRequestService.emailReviewRequest.
 * DB + provider are mocked; asserts guards (status/user/idempotency), product
 * de-duplication + slug filtering, and reviewRequestedAt marking.
 */

import { jest } from '@jest/globals';

const mockFindById = jest.fn();
const mockSave = jest.fn();
const mockSendReview = jest.fn();

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({
  default: { findById: mockFindById, save: mockSave },
}));

jest.unstable_mockModule('../../../services/emailHandler.js', () => ({
  default: { sendReviewRequest: mockSendReview },
}));

const { emailReviewRequest } = await import('../../../services/reviewRequestService.js');

const makeOrder = (over = {}) => ({
  _id: 'order123',
  status: 'delivered',
  user: { name: 'Asha', email: 'asha@example.com' },
  reviewRequestedAt: null,
  items: [
    { product: { _id: 'p1', name: 'Wax', slug: 'wax', images: [{ url: 'http://img/wax.jpg' }] }, quantity: 1 },
  ],
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('emailReviewRequest', () => {
  test('sends, builds product list, and marks reviewRequestedAt on success', async () => {
    const order = makeOrder();
    mockFindById.mockResolvedValue(order);
    mockSendReview.mockResolvedValue({ success: true });

    const result = await emailReviewRequest('order123');

    expect(result).toEqual({ status: 'sent' });
    expect(mockSendReview).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'asha@example.com',
        products: [{ name: 'Wax', slug: 'wax', image: 'http://img/wax.jpg' }],
      })
    );
    expect(order.reviewRequestedAt).toBeInstanceOf(Date);
    expect(mockSave).toHaveBeenCalledWith(order);
  });

  test('dedupes by product id and skips items with no slug / deleted product', async () => {
    const order = makeOrder({
      items: [
        { product: { _id: 'p1', name: 'Wax', slug: 'wax', images: [] }, quantity: 1 },
        { product: { _id: 'p1', name: 'Wax', slug: 'wax', images: [] }, quantity: 2 }, // dup
        { product: { _id: 'p2', name: 'NoSlug' /* no slug */ }, quantity: 1 },
        { product: null, name: 'Deleted', quantity: 1 }, // deleted product
      ],
    });
    mockFindById.mockResolvedValue(order);
    mockSendReview.mockResolvedValue({ success: true });

    await emailReviewRequest('order123');

    expect(mockSendReview).toHaveBeenCalledWith(
      expect.objectContaining({ products: [{ name: 'Wax', slug: 'wax', image: '' }] })
    );
  });

  test('returns not-found when the order is missing', async () => {
    mockFindById.mockResolvedValue(null);
    expect(await emailReviewRequest('missing')).toEqual({ status: 'not-found' });
    expect(mockSendReview).not.toHaveBeenCalled();
  });

  test('is idempotent — skips if reviewRequestedAt already set', async () => {
    mockFindById.mockResolvedValue(makeOrder({ reviewRequestedAt: new Date() }));
    expect(await emailReviewRequest('order123')).toEqual({ status: 'skipped' });
    expect(mockSendReview).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  test('skips when the order is no longer delivered (refunded within the window)', async () => {
    mockFindById.mockResolvedValue(makeOrder({ status: 'refunded' }));
    expect(await emailReviewRequest('order123')).toEqual({ status: 'not-delivered' });
    expect(mockSendReview).not.toHaveBeenCalled();
  });

  test('skips guest/legacy orders with no registered user', async () => {
    mockFindById.mockResolvedValue(makeOrder({ user: null }));
    expect(await emailReviewRequest('order123')).toEqual({ status: 'no-user' });
    expect(mockSendReview).not.toHaveBeenCalled();
  });

  test('marks done and skips send when no products are reviewable', async () => {
    const order = makeOrder({ items: [{ product: null, name: 'Deleted', quantity: 1 }] });
    mockFindById.mockResolvedValue(order);

    const result = await emailReviewRequest('order123');

    expect(result).toEqual({ status: 'skipped' });
    expect(mockSendReview).not.toHaveBeenCalled();
    expect(order.reviewRequestedAt).toBeInstanceOf(Date);
    expect(mockSave).toHaveBeenCalledWith(order);
  });

  test('does NOT mark and throws when the provider fails (so BullMQ retries)', async () => {
    const order = makeOrder();
    mockFindById.mockResolvedValue(order);
    mockSendReview.mockResolvedValue({ success: false, error: 'postmark down' });

    await expect(emailReviewRequest('order123')).rejects.toThrow(/postmark down/);
    expect(order.reviewRequestedAt).toBeNull();
    expect(mockSave).not.toHaveBeenCalled();
  });
});

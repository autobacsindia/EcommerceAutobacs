import { jest } from '@jest/globals';

/**
 * getAllOrdersAdmin — payment-axis view defaults.
 *
 * The admin Orders list is the operational fulfillment queue: by default it must show
 * only in-flight (pending) + paid/refunded orders. Unpaid outcomes (failed/cancelled/
 * expired) live in the CRM Leads section and only surface here via an explicit filter.
 * These tests pin the query the controller builds — mocking the repository so no DB is
 * needed.
 */

const mockOrderRepo = {
  findAllAdmin: jest.fn().mockResolvedValue([]),
  count: jest.fn().mockResolvedValue(0),
};

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepo }));

const { getAllOrdersAdmin } = await import('../../../controllers/orderController.js');

function mockRes() {
  return {
    body: null,
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function queryPassedToRepo() {
  return mockOrderRepo.findAllAdmin.mock.calls[0][0];
}

describe('getAllOrdersAdmin — clean default + payment filter', () => {
  beforeEach(() => {
    mockOrderRepo.findAllAdmin.mockReset().mockResolvedValue([]);
    mockOrderRepo.count.mockReset().mockResolvedValue(0);
  });

  it('defaults to the clean view (pending/paid/refunded) when no filters are given', async () => {
    await getAllOrdersAdmin({ query: {} }, mockRes());
    expect(queryPassedToRepo().paymentStatus).toEqual({ $in: ['pending', 'paid', 'refunded'] });
  });

  it('honours an explicit "unpaid / abandoned" paymentStatus filter', async () => {
    await getAllOrdersAdmin({ query: { paymentStatus: 'failed,cancelled,expired' } }, mockRes());
    expect(queryPassedToRepo().paymentStatus).toEqual({ $in: ['failed', 'cancelled', 'expired'] });
  });

  it('collapses a single-value payment filter to a scalar and drops unknown values', async () => {
    await getAllOrdersAdmin({ query: { paymentStatus: 'expired,bogus' } }, mockRes());
    expect(queryPassedToRepo().paymentStatus).toBe('expired');
  });

  it('does not impose the payment default when a fulfillment status filter is set', async () => {
    await getAllOrdersAdmin({ query: { status: 'processing' } }, mockRes());
    const query = queryPassedToRepo();
    expect(query.status).toBe('processing');
    expect(query.paymentStatus).toBeUndefined();
  });

  it('returns an empty page when the payment filter resolves to nothing valid', async () => {
    const res = mockRes();
    await getAllOrdersAdmin({ query: { paymentStatus: 'bogus' } }, res);
    expect(mockOrderRepo.findAllAdmin).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ success: true, total: 0, orders: [] });
  });
});

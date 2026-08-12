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

const mockUserRepo = {
  findIdsByNameOrEmail: jest.fn().mockResolvedValue([]),
};

jest.unstable_mockModule('../../../repositories/orderRepository.js', () => ({ default: mockOrderRepo }));
jest.unstable_mockModule('../../../repositories/userRepository.js', () => ({ default: mockUserRepo }));

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
    mockUserRepo.findIdsByNameOrEmail.mockReset().mockResolvedValue([]);
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

/**
 * A search must reach the whole collection.
 *
 * The clean default above keeps the *browse* queue tidy, but it used to apply to searches
 * too — so looking up a customer whose payment failed, or pasting the id of an expired
 * order, returned "no orders found" for an order that plainly exists. Searching is an
 * explicit "find me this one", so it lifts the default; explicit filters still win.
 */
describe('getAllOrdersAdmin — search is not narrowed by the payment default', () => {
  beforeEach(() => {
    mockOrderRepo.findAllAdmin.mockReset().mockResolvedValue([]);
    mockOrderRepo.count.mockReset().mockResolvedValue(0);
    mockUserRepo.findIdsByNameOrEmail.mockReset().mockResolvedValue([]);
  });

  it('lifts the payment default for a unified search term', async () => {
    await getAllOrdersAdmin({ query: { search: 'Priya Sharma' } }, mockRes());
    expect(queryPassedToRepo().paymentStatus).toBeUndefined();
  });

  it('lifts the payment default for a legacy orderNumber lookup', async () => {
    await getAllOrdersAdmin({ query: { orderNumber: '7f3a91b2' } }, mockRes());
    expect(queryPassedToRepo().paymentStatus).toBeUndefined();
  });

  it('still honours an explicit payment filter alongside a search', async () => {
    await getAllOrdersAdmin({ query: { search: 'Priya', paymentStatus: 'failed' } }, mockRes());
    expect(queryPassedToRepo().paymentStatus).toBe('failed');
  });

  it('keeps the payment default when the search param is present but blank', async () => {
    await getAllOrdersAdmin({ query: { search: '   ' } }, mockRes());
    expect(queryPassedToRepo().paymentStatus).toEqual({ $in: ['pending', 'paid', 'refunded'] });
  });
});

/**
 * The order id lane. Orders carry no separate order number — the admin table renders the
 * last 8 hex chars of `_id` behind a `#`, so that `#` comes back with anything an admin
 * copies off the screen and must not disqualify the term from the id lane.
 */
describe('getAllOrdersAdmin — order-id lane accepts the displayed order number', () => {
  const idLaneOf = (query) => (query.$or || []).find(clause => clause._id || clause.$expr);

  beforeEach(() => {
    mockOrderRepo.findAllAdmin.mockReset().mockResolvedValue([]);
    mockOrderRepo.count.mockReset().mockResolvedValue(0);
    mockUserRepo.findIdsByNameOrEmail.mockReset().mockResolvedValue([]);
  });

  it('matches a bare trailing-hex fragment', async () => {
    await getAllOrdersAdmin({ query: { search: '7f3a91b2' } }, mockRes());
    expect(idLaneOf(queryPassedToRepo()).$expr.$regexMatch.regex).toBe('7f3a91b2$');
  });

  it('matches the same fragment pasted with its display "#" prefix', async () => {
    await getAllOrdersAdmin({ query: { search: '#7f3a91b2' } }, mockRes());
    expect(idLaneOf(queryPassedToRepo()).$expr.$regexMatch.regex).toBe('7f3a91b2$');
  });

  it('matches a full 24-char ObjectId pasted with a "#" prefix', async () => {
    const id = '507f1f77bcf86cd799439011';
    await getAllOrdersAdmin({ query: { search: `#${id}` } }, mockRes());
    expect(String(idLaneOf(queryPassedToRepo())._id)).toBe(id);
  });

  it('applies the same tolerance to the legacy orderNumber param', async () => {
    await getAllOrdersAdmin({ query: { orderNumber: '#7f3a91b2' } }, mockRes());
    expect(queryPassedToRepo().$expr.$regexMatch.regex).toBe('7f3a91b2$');
  });

  it('leaves the customer/recipient lanes matching the raw term, "#" and all', async () => {
    await getAllOrdersAdmin({ query: { search: '#7f3a91b2' } }, mockRes());
    const nameLane = queryPassedToRepo().$or.find(c => c['shippingAddress.fullName']);
    expect(nameLane['shippingAddress.fullName'].source).toContain('#7f3a91b2');
    expect(mockUserRepo.findIdsByNameOrEmail).toHaveBeenCalledWith('#7f3a91b2');
  });

  it('skips the id lane entirely for a non-hex term', async () => {
    await getAllOrdersAdmin({ query: { search: 'priya@example.com' } }, mockRes());
    expect(idLaneOf(queryPassedToRepo())).toBeUndefined();
  });
});
